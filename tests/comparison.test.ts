import { mkdtemp, mkdir, writeFile, readFile, rm, rename, chmod, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { captureReportContext } from '../src/reports/context.ts';
import { buildReportView } from '../src/reports/view.ts';
import { buildSavedScan } from '../src/history/validation.ts';
import { compareSavedScans } from '../src/comparison/index.ts';
import { formatComparisonHtml, formatComparisonJson, formatComparisonTerminal } from '../src/reports/comparison.ts';
import { LocalScanHistoryRepository } from '../src/history/repository.ts';
import { runCli } from '../src/cli/run.ts';
import type { SavedScan } from '../src/types/history.ts';

let sandbox: string; let target: string; let history: string; let before: SavedScan; let after: SavedScan;
async function capture(projectId: string) {
  const c = await captureReportContext(target, {});
  // Simulated stable build identity for synthetic comparison tests, not production provenance.
  c.metadata.scannerVersion = '0.1.0'; c.metadata.buildFingerprint = 'b'.repeat(64);
  return buildSavedScan(c.scan, buildReportView(c.scan, c.metadata), projectId);
}
beforeEach(async () => {
  sandbox = await mkdtemp(resolve('.scanner-test-comparison-')); target = resolve(sandbox, 'target'); history = resolve(sandbox, 'history'); await mkdir(target);
  await writeFile(resolve(target, 'package.json'), '{"dependencies":{"openai":"4.0.0"}}');
  await writeFile(resolve(target, 'index.ts'), "import OpenAI from 'openai'; const c=new OpenAI();c.completions.create({model:'text-davinci-003'});throw new Error('NEVER_EXECUTE');");
  const p = await LocalScanHistoryRepository.init(history); before = await capture(p.projectId);
  await writeFile(resolve(target, 'index.ts'), "import OpenAI from 'openai'; const c=new OpenAI();c.completions.create({model:process.env.MODEL});throw new Error('NEVER_EXECUTE');");
  after = await capture(p.projectId);
  before.snapshot.metadata.startedAt = '2026-10-19T10:00:00.000Z'; after.snapshot.metadata.startedAt = '2026-10-20T10:00:00.000Z';
  before.savedAt = '2026-10-19T10:01:00.000Z'; after.savedAt = '2026-10-20T10:01:00.000Z';
});
afterEach(async () => { await rm(sandbox, { recursive: true, force: true }); });
async function cli(args: string[]) {
  const stdout: string[] = []; const stderr: string[] = [];
  const code = await runCli(args, { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
const blocks = (r: SavedScan) => r.snapshot.sections.find((s) => s.kind === 'findings')!.blocks;
function removeFinding(r: SavedScan) {
  const f = r.identities.findings.pop()!;
  r.snapshot.sections.find((s) => s.kind === 'findings')!.blocks = blocks(r).filter((b) => !b.rows.some((row) => row.label === 'Finding reference' && row.value === f.reference));
  r.snapshot.stats[2]!.value = r.identities.findings.filter((v) => ['affected', 'potentially-affected'].includes(v.status)).length;
  r.snapshot.stats[3]!.value = r.identities.findings.filter((v) => v.status === 'unknown').length;
}

it('reports genuine Affected → Unknown, unchanged integration identity and evidence differences without mutation', () => {
  const original = structuredClone([before, after]); const c = compareSavedScans(before, after);
  expect([before, after]).toEqual(original); expect(c.integrations[0]!.category).toBe('unchanged');
  const changed = c.assessments.find((r) => r.before[0]!.identity.status === 'affected')!;
  expect(changed.category).toBe('changed'); expect(changed.uncertainty).toBe('increased'); expect(changed.evidenceChanged).toBe(true);
  expect(changed.after[0]!.identity.status).toBe('unknown'); expect(formatComparisonTerminal(c)).toContain('Affected → Unknown');
  expect(c.inconclusive).toBe(false); expect(formatComparisonJson(c)).not.toContain(sandbox);
});
it('compares the same record deterministically with explicit same-record and clock warnings', () => {
  const a = compareSavedScans(before, before); expect(compareSavedScans(before, before)).toEqual(a);
  expect(a.assessments.every((r) => r.category === 'unchanged')).toBe(true); expect(a.warnings.join(' ')).toContain('same saved scan');
});
it('does not reorder reversed timestamps and reports reduced Unknown only as an evidence status change', () => {
  const c = compareSavedScans(after, before); expect(c.before.scanId).toBe(after.scanId);
  expect(c.warnings.join(' ')).toContain('not reordered'); expect(c.assessments.some((r) => r.uncertainty === 'reduced')).toBe(true);
});
it('rejects cross-project, unsupported schema and raw legacy reports', () => {
  after.projectId = randomUUID(); expect(() => compareSavedScans(before, after)).toThrow('same explicit project');
  const bad = structuredClone(before); (bad as { schemaVersion: number }).schemaVersion = 2;
  expect(() => compareSavedScans(before, bad)).toThrow(); expect(() => compareSavedScans(before, {} as SavedScan)).toThrow();
});
it.each(['scannerVersion', 'buildFingerprint', 'catalogVersion', 'catalogFingerprint'] as const)('discloses differing %s while preserving recorded statuses', (key) => {
  if (key === 'scannerVersion') after.snapshot.metadata[key] = '0.2.0';
  else if (key === 'catalogVersion') after.snapshot.metadata[key] = '4';
  else after.snapshot.metadata[key] = 'f'.repeat(64);
  const c = compareSavedScans(before, after); expect(c.inconclusive).toBe(true); expect(c.warnings.join(' ')).toMatch(/differs/u);
  expect(c.assessments.some((r) => r.category === 'changed')).toBe(true);
});
it('discloses unavailable build metadata, partial/truncated coverage and different budgets', () => {
  after.snapshot.metadata.buildFingerprint = null; after.snapshot.complete = false;
  after.snapshot.coverage.find((r) => r.label === 'Assessments truncated')!.value = 'true';
  after.snapshot.sections.find((s) => s.kind === 'scope')!.blocks[0]!.rows.find((r) => r.label === 'Scan budget: maxFiles')!.value = '1';
  const c = compareSavedScans(before, after); expect(c.inconclusive).toBe(true);
  for (const word of ['unknown', 'incomplete', 'truncated', 'budgets']) expect(c.warnings.join(' ')).toContain(word);
});
it('marks missing coverage metadata inconclusive even when both snapshots omit the same fields', () => {
  before.snapshot.coverage = []; after.snapshot.coverage = [];
  expect(compareSavedScans(before, after).warnings.join(' ')).toContain('coverage metadata is incomplete');
});
it('does not assert a like-for-like transition when embedded change content differs', () => {
  after.identities.findings.forEach((f) => { f.recordFingerprint = 'f'.repeat(64); });
  expect(compareSavedScans(before, after).assessments.every((r) => r.category === 'inconclusive')).toBe(true);
});
it('reports missing/new assessments without claiming fixed or inferring renamed clients', () => {
  removeFinding(after); const missing = compareSavedScans(before, after).assessments.find((r) => r.category === 'missing')!;
  expect(missing.reason).toContain('does not prove a fix');
  after = structuredClone(before); after.scanId = randomUUID();
  after.identities.findings.forEach((f) => { f.clientReference = 'f'.repeat(64); });
  const c = compareSavedScans(before, after); expect(c.assessments.filter((r) => r.category === 'missing')).toHaveLength(2); expect(c.assessments.filter((r) => r.category === 'new')).toHaveLength(2);
});
it('refuses to match line-moved client scope even with an unchanged opaque client reference', () => {
  blocks(after).forEach((b) => b.rows.forEach((r) => { if (r.label === 'Original client definition') r.value = 'index.ts:2'; }));
  expect(compareSavedScans(before, after).assessments.every((r) => ['new', 'missing'].includes(r.category))).toBe(true);
});
it('does not guess when multiple findings share the same client/change scope', () => {
  const f = structuredClone(after.identities.findings[0]!); const b = structuredClone(blocks(after).find((b) => b.rows.some((r) => r.label === 'Finding reference' && r.value === f.reference))!);
  f.reference = 'a'.repeat(64); b.rows.find((r) => r.label === 'Finding reference')!.value = f.reference;
  after.identities.findings.push(f); blocks(after).push(b); after.snapshot.stats[3]!.value++;
  expect(compareSavedScans(before, after).assessments.some((r) => r.category === 'inconclusive')).toBe(true);
});
it('compares explicit integration fallback without inventing client identity', () => {
  for (const r of [before, after]) { r.identities.findings.forEach((f) => { f.clientReference = null; }); blocks(r).forEach((b) => { b.rows = b.rows.filter((v) => v.label !== 'Original client definition'); }); }
  expect(compareSavedScans(before, after).assessments.every((r) => r.category === 'changed')).toBe(true);
});
it('reports newly detected/missing integrations with no inferred runtime installation or removal', () => {
  const empty = structuredClone(after); empty.identities.integrations = []; empty.identities.findings = [];
  empty.snapshot.stats[1]!.value = 0; empty.snapshot.stats[2]!.value = 0; empty.snapshot.stats[3]!.value = 0;
  empty.snapshot.sections.find((s) => s.kind === 'findings')!.blocks = []; empty.snapshot.sections.find((s) => s.kind === 'integrations')!.blocks = [];
  expect(compareSavedScans(before, empty).integrations[0]!.category).toBe('missing');
  expect(compareSavedScans(empty, before).integrations[0]!.category).toBe('new');
});
it('retains manifest declaration associations when integration rows are reordered', () => {
  after = structuredClone(before); after.scanId = randomUUID();
  after.snapshot.sections.find((s) => s.kind === 'integrations')!.blocks[0]!.rows.reverse();
  expect(compareSavedScans(before, after).integrations[0]!.evidenceChanged).toBe(true);
});
it('escapes injected snapshot text, hashes static CSS and has no executable or external resources', () => {
  after.snapshot.notices.push('</pre><script>alert(1)</script>');
  const html = formatComparisonHtml(compareSavedScans(before, after)); const css = html.match(/<style>(.*?)<\/style>/su)![1]!;
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toMatch(/<script|<img|<iframe|<form|<link|onclick=|<details open/u);
  expect(html).toContain(`style-src 'sha256-${createHash('sha256').update(css).digest('base64')}'`);
  expect(html).toContain("connect-src 'none'"); expect(html).toContain('@media(max-width:700px)'); expect(html).not.toContain(sandbox);
});
it('runs CLI from immutable records without the original target, no overwrite or history mutation', async () => {
  const repo = await LocalScanHistoryRepository.open(history); await repo.save(before); await repo.save(after);
  const first = await readFile(resolve(history, `${before.scanId}.json`)); const second = await readFile(resolve(history, `${after.scanId}.json`));
  await rename(target, resolve(sandbox, 'unavailable')); const output = resolve(sandbox, 'compare.html');
  const args = ['history', 'compare', before.scanId, after.scanId, '--directory', history, '--json', '--html', output];
  const result = await cli(args); expect(result.code).toBe(0); expect(JSON.parse(result.stdout).schemaVersion).toBe(1); expect(result.stderr).toBe('');
  const html = await readFile(output); expect((await cli(args)).code).toBe(1); expect(await readFile(output)).toEqual(html);
  expect(await readFile(resolve(history, `${before.scanId}.json`))).toEqual(first); expect(await readFile(resolve(history, `${after.scanId}.json`))).toEqual(second);
});
it.each([[], [randomUUID()], ['../escape', randomUUID()], [randomUUID(), randomUUID(), randomUUID()]].map((ids) => ({ ids })))('rejects invalid CLI identifiers %j', async ({ ids }) => {
  expect((await cli(['history', 'compare', ...ids, '--directory', history])).code).toBe(1);
});
it('fails closed on corrupted, linked and loose-permission records without producing output', async () => {
  const repo = await LocalScanHistoryRepository.open(history); await repo.save(before); await repo.save(after);
  const file = resolve(history, `${after.scanId}.json`); const original = await readFile(file);
  const args = ['history', 'compare', before.scanId, after.scanId, '--directory', history, '--json'];
  await writeFile(file, '{corrupt'); expect((await cli(args)).code).toBe(1);
  await writeFile(file, original); await chmod(file, 0o644); expect((await cli(args)).code).toBe(1);
  await chmod(file, 0o600); await rename(file, resolve(sandbox, 'record')); await symlink(resolve(sandbox, 'record'), file);
  const result = await cli(args); expect(result.code).toBe(1); expect(result.stdout).toBe('');
});
it('rejects symlink output and traversal without changing existing files', async () => {
  const repo = await LocalScanHistoryRepository.open(history); await repo.save(before); await repo.save(after);
  const sentinel = resolve(sandbox, 'sentinel'); await writeFile(sentinel, 'keep'); const link = resolve(sandbox, 'link.html'); await symlink(sentinel, link);
  const args = ['history', 'compare', before.scanId, after.scanId, '--directory', history];
  expect((await cli([...args, '--html', link])).code).toBe(1); expect(await readFile(sentinel, 'utf8')).toBe('keep');
  expect((await cli(['history', 'compare', before.scanId, after.scanId, '--directory', history + '/../history'])).code).toBe(1);
});

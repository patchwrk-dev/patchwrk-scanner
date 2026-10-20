import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, lstat, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalScanHistoryRepository } from '../src/history/repository.ts';
import { captureReportContext } from '../src/reports/context.ts';
import { buildReportView } from '../src/reports/view.ts';
import { buildSavedScan, validateSavedScan, parseHistory } from '../src/history/validation.ts';
import { runCli } from '../src/cli/run.ts';

let sandbox: string; let target: string; let history: string;
beforeEach(async () => {
  sandbox = await mkdtemp(resolve('.scanner-test-history-')); target = resolve(sandbox, 'target'); history = resolve(sandbox, 'history');
  await mkdir(target);
  await writeFile(resolve(target, 'package.json'), '{"dependencies":{"openai":"4.0.0"}}');
  await writeFile(resolve(target, 'index.ts'), "import OpenAI from 'openai'; const c=new OpenAI(); c.completions.create({model:'text-davinci-003'}); throw new Error('NEVER_EXECUTE');");
});
afterEach(async () => { vi.restoreAllMocks(); await rm(sandbox, { recursive: true, force: true }); });
async function cli(args: string[]) {
  const stdout: string[] = []; const stderr: string[] = [];
  const code = await runCli(args, { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
async function saved(projectId: string) {
  const context = await captureReportContext(target, {});
  return buildSavedScan(context.scan, buildReportView(context.scan, context.metadata), projectId);
}

it('never creates history on default or HTML-only scans and preserves JSON bytes when saving', async () => {
  const original = await cli(['scan', target, '--json']);
  await cli(['scan', target, '--html', resolve(sandbox, 'plain.html')]);
  expect(await readdir(sandbox)).not.toContain('history');
  const project = await LocalScanHistoryRepository.init(history);
  const result = await cli(['scan', target, '--json', '--history-dir', history, '--project-id', project.projectId]);
  expect(result.code).toBe(0); expect(result.stdout).toBe(original.stdout); expect(result.stderr).toMatch(/^History saved: [a-f0-9-]{36}$/u);
  expect((await LocalScanHistoryRepository.open(history)).project).toEqual(project);
  expect((await lstat(history)).mode & 0o777).toBe(0o700);
});

it('stores strict immutable privacy-filtered snapshots and future comparison identities', async () => {
  const project = await LocalScanHistoryRepository.init(history); const repo = await LocalScanHistoryRepository.open(history);
  const record = await saved(project.projectId); const before = structuredClone(record);
  await repo.save(record); expect(record).toEqual(before);
  expect(await repo.get(record.scanId)).toEqual(record);
  const text = await readFile(resolve(history, `${record.scanId}.json`), 'utf8');
  expect(validateSavedScan(parseHistory(text))).toEqual(record);
  expect(text).not.toContain(sandbox); expect(text).not.toContain('NEVER_EXECUTE'); expect(text).not.toContain('new OpenAI');
  expect(record.identities.integrations).toEqual([{ provider: 'openai', packageName: 'openai' }]);
  expect(record.identities.findings[0]!.reference).toMatch(/^[a-f0-9]{64}$/u);
  expect((await lstat(resolve(history, `${record.scanId}.json`))).mode & 0o777).toBe(0o600);
  await expect(repo.save(record)).rejects.toThrow('History operation failed');
  expect(await repo.get(record.scanId)).toEqual(before);
});

it('lists and regenerates historical HTML after the original project is unavailable', async () => {
  const project = await LocalScanHistoryRepository.init(history); const repo = await LocalScanHistoryRepository.open(history);
  const record = await saved(project.projectId); await repo.save(record);
  await rename(target, resolve(sandbox, 'unavailable-project'));
  const list = await cli(['history', 'list', '--directory', history, '--json', '--html', resolve(sandbox, 'index.html')]);
  expect(list.code).toBe(0); expect(JSON.parse(list.stdout).records[0].scanId).toBe(record.scanId);
  const shown = await cli(['history', 'show', record.scanId, '--directory', history, '--json', '--html', resolve(sandbox, 'historical.html')]);
  expect(shown.code).toBe(0); expect(JSON.parse(shown.stdout)).toEqual(record);
  const html = await readFile(resolve(sandbox, 'historical.html'), 'utf8');
  expect(html).toContain('Historical snapshot — not current compatibility');
  expect(html).toContain(record.snapshot.metadata.startedAt); expect(html).toContain(record.snapshot.metadata.catalogFingerprint);
  expect(html).not.toContain(sandbox); expect(html).not.toContain('<script');
  const second = await cli(['history', 'show', record.scanId, '--directory', history, '--html', resolve(sandbox, 'historical.html')]);
  expect(second.code).toBe(1); expect(second.stdout).toBe('');
  expect(await readFile(resolve(sandbox, 'historical.html'), 'utf8')).toBe(html);
});

it('deletes only explicitly applied selected records and preserves other snapshots', async () => {
  const project = await LocalScanHistoryRepository.init(history); const repo = await LocalScanHistoryRepository.open(history);
  const first = await saved(project.projectId); const second = await saved(project.projectId); await repo.save(first); await repo.save(second);
  const preview = await repo.remove(first.scanId, false); expect(preview.deleted).toEqual([]); expect(preview.selected).toEqual([first.scanId]);
  expect(await repo.get(first.scanId)).toEqual(first);
  const applied = await repo.remove(first.scanId, true); expect(applied.deleted).toEqual([first.scanId]);
  await expect(repo.get(first.scanId)).rejects.toThrow(); expect(await repo.get(second.scanId)).toEqual(second);
  expect((await repo.list()).records).toHaveLength(1);
});

it('uses age AND keep-last, previews by default, and leaves corrupt/unknown files untouched', async () => {
  const project = await LocalScanHistoryRepository.init(history); const repo = await LocalScanHistoryRepository.open(history);
  const old = await saved(project.projectId); old.savedAt = '2025-01-01T00:00:00.000Z';
  const recent = await saved(project.projectId); recent.savedAt = '2026-01-01T00:00:00.000Z';
  await repo.save(old); await repo.save(recent);
  const badId = randomUUID(); await writeFile(resolve(history, `${badId}.json`), '{broken', { mode: 0o600 }); await writeFile(resolve(history, 'PRIVATE_LABEL.txt'), 'inert', { mode: 0o600 });
  const now = Date.parse('2026-02-01T00:00:00.000Z');
  expect((await repo.prune({ keepLast: 1, olderThanDays: 365 }, false, now)).selected).toEqual([old.scanId]);
  expect((await repo.prune({ keepLast: 2, olderThanDays: 365 }, true, now)).deleted).toEqual([]);
  const result = await repo.prune({ keepLast: 1, olderThanDays: 365 }, true, now); expect(result.deleted).toEqual([old.scanId]);
  expect(result.warnings.join(' ')).not.toContain('PRIVATE_LABEL');
  expect(await readFile(resolve(history, `${badId}.json`), 'utf8')).toBe('{broken');
  expect(await repo.get(recent.scanId)).toEqual(recent);
  await expect(repo.prune({}, true)).rejects.toThrow();
  await expect(repo.prune({ keepLast: 0 }, true, Date.parse('2024-01-01T00:00:00.000Z'))).rejects.toThrow();
});

it.each([
  ['scan', '--save-history'], ['scan', '--history-dir', 'missing'], ['scan', '--project-id', 'invalid'],
  ['history', 'list'], ['history', 'show', '../outside'], ['history', 'list', '--apply', '--directory', 'missing'],
  ['history', 'prune', '--directory', 'missing'], ['history', 'init', '--directory', 'a', '--directory', 'b'],
])('rejects invalid history invocation %j without success stdout', async (...args) => {
  const result = await cli(args); expect(result.code).toBe(1); expect(result.stdout).toBe('');
});

it('refuses wrong project IDs, missing IDs and existing initialized directories', async () => {
  const project = await LocalScanHistoryRepository.init(history); const repo = await LocalScanHistoryRepository.open(history);
  await expect(LocalScanHistoryRepository.open(history, randomUUID())).rejects.toThrow();
  await expect(repo.get(randomUUID())).rejects.toThrow();
  await expect(LocalScanHistoryRepository.init(history)).rejects.toThrow();
  const record = await saved(project.projectId); record.projectId = randomUUID(); await expect(repo.save(record)).rejects.toThrow();
});

it('rejects inconsistent statuses/counts and handles injected text as escaped data', async () => {
  const project = await LocalScanHistoryRepository.init(history); const repo = await LocalScanHistoryRepository.open(history);
  const record = await saved(project.projectId);
  const wrong = structuredClone(record); wrong.identities.findings[0]!.status = 'healthy' as never;
  expect(() => validateSavedScan(wrong)).toThrow();
  const changed = structuredClone(record); changed.identities.findings[1]!.status = 'unknown';
  expect(() => validateSavedScan(changed)).toThrow();
  record.snapshot.sections[0]!.blocks[0]!.notes.push('<script>alert(1)</script>');
  await repo.save(record);
  const result = await cli(['history', 'show', record.scanId, '--directory', history, '--html', resolve(sandbox, 'escaped.html')]);
  expect(result.code).toBe(0);
  const html = await readFile(resolve(sandbox, 'escaped.html'), 'utf8');
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
});

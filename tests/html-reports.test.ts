import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli/run.ts';
import { captureReportContext, canonicalJson } from '../src/reports/context.ts';
import { buildReportView } from '../src/reports/view.ts';
import { escapeHtml, formatHtml } from '../src/reports/html.ts';
import { LocalChangeCatalog } from '../src/changes/catalog.ts';

let sandbox: string;
let target: string;
beforeEach(async () => {
  sandbox = await mkdtemp(resolve('.scanner-test-html-'));
  target = resolve(sandbox, 'project');
  await mkdir(target);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(sandbox, { recursive: true, force: true }); });

async function cli(args: string[]) {
  const stdout: string[] = []; const stderr: string[] = [];
  const code = await runCli(args, { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
async function fixture(model: string) {
  await writeFile(resolve(target, 'package.json'), '{"dependencies":{"openai":"4.0.0"}}');
  await writeFile(resolve(target, 'index.ts'), `import OpenAI from 'openai'; const client = new OpenAI(); client.completions.create({model:${model}}); throw new Error('DO_NOT_EXECUTE');`);
}

it('escapes every HTML delimiter including quotes without creating markup', () => {
  expect(escapeHtml(`<script a="x">'&</script>`)).toBe('&lt;script a=&quot;x&quot;&gt;&#39;&amp;&lt;/script&gt;');
});

it('uses one catalog load and fingerprints validated content deterministically', async () => {
  const catalog = await new LocalChangeCatalog().load();
  const load = vi.fn(async () => catalog);
  const context = await captureReportContext(target, { catalog: { load } });
  expect(load).toHaveBeenCalledTimes(1);
  expect(context.metadata.catalogVersion).toBe('3');
  expect(context.metadata.catalogRecordCount).toBe(4);
  expect(canonicalJson({ z: 2, a: [1, { b: 2, a: 1 }] })).toBe('{"a":[1,{"a":1,"b":2}],"z":2}');
  expect(context.metadata.catalogFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  expect(context.metadata.startedAt <= context.metadata.finishedAt).toBe(true);
  expect(context.metadata.scannerVersion).toBeNull();
});

it('preserves default terminal and JSON bytes with optional HTML and never persists by default', async () => {
  await fixture("'text-davinci-003'");
  const before = await readFile(resolve(target, 'index.ts'));
  const terminal = await cli(['scan', target]);
  expect(await readdir(sandbox)).toEqual(['project']);
  const htmlPath = resolve(sandbox, 'report.html');
  const visual = await cli(['scan', target, '--html', htmlPath]);
  expect(visual).toEqual(terminal);
  const json = await cli(['scan', target, '--json']);
  const withHtml = await cli(['scan', target, '--json', '--html', resolve(sandbox, 'report-json.html')]);
  expect(withHtml).toEqual(json);
  expect(JSON.parse(json.stdout).schemaVersion).toBe(2);
  expect(await readFile(resolve(target, 'index.ts'))).toEqual(before);
  const html = await readFile(htmlPath, 'utf8');
  expect(html).toContain('Affected');
  expect(html).toContain('index.ts:1');
  expect(html).toContain('Not affected by this change');
  expect(html).toContain('Unknown or withheld');
  expect(html).not.toContain(target);
  expect(html).not.toContain('DO_NOT_EXECUTE');
  expect(html).not.toContain('new OpenAI');
  expect(html).toContain('redacted equivalent');
});

it('reports dynamic evidence as unknown, not a repair, and keeps projected state independent', async () => {
  await fixture('process.env.SYNTHETIC_SECRET_CANARY');
  const context = await captureReportContext(target, {});
  const original = structuredClone(context.scan);
  const view = buildReportView(context.scan, context.metadata);
  expect(context.scan).toEqual(original);
  const html = formatHtml(view);
  expect(context.scan.compatibility.assessments.map((item) => item.status)).toEqual(['unknown', 'unknown']);
  expect(html).toContain('Unknown');
  expect(html).toContain('dynamic');
  expect(html).not.toContain('SYNTHETIC_SECRET_CANARY');
  expect(html).not.toContain('process.env');
});

it('handles empty, no-catalog provider and partial scans without inventing health', async () => {
  let context = await captureReportContext(target, {});
  expect(formatHtml(buildReportView(context.scan, context.metadata))).toContain('No supported integration detected');
  await writeFile(resolve(target, 'package.json'), '{"dependencies":{"twilio":"5.0.0"}}');
  context = await captureReportContext(target, {});
  expect(formatHtml(buildReportView(context.scan, context.metadata))).toContain('No known finding within supported coverage');
  context.scan.coverage.complete = false;
  const partial = formatHtml(buildReportView(context.scan, context.metadata));
  expect(partial).toContain('Unknown / partial coverage');
  expect(partial).toContain('partial coverage — investigate unknowns');
  expect(partial).not.toContain('No known finding within supported coverage');
});

it('withholds malicious path labels, arbitrary literals, declarations and quoted warnings', async () => {
  await fixture("'secret-canary-model'");
  const context = await captureReportContext(target, {});
  context.scan.integrations[0]!.locations[0]!.file = `"><img src=x onerror=alert(1)>.ts`;
  context.scan.integrations[0]!.declaredVersions[0]!.version = 'SECRET_CANARY';
  context.scan.warnings.push('Unreadable "SYNTHETIC_SECRET_CANARY".', 'Directory /Users/private/SECRET_CANARY unreadable.');
  context.scan.compatibility.assessments[0]!.unknowns.push(`<script>alert('x')</script>`);
  const html = formatHtml(buildReportView(context.scan, context.metadata));
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('SYNTHETIC_SECRET_CANARY');
  expect(html).not.toContain('secret-canary-model');
  expect(html).not.toContain('/Users/');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('[withheld for privacy]');
});

it('has a matching static CSS CSP, no scripts/resources/forms and accessible navigation', async () => {
  const context = await captureReportContext(target, {});
  const html = formatHtml(buildReportView(context.scan, context.metadata));
  const css = /<style>([\s\S]*?)<\/style>/u.exec(html)![1]!;
  expect(html).toContain(`style-src 'sha256-${createHash('sha256').update(css).digest('base64')}'`);
  expect(html).toContain("script-src 'none'");
  expect(html).toContain("connect-src 'none'");
  expect(html).not.toMatch(/<(?:script|img|iframe|form|link)\b|\son\w+=|\sstyle=/iu);
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('Skip to report');
  expect(html).toContain('aria-labelledby=');
  expect(css).toContain('@media(max-width:700px)');
  expect(css).toContain(':focus-visible');
});

it('counts affected and potential assessments as attention while keeping unknowns separate', async () => {
  await fixture("'text-davinci-003'");
  const context = await captureReportContext(target, {});
  let view = buildReportView(context.scan, context.metadata);
  expect(view.stats).toEqual([
    { label: 'Files scanned', value: 2 }, { label: 'Supported integrations', value: 1 },
    { label: 'Assessments requiring attention', value: 1 }, { label: 'Unknown assessments', value: 0 },
  ]);
  context.scan.compatibility.assessments[0]!.status = 'potentially-affected';
  view = buildReportView(context.scan, context.metadata);
  expect(view.stats[2]!.value).toBe(2);
  await fixture('process.env.DEMO_MODEL');
  const dynamic = await captureReportContext(target, {});
  view = buildReportView(dynamic.scan, dynamic.metadata);
  expect(view.stats[2]!.value).toBe(0);
  expect(view.stats[3]!.value).toBe(2);
  expect(formatHtml(view)).toContain('Unknown assessments also require review');
});

it('puts findings ahead of fingerprints and budgets without losing existing evidence', async () => {
  await fixture("'text-davinci-003'");
  const context = await captureReportContext(target, {});
  const view = buildReportView(context.scan, context.metadata);
  const original = structuredClone(view);
  const html = formatHtml(view);
  expect(view).toEqual(original);
  expect(html).toContain('<h1>API Compatibility Report</h1>');
  expect(html).toContain('Local, read-only analysis of supported third-party API integrations.');
  const headings = ['summary', 'findings', 'actions', 'integrations', 'technical'].map((id) => html.indexOf(`<h2 id="${id}">`));
  expect(headings.every((position) => position >= 0)).toBe(true);
  expect([...headings].sort((a, b) => a - b)).toEqual(headings);
  expect(html.indexOf('Catalog content fingerprint (SHA-256)')).toBeGreaterThan(headings[4]!);
  expect(html.indexOf('Scan budget: maxFiles')).toBeGreaterThan(headings[4]!);
  for (const section of view.sections) for (const block of section.blocks) {
    for (const row of block.rows) {
      expect(html).toContain(escapeHtml(row.label));
      expect(html).toContain(escapeHtml(row.value));
    }
    for (const note of block.notes) expect(html).toContain(escapeHtml(note));
  }
});

it('keeps every finding uncertainty and relevant actions visible outside disclosures', async () => {
  await fixture('process.env.DEMO_MODEL');
  const context = await captureReportContext(target, {});
  const view = buildReportView(context.scan, context.metadata);
  const html = formatHtml(view);
  const cards = [...html.matchAll(/<article class="finding [^"]*">([\s\S]*?)<\/article>/gu)];
  expect(cards).toHaveLength(2);
  const summaries = view.sections.find((section) => section.kind === 'findings')!.blocks.map((block) => block.finding!);
  cards.forEach((match, index) => {
    const visible = match[1]!.split('<details>')[0]!;
    expect(visible).toContain('Recommended actions');
    expect(visible).toContain('dynamic');
    expect(visible).toContain('index.ts:1');
    for (const note of summaries[index]!.uncertainty) expect(visible).toContain(escapeHtml(note));
    expect(visible).toContain('Investigate dynamic configuration');
    expect(match[1]).toContain('<summary>Full assessment evidence and provenance</summary>');
  });
});

it('prioritizes affected findings and uses semantic color only for the appropriate status', async () => {
  await fixture("'text-davinci-003'");
  const context = await captureReportContext(target, {});
  const html = formatHtml(buildReportView(context.scan, context.metadata));
  expect(html.indexOf('finding tone-affected')).toBeLessThan(html.indexOf('finding tone-neutral'));
  expect(html).toContain('badge tone-affected">Affected');
  expect(html).toContain('badge tone-neutral">Not affected by this change');
  expect(html).toContain('class="generation">Report generated</span>');
  expect(html).not.toMatch(/(?:class="[^"]*(?:success|generation|green)[^"]*"[^>]*>)(?:Affected|Unknown|Not affected)/u);
  expect(html).toContain('Installed runtime version</dt><dd>Unknown — not runtime verified');
});

it('provides native disclosures, keyboard focus and mobile/tablet/print CSS without scripts', async () => {
  const context = await captureReportContext(target, {});
  const html = formatHtml(buildReportView(context.scan, context.metadata));
  expect(html).toContain('<details class="technical"><summary>Scanner, catalog and scan identity</summary>');
  expect(html).toContain('<summary>Scan scope, coverage and resource ceilings</summary>');
  expect(html).not.toMatch(/<details[^>]*\bopen\b/u);
  expect(html).toContain('@media(max-width:900px)');
  expect(html).toContain('@media(max-width:700px)');
  expect(html).toContain('@media print');
  expect(html).toContain('summary:focus-visible');
  expect(html).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');
  expect(html).not.toMatch(/<script|\son\w+=|\sstyle=/iu);
});

it('keeps semantic status text contrast at least 4.5:1 in the actual embedded CSS', async () => {
  const context = await captureReportContext(target, {});
  const html = formatHtml(buildReportView(context.scan, context.metadata));
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../gu)!.map((channel) => Number.parseInt(channel, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  for (const selector of ['.generation', '.badge.tone-affected', '.badge.tone-potential', '.badge.tone-unknown,.badge.tone-neutral']) {
    const declarations = html.slice(html.indexOf(`${selector}{`) + selector.length + 1).split('}')[0]!;
    const background = /background:(#[a-f0-9]{6})/u.exec(declarations)![1]!;
    const color = /(?:^|;)color:(#[a-f0-9]{6})/u.exec(declarations)![1]!;
    const values = [luminance(background), luminance(color)].sort((a, b) => b - a);
    expect((values[0]! + 0.05) / (values[1]! + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});

it('scans real malicious filenames without putting their markup or source in HTML', async () => {
  await writeFile(resolve(target, 'bad"><img src=x onerror=alert(1)>.ts'), "import OpenAI from 'openai'; throw new Error('DO_NOT_EXECUTE');");
  await writeFile(resolve(target, 'private-SECRET_CANARY.ts'), "import Stripe from 'stripe';");
  const result = await cli(['scan', target, '--html', resolve(sandbox, 'names.html')]);
  expect(result.code).toBe(0);
  const html = await readFile(resolve(sandbox, 'names.html'), 'utf8');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('onerror=');
  expect(html).not.toContain('SECRET_CANARY');
  expect(html).not.toContain('DO_NOT_EXECUTE');
  expect(html).toContain('[withheld for privacy]');
});

it('does not turn invalid official URLs into clickable links', async () => {
  await fixture("'text-davinci-003'");
  const context = await captureReportContext(target, {});
  context.scan.compatibility.assessments[0]!.officialSourceUrl = 'javascript:alert(1)';
  context.scan.compatibility.assessments[1]!.officialSourceUrl = 'https://developers.openai.com/api?token=CANARY';
  const html = formatHtml(buildReportView(context.scan, context.metadata));
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('token=CANARY');
});

it('preserves existing positional parsing and rejects HTML on catalog commands', async () => {
  const positional = await cli(['scan', target, '--', '--html', 'out.html']);
  expect(positional.code).toBe(1);
  const catalog = await cli(['changes', '--html', resolve(sandbox, 'out.html')]);
  expect(catalog.code).toBe(1);
  expect(catalog.stdout).toBe('');
});

it('exposes incomplete assessment and graph coverage even when discovery finished', async () => {
  await fixture("'text-davinci-003'");
  const context = await captureReportContext(target, {});
  context.scan.compatibility.coverage.assessmentsTruncated = true;
  context.scan.compatibility.coverage.evidenceDisplayTruncated = true;
  context.scan.compatibility.coverage.complete = false;
  context.scan.analysis!.complete = false;
  const html = formatHtml(buildReportView(context.scan, context.metadata));
  expect(html).toContain('partial coverage — investigate unknowns');
  expect(html).toContain('Assessments truncated</dt><dd>true');
  expect(html).toContain('Evidence display truncated</dt><dd>true');
  expect(html).toContain('Module coverage</dt><dd>Unknown / partial');
});

it('bounds projection input and final output without truncating findings', async () => {
  const context = await captureReportContext(target, {});
  context.scan.warnings = ['x'.repeat(32 * 1024 * 1024 + 1)];
  expect(() => buildReportView(context.scan, context.metadata)).toThrow('input limit');
  context.scan.warnings = [];
  const view = buildReportView(context.scan, context.metadata);
  view.sections[0]!.blocks[0]!.notes.push('<'.repeat(9 * 1024 * 1024));
  expect(() => formatHtml(view)).toThrow('32 MiB');
});

it.each([['--html'], ['--html', '-bad.html'], ['--html', 'a.html', '--html', 'b.html'], ['--html', 'report.ts']])('rejects invalid HTML arguments %j without success stdout', async (...args) => {
  const result = await cli(['scan', target, ...args]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('PatchWRK:');
});

it('executes the real Node CLI with HTML and refuses a second write without altering it', async () => {
  await fixture("'text-davinci-003'");
  const execute = promisify(execFile);
  const args = [resolve('src/cli/index.ts'), 'scan', target, '--json', '--html', resolve(sandbox, 'actual.html')];
  const result = await execute(process.execPath, args);
  expect(JSON.parse(result.stdout).integrations[0].provider).toBe('openai');
  expect(result.stderr).toBe('');
  const before = await readFile(resolve(sandbox, 'actual.html'));
  await expect(execute(process.execPath, args)).rejects.toMatchObject({ code: 1, stdout: '' });
  expect(await readFile(resolve(sandbox, 'actual.html'))).toEqual(before);
});

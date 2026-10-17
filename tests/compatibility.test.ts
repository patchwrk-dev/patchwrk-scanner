import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiChange, ChangeCatalog, ProviderId } from '../src/types/changes.ts';
import type { DeclaredVersion, Integration, ScanReport } from '../src/types/index.ts';
import { parseCatalog } from '../src/changes/catalog.ts';
import { validateChange } from '../src/changes/validation.ts';
import { assessCompatibility, matchingLimits, scanWithCompatibility } from '../src/compatibility/index.ts';
import { parseApiVersionInputs } from '../src/compatibility/api-versions.ts';
import { evaluateSdkVersions, evaluateApiVersion } from '../src/compatibility/versions.ts';
import { formatTerminal, formatJson } from '../src/reports/index.ts';
import { runCli } from '../src/cli/run.ts';
import { defaultLimits } from '../src/scanner/policy.ts';

const execute = promisify(execFile);
const fixture = parseCatalog(await readFile(resolve('tests/fixtures/compatibility/examples.v1.json'), 'utf8'));
function change(provider: ProviderId = 'stripe', reviewed = true): ApiChange {
  const item = structuredClone(fixture.changes.find((record) => record.provider === provider)!);
  if (reviewed) {
    const url = provider === 'stripe' ? 'https://github.com/stripe/stripe-node'
      : provider === 'openai' ? 'https://github.com/openai/openai-node' : 'https://shopify.dev/docs/api/usage/versioning';
    // Test-only review simulation. No real announcement is claimed or shipped.
    item.officialSourceUrl = url;
    item.provenance = { kind: 'official', sources: [{ url, retrievedAt: null }], notes: 'SYNTHETIC TEST ONLY: simulated review metadata, not a real announcement.' };
    item.evidence = [{ sourceUrl: url, locator: 'Synthetic fixture', excerpt: null }];
    item.verification = { status: 'verified', method: 'manual-official-review', reviewer: 'synthetic-test-reviewer' };
    item.lastReviewedAt = '2025-01-01T00:00:00Z';
  }
  return validateChange(item);
}
function declared(version: string | null = '1.5.0', resolvedVersion: string | null = version, file = 'package.json'): DeclaredVersion {
  return { file, section: 'dependencies', version, status: version === null ? 'unknown' : 'declared',
    resolvedVersion, resolutionStatus: resolvedVersion === null ? 'unknown' : 'lockfile', lockfile: resolvedVersion === null ? null : 'package-lock.json' };
}
function integration(declarations: DeclaredVersion[] = [declared()], provider = 'stripe', packageName = 'stripe'): Integration {
  return { provider, packageName, declaredVersions: declarations, locations: [{ file: 'src/client.ts', line: 1, type: 'esm-import', typeOnly: false }] };
}
function scan(integrations: Integration[] = [integration()], complete = true): ScanReport {
  return { schemaVersion: 2, status: 'discovery', directory: resolve('.'), integrations, warnings: [],
    coverage: { filesScanned: 1, bytesScanned: 100, entriesVisited: 1, filesSkipped: 0, complete, limits: { ...defaultLimits }, limitations: [] } };
}
function catalog(changes: ApiChange[] = [change()]): ChangeCatalog { return { schemaVersion: 1, catalogVersion: '1', changes }; }
function assess(item = change(), evidence = integration(), api: string[] = [], complete = true) {
  return assessCompatibility(scan([evidence], complete), catalog([item]), api).assessments[0]!;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('SDK semver and conservative applicability', () => {
  it.each([
    ['1.0.0', 'affected'], ['1.9.9', 'affected'], ['2.0.0', 'not-affected-by-this-change'],
    ['0.9.9', 'not-affected-by-this-change'], ['1.5.0+build.9', 'affected'],
  ])('evaluates exact recorded version %s as %s', (version, status) => {
    expect(assess(change(), integration([declared(version)])).status).toBe(status);
  });

  it.each([
    ['1.0.0', '<=1.0.0', 'affected'], ['1.0.1', '<=1.0.0', 'not-affected-by-this-change'],
    ['1.0.0', '>1.0.0', 'not-affected-by-this-change'], ['1.0.1', '>1.0.0', 'affected'],
    ['0.2.9', '^0.2.0', 'affected'], ['0.3.0', '^0.2.0', 'not-affected-by-this-change'],
    ['1.2.9', '~1.2.0', 'affected'], ['1.3.0', '~1.2.0', 'not-affected-by-this-change'],
    ['1.0.0-beta.1', '>=1.0.0 <2.0.0', 'not-affected-by-this-change'],
    ['1.0.0-beta.2', '>=1.0.0-beta.1 <1.0.0', 'affected'],
    ['2.0.0', '1.0.0 || 2.0.0', 'affected'],
  ])('evaluates npm boundary %s / %s', (version, range, status) => {
    const item = change(); item.affectedSdks[0]!.versionRange = range;
    expect(assess(item, integration([declared(version)])).status).toBe(status);
  });

  it.each(['^1.0.0', '1.x', '1.5.0', '^9.0.0'])('does not infer installed versions from declaration %s', (version) => {
    expect(assess(change(), integration([declared(version, null)])).status).toBe('potentially-affected');
  });

  it.each([null, 'latest', 'workspace:*', 'git+https://example.invalid/sdk'])('keeps SDK version %s unknown', (version) => {
    expect(assess(change(), integration([declared(version, null)])).status).toBe('unknown');
  });

  it('keeps source-only SDK discovery unknown and preserves evidence', () => {
    const result = assess(change(), integration([]));
    expect(result.status).toBe('unknown');
    expect(result.locations).toEqual(integration().locations);
    expect(result.facts.sdkDeclarations).toEqual([]);
    expect(result.unknowns).toContain('Installed SDK version applicability is unresolved.');
  });

  it('does not accept a stale resolved version that conflicts with its declaration', () => {
    const result = assess(change(), integration([declared('^1.0.0', '2.0.0')]));
    expect(result.status).toBe('potentially-affected');
    expect(result.sdkEvaluation.rationale.join(' ')).toContain('conflicts');
  });

  it('preserves conflicting and mixed manifest evidence instead of selecting a favorable version', () => {
    const sameManifest = [declared('1.0.0'), { ...declared('1.5.0'), section: 'devDependencies' as const }];
    expect(assess(change(), integration(sameManifest)).status).toBe('potentially-affected');
    const multiple = [declared('1.5.0'), declared('2.0.0', '2.0.0', 'apps/other/package.json')];
    expect(assess(change(), integration(multiple)).status).toBe('potentially-affected');
    expect(assess(change(), integration([declared(), declared(null, null, 'apps/unknown/package.json')])).status).toBe('potentially-affected');
  });

  it('does not promote illustrative/unverified/unknown-category metadata to definite conclusions', () => {
    for (const version of ['1.5.0', '2.0.0']) expect(assess(change('stripe', false), integration([declared(version)])).status).toBe('potentially-affected');
    const unverified = change('stripe', false);
    unverified.verification.status = 'unverified'; unverified.provenance.kind = 'unverified';
    expect(assess(unverified).status).toBe('potentially-affected');
    expect(assess({ ...change(), category: 'unknown' }).status).toBe('potentially-affected');
  });

  it('downgrades conclusions for incomplete repository coverage', () => {
    expect(assess(change(), integration(), [], false).status).toBe('potentially-affected');
    expect(assess(change(), integration([declared('2.0.0')]), [], false).status).toBe('potentially-affected');
  });

  it('does not treat unknown constraint values as universal affected ranges', () => {
    const item = change(); item.affectedSdks[0]!.versionRange = null;
    expect(assess(item).status).toBe('unknown');
    item.affectedSdks.push({ packageName: 'stripe', versionRange: '^1.0.0' });
    expect(assess(item).status).toBe('affected');
    expect(assess(item, integration([declared('9.0.0')])).status).toBe('unknown');
  });

  it('handles semver numeric overflow without coercing invalid versions or asserting exclusion', () => {
    const result = evaluateSdkVersions([declared('9999999999999999999999.0.0')], change().affectedSdks, 'stripe');
    expect(result.outcome).toBe('unknown');
  });
});

describe('explicit API input and independent API matching', () => {
  it.each([
    'stripe=2024-06-20', 'stripe=2024-09-30.acacia', 'anthropic=2023-06-01',
    'shopify=2024-07', 'shopify=unstable', 'openai=v1', 'twilio=2010-04-01',
  ])('accepts supported declaration %s without runtime verification', (input) => {
    const result = parseApiVersionInputs([input])[0]!;
    expect(result.origin).toBe('user-declared');
    expect(result.runtimeVerified).toBe(false);
    expect(result.dynamic).toBe(input.endsWith('unstable'));
  });

  it.each([
    '', 'stripe', 'stripe=', '=2024-06-20', 'stripe=2024-06-20=extra',
    'unknown=1', 'stripe=1.2.3', 'stripe=2025-02-30', 'stripe=latest',
    'stripe=2024-09-30.acacia\n', 'shopify=2024-02', 'anthropic=2024-01',
    'openai=gpt-4', 'openai=v2', 'twilio=2024-06-20', 'stripe=../../outside',
    'stripe=https://user:secret@example.invalid',
  ])('rejects malformed/unsupported API input %j', (input) => {
    expect(() => parseApiVersionInputs([input])).toThrow();
  });

  it.each([
    ['stripe=2024-06-20', 'stripe=2024-06-20'],
    ['stripe=2024-06-20', 'stripe=2024-09-30.acacia'],
  ])('rejects duplicate and conflicting provider declarations %j', (...inputs) => {
    expect(() => parseApiVersionInputs(inputs)).toThrow('Duplicate');
  });

  it.each([
    ['2024-06-20', 'affected'], ['2023-10-16', 'not-affected-by-this-change'],
  ])('matches date identifiers by exact equality only: %s', (version, status) => {
    const item = change(); item.affectedSdks = [];
    item.affectedApiVersions = [{ scheme: 'date', versions: ['2024-06-20'], versionRange: null }];
    expect(assess(item, integration(), [`stripe=${version}`]).status).toBe(status);
  });

  it('does not compare date ranges, infer generic semver APIs, or equate Stripe release suffixes', () => {
    const item = change(); item.affectedSdks = [];
    item.affectedApiVersions = [{ scheme: 'date', versions: [], versionRange: '2023-01-01..2025-01-01' }];
    expect(assess(item, integration(), ['stripe=2024-06-20']).status).toBe('unknown');
    item.affectedApiVersions = [{ scheme: 'semver', versions: ['1.0.0'], versionRange: '^1.0.0' }];
    expect(assess(item, integration(), ['stripe=2024-06-20']).status).toBe('unknown');
    item.affectedApiVersions = [{ scheme: 'opaque', versions: ['2024-09-30.acacia'], versionRange: null }];
    expect(assess(item, integration(), ['stripe=2024-09-30.basil']).status).toBe('not-affected-by-this-change');
  });

  it('never substitutes SDK semver for a remote API version', () => {
    const item = change(); item.affectedSdks = [];
    item.affectedApiVersions = [{ scheme: 'semver', versions: ['1.5.0'], versionRange: null }];
    const result = assess(item, integration([declared('1.5.0')]));
    expect(result.status).toBe('unknown');
    expect(result.apiEvaluation.evidenceLevel).toBe('none');
    expect(result.userDeclared).toEqual([]);
  });

  it('does not use a matching API version to settle SDK uncertainty or dimension disagreement', () => {
    const item = change('openai');
    expect(assess(item, integration([declared(null, null)], 'openai', 'openai'), ['openai=v1']).status).toBe('potentially-affected');
    expect(assess(item, integration([declared('9.0.0')], 'openai', 'openai'), ['openai=v1']).status).toBe('potentially-affected');
    expect(assess(item, integration([declared('4.1.0')], 'openai', 'openai'), ['openai=v1']).status).toBe('affected');
  });

  it('keeps dynamic channels uncertain even when a catalog literally lists them', () => {
    const item = change('shopify'); item.affectedApiVersions[0]!.versions = ['unstable'];
    expect(assess(item, integration([], 'shopify', '@shopify/shopify-api'), ['shopify=unstable']).status).toBe('potentially-affected');
  });

  it('cannot exclude a version when an API range or unsupported scheme remains unevaluated', () => {
    const constraints: ApiChange['affectedApiVersions'] = [
      { scheme: 'date', versions: ['2023-10-16'], versionRange: '2023-01-01..2025-01-01' },
    ];
    expect(evaluateApiVersion(parseApiVersionInputs(['stripe=2024-06-20'])[0], constraints).outcome).toBe('unknown');
  });
});

describe('pipeline, transparency, backward compatibility, and security', () => {
  it('evaluates multiple providers deterministically and distinguishes facts, declarations, inferences, and unknowns', () => {
    const records = [change('stripe'), change('openai'), change('shopify')];
    const repository = scan([integration(), integration([declared('4.1.0')], 'openai', 'openai'), integration([], 'shopify', '@shopify/shopify-api')]);
    const inputs = ['openai=v1', 'shopify=2024-07'];
    const summary = assessCompatibility(repository, catalog(records), inputs);
    expect(summary.assessments.map((item) => item.provider)).toEqual(['openai', 'shopify', 'stripe']);
    expect(summary.assessments.every((item) => item.status === 'affected')).toBe(true);
    expect(summary.assessments[0]?.facts.kind).toBe('observed-repository-metadata');
    expect(summary.assessments[0]?.userDeclared[0]?.origin).toBe('user-declared');
    expect(summary.assessments[0]?.inferred.kind).toBe('deterministic-version-comparison');
    expect(summary.assessments[0]?.scope).toBe('documented-version-applicability');
    expect(summary.assessments[0]?.provenance.notes).toContain('SYNTHETIC');
    expect(assessCompatibility(repository, catalog([...records].reverse()), [...inputs].reverse())).toEqual(summary);
  });

  it('returns no-match results without declaring a repository healthy', () => {
    const result = assessCompatibility(scan(), catalog([]), ['openai=v1']);
    expect(result.assessments).toEqual([]);
    expect(result.warnings.join(' ')).toContain('does not establish compatibility');
    expect(result.warnings.join(' ')).toContain('no integration');
    expect(result).not.toHaveProperty('healthy');
    expect(assessCompatibility(scan(), catalog([change('openai')])).assessments).toEqual([]);
    expect(assessCompatibility(scan([integration([], 'stripe', 'unrelated')]), catalog()).assessments).toEqual([]);
  });

  it('keeps empty documented constraints unknown rather than treating them as universal applicability', () => {
    expect(assess({ ...change(), affectedSdks: [], affectedApiVersions: [] }).status).toBe('unknown');
  });

  it('bounds assessments and reports incomplete candidate coverage deterministically', () => {
    const records = Array.from({ length: matchingLimits.maxAssessments + 1 }, (_, index) => ({ ...change(), id: `example.stripe.${String(index).padStart(3, '0')}` }));
    const result = assessCompatibility(scan(), catalog(records));
    expect(result.assessments).toHaveLength(matchingLimits.maxAssessments);
    expect(result.coverage).toMatchObject({ complete: false, assessmentsTruncated: true });
    expect(assessCompatibility(scan(), catalog([...records].reverse()))).toEqual(result);
  });

  it('bounds displayed evidence without discarding versions from matching', () => {
    const item = integration(Array.from({ length: 101 }, (_, index) => declared('1.5.0', '1.5.0', `apps/${index}/package.json`)));
    item.declaredVersions[100] = declared('2.0.0', '2.0.0', 'apps/100/package.json');
    item.locations = Array.from({ length: 101 }, (_, index) => ({ file: `src/${index}.ts`, line: 1, type: 'esm-import', typeOnly: false }));
    const summary = assessCompatibility(scan([item]), catalog());
    expect(summary.assessments[0]?.status).toBe('potentially-affected');
    expect(summary.assessments[0]?.facts.sdkDeclarations).toHaveLength(100);
    expect(summary.assessments[0]?.locations).toHaveLength(100);
    expect(summary.coverage.evidenceDisplayTruncated).toBe(true);
    expect(item.declaredVersions).toHaveLength(101);
  });

  it('rejects malicious catalog data and getters before matching', () => {
    expect(() => assessCompatibility(scan(), JSON.parse('{"__proto__":{}}'))).toThrow();
    const getter = vi.fn();
    const repository = scan();
    Object.defineProperty(repository, 'integrations', { get: getter, enumerable: true });
    expect(() => assessCompatibility(repository, catalog())).toThrow('unsafe property');
    expect(getter).not.toHaveBeenCalled();
  });

  it('preserves source references and reports per-change exclusion without production breakage or health claims', () => {
    const original = scan([integration([declared('2.0.0')])]);
    const before = structuredClone(original);
    const report = { ...original, compatibility: assessCompatibility(original, catalog()) };
    const text = formatTerminal(report);
    expect(text).toContain('Not affected by this change');
    expect(text).toContain('https://github.com/stripe/stripe-node');
    expect(text).toContain('Observed SDK metadata');
    expect(text).toContain('Inferred comparison');
    expect(text).toContain('not establish endpoint usage, production breakage, or repository health');
    expect(JSON.parse(formatJson(report)).schemaVersion).toBe(2);
    expect(JSON.parse(formatJson(report)).compatibility.schemaVersion).toBe(1);
    expect(original).toEqual(before);
  });

  it('scans, loads the supplied offline catalog, and produces assessment evidence without network or file modifications', async () => {
    const sandbox = await mkdtemp(resolve('.scanner-test-compatibility-'));
    try {
      const manifest = '{"dependencies":{"stripe":"^1.0.0"},"scripts":{"scan":"exit 99"}}';
      const lock = JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { stripe: '^1.0.0' } }, 'node_modules/stripe': { version: '1.5.0' } } });
      await writeFile(resolve(sandbox, 'package.json'), manifest);
      await writeFile(resolve(sandbox, 'package-lock.json'), lock);
      await writeFile(resolve(sandbox, 'client.js'), "const Stripe=require('stripe'); throw new Error('MUST NOT EXECUTE');");
      const fetch = vi.fn(() => { throw new Error('Network forbidden'); });
      vi.stubGlobal('fetch', fetch);
      const httpCall = vi.spyOn(http, 'request').mockImplementation(() => { throw new Error('Network forbidden'); });
      const httpsCall = vi.spyOn(https, 'request').mockImplementation(() => { throw new Error('Network forbidden'); });
      const report = await scanWithCompatibility(sandbox, { catalog: { load: async () => catalog() }, apiVersionInputs: ['stripe=2024-06-20'] });
      expect(report.compatibility.assessments[0]?.status).toBe('affected');
      expect(report.compatibility.assessments[0]?.facts.sdkDeclarations[0]?.resolvedVersion).toBe('1.5.0');
      expect(await readFile(resolve(sandbox, 'package.json'), 'utf8')).toBe(manifest);
      expect(await readFile(resolve(sandbox, 'package-lock.json'), 'utf8')).toBe(lock);
      expect(fetch).not.toHaveBeenCalled(); expect(httpCall).not.toHaveBeenCalled(); expect(httpsCall).not.toHaveBeenCalled();
      const output: string[] = [];
      expect(await runCli(['scan', sandbox, '--json', '--api-version', 'stripe=2024-06-20'],
        { stdout: (value) => output.push(value), stderr: () => expect.fail('Unexpected stderr') }, { catalog: { load: async () => catalog() } })).toBe(0);
      expect(JSON.parse(output[0]!).compatibility.assessments[0].status).toBe('affected');
    } finally { await rm(sandbox, { recursive: true, force: true }); }
  });

  it.each([
    ['--api-version'], ['--api-version', 'stripe=latest'],
    ['--api-version', 'stripe=2024-06-20', '--api-version', 'stripe=2024-06-20'],
    ['--api-version', 'stripe=2024-06-20', '--api-version', 'stripe=2024-09-30.acacia'],
    ['--max-files', '1', '--max-files', '2'],
  ])('rejects malformed or duplicate CLI scan inputs %j', async (...args) => {
    const stderr: string[] = [];
    expect(await runCli(['scan', '.', ...args], { stdout: () => expect.fail('No stdout expected'), stderr: (value) => stderr.push(value) })).toBe(1);
    expect(stderr).toHaveLength(1);
  });

  it('supports API input and additive scanner schema through the actual Node CLI', async () => {
    const result = await execute(process.execPath, [resolve('src/cli/index.ts'), 'scan', resolve('tests/fixtures/empty'), '--json', '--api-version', 'stripe=2024-06-20']);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ schemaVersion: 2, status: 'discovery', integrations: [], compatibility: { schemaVersion: 1, assessments: [] } });
    expect(report.compatibility.apiVersionDeclarations[0]).toMatchObject({ origin: 'user-declared', runtimeVerified: false });
    expect(result.stderr).toBe('');
  });
});

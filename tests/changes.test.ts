import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateChange, isSemverRange } from '../src/changes/validation.ts';
import { deduplicateChanges, loadCatalogFile, LocalChangeCatalog, parseCatalog, validateCatalog } from '../src/changes/catalog.ts';
import { classifyChange } from '../src/changes/classification.ts';
import { listChanges } from '../src/changes/index.ts';
import { sourceAdapters } from '../src/changes/adapters.ts';
import { isOfficialUrl } from '../src/changes/sources.ts';
import { candidateMatcher } from '../src/changes/matching.ts';
import { formatChangesJson, formatChangesTerminal } from '../src/reports/changes.ts';
import { runCli } from '../src/cli/run.ts';
import { changeCategories } from '../src/types/changes.ts';
import type { ApiChange, ChangeCatalog } from '../src/types/changes.ts';
import type { Integration } from '../src/types/index.ts';

const execute = promisify(execFile);
const exampleText = await readFile(resolve('tests/fixtures/changes/illustrative.v1.json'), 'utf8');
const exampleCatalog = parseCatalog(exampleText);
function example(): ApiChange { return structuredClone(exampleCatalog.changes.find((change) => change.provider === 'stripe')!); }
function catalog(changes: ApiChange[] = [example()]): ChangeCatalog { return { schemaVersion: 1, catalogVersion: '1', changes }; }
function simulatedReview(): ApiChange {
  // TEST-ONLY simulation of attestation fields, not a verified real announcement.
  const result = example();
  const source = 'https://github.com/stripe/stripe-node';
  result.officialSourceUrl = source;
  result.evidence = [{ sourceUrl: source, locator: 'Synthetic test-only locator', excerpt: null }];
  result.provenance = { kind: 'official', sources: [{ url: source, retrievedAt: '2025-01-02T00:00:00Z' }], notes: 'SYNTHETIC TEST ONLY: simulated review, no real provider announcement.' };
  result.verification = { status: 'verified', method: 'manual-official-review', reviewer: 'synthetic-test-reviewer' };
  result.lastReviewedAt = '2025-01-03T00:00:00Z';
  return result;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('strict change schema', () => {
  it('accepts clearly marked illustrative records without inventing unknown values', () => {
    const input = example();
    const result = validateChange(input);
    expect(result).toEqual(input);
    expect(result.publicationDate).toBeNull();
    expect(result.effectiveDate).toBeNull();
    expect(result.retirementDate).toBeNull();
    expect(result.migrationInstructions).toBeNull();
    expect(result.verification.status).toBe('illustrative');
  });

  it.each(Object.keys(example()))('rejects missing required field %s', (key) => {
    const input = example() as unknown as Record<string, unknown>;
    delete input[key];
    expect(() => validateChange(input)).toThrow('fields');
  });

  it.each([null, [], 1, 'record', {}])('rejects malformed records %j', (input) => {
    expect(() => validateChange(input)).toThrow();
  });

  it('rejects unknown record and nested fields', () => {
    expect(() => validateChange({ ...example(), extra: true })).toThrow();
    expect(() => validateChange({ ...example(), verification: { ...example().verification, extra: true } })).toThrow();
  });

  it('rejects unknown providers and categories', () => {
    expect(() => validateChange({ ...example(), provider: 'unknown-provider' })).toThrow('provider');
    expect(() => validateChange({ ...example(), category: 'maybe-breaking' })).toThrow('category');
  });

  it.each(['2025-02-29', '2024-02-30', '2025-13-01', '0000-01-01', 'yesterday', '2025-1-1'])('rejects impossible or noncanonical dates %s', (date) => {
    for (const field of ['publicationDate', 'effectiveDate', 'retirementDate']) {
      expect(() => validateChange({ ...example(), [field]: date })).toThrow(field);
    }
  });

  it('accepts a real leap day and preserves exact date references', () => {
    expect(validateChange({ ...example(), publicationDate: '2024-02-29' }).publicationDate).toBe('2024-02-29');
  });

  it.each(['2025-01-01', '2025-01-01T24:00:00Z', '2025-02-30T00:00:00Z', '2025-01-01T00:00:00+01:00'])('rejects invalid review timestamps %s', (value) => {
    expect(() => validateChange({ ...example(), lastReviewedAt: value })).toThrow('lastReviewedAt');
  });

  it.each(['*', '1.2.3', '^1.2.3', '~1.2.3', '>=1.0.0 <2.0.0', '1.0.0 || 2.0.0', '1.0.0-beta.1+build.1'])('accepts supported semver range %s', (range) => {
    expect(isSemverRange(range)).toBe(true);
    expect(validateChange({ ...example(), affectedSdks: [{ packageName: 'stripe', versionRange: range }] }).affectedSdks[0]?.versionRange).toBe(range);
  });

  it.each(['latest', 'not-a-range', '01.2.3', '1.2', '1.2.3-01', '1.2.3-beta.', '>=', 'file:../sdk', '1.2.3||2.0.0'])('rejects unsupported or invalid version range %s', (range) => {
    expect(() => validateChange({ ...example(), affectedSdks: [{ packageName: 'stripe', versionRange: range }] })).toThrow('versionRange');
  });

  it('keeps SDK ranges and API constraints separate and validates date, semver, and opaque schemes', () => {
    const result = validateChange({
      ...example(), affectedApiVersions: [
        { scheme: 'date', versions: ['2025-01-01'], versionRange: '2024-01-01..2025-01-01' },
        { scheme: 'semver', versions: ['1.0.0'], versionRange: '>=1.0.0 <2.0.0' },
        { scheme: 'opaque', versions: ['v1beta'], versionRange: null },
      ],
    });
    expect(result.affectedSdks[0]?.versionRange).toBe('^1.0.0');
    expect(result.affectedApiVersions).toHaveLength(3);
  });

  it.each([
    { scheme: 'date', versions: ['2025-02-30'], versionRange: null },
    { scheme: 'date', versions: [], versionRange: '2025-01-01..2024-01-01' },
    { scheme: 'semver', versions: ['v1'], versionRange: null },
    { scheme: 'semver', versions: [], versionRange: 'garbage' },
    { scheme: 'opaque', versions: ['v1'], versionRange: 'v1..v2' },
    { scheme: 'date', versions: [], versionRange: null },
  ])('rejects invalid API constraints %j', (constraint) => {
    expect(() => validateChange({ ...example(), affectedApiVersions: [constraint] })).toThrow();
  });

  it('rejects false official authorities and mismatched evidence/provenance', () => {
    expect(() => validateChange({ ...example(), officialSourceUrl: 'https://stripe.com.attacker.invalid/change' })).toThrow('authority');
    expect(() => validateChange({ ...example(), evidence: [{ sourceUrl: 'https://example.invalid/unlisted', locator: null, excerpt: null }] })).toThrow('provenance');
  });

  it('requires review attestation and matching official evidence for verified metadata', () => {
    expect(validateChange(simulatedReview()).verification.status).toBe('verified');
    for (const change of [
      { ...simulatedReview(), lastReviewedAt: null },
      { ...simulatedReview(), officialSourceUrl: null },
      { ...simulatedReview(), evidence: [] },
      { ...simulatedReview(), verification: { status: 'verified', method: null, reviewer: null } },
    ]) expect(() => validateChange(change)).toThrow('Invalid change data');
  });

  it('accepts explicitly unverified source records without promoting them', () => {
    const input = example();
    input.provenance.kind = 'unverified';
    input.verification.status = 'unverified';
    expect(validateChange(input).verification.status).toBe('unverified');
    expect(classifyChange(input).category).toBe('unknown');
    expect(() => validateChange({ ...input, verification: { ...input.verification, method: 'manual-official-review' } })).toThrow('attestation');
  });

  it('rejects illustrative/verification mismatches', () => {
    expect(() => validateChange({ ...example(), verification: { status: 'unverified', method: null, reviewer: null } })).toThrow('illustrative');
  });

  it('rejects false official provenance even when verification is unverified', () => {
    const input = example();
    input.verification.status = 'unverified';
    input.provenance.kind = 'official';
    expect(() => validateChange(input)).toThrow('official provenance authority');
  });

  it('rejects extended sparse arrays rather than silently dropping entries', () => {
    const input = example();
    const targets: unknown[] = new Array(1);
    Object.assign(targets, { extra: { kind: 'endpoint', value: '/example' } });
    expect(() => validateChange({ ...input, targets })).toThrow('extended array');
  });

  it.each(['javascript:alert(1)', 'http://stripe.com/change', 'https://user:token@stripe.com/change', 'https://stripe.com:8443/change', 'https://stripe.com/\nchange'])('rejects unsafe source URL %s', (value) => {
    const input = example();
    input.provenance.sources[0]!.url = value;
    input.evidence[0]!.sourceUrl = value;
    expect(() => validateChange(input)).toThrow('URL');
  });

  it('rejects control sequences, oversized fields, getters, prototype keys, and nested structures without execution', () => {
    expect(() => validateChange({ ...example(), title: '\u001b[31m malicious' })).toThrow('title');
    expect(() => validateChange({ ...example(), description: 'x'.repeat(10_001) })).toThrow('string size');
    const getter = vi.fn(() => 'stripe');
    const input = { ...example() };
    Object.defineProperty(input, 'provider', { get: getter, enumerable: true });
    expect(() => validateChange(input)).toThrow('unsafe property');
    expect(getter).not.toHaveBeenCalled();
    expect(() => validateChange(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow('unsafe property');
    expect({}).not.toHaveProperty('polluted');
    let nested: unknown = {};
    for (let index = 0; index < 30; index++) nested = { nested };
    expect(() => validateChange(nested)).toThrow('structure limit');
  });
});

describe('catalog ingestion and deterministic normalization', () => {
  it('loads the curated production catalog', async () => {
    const loaded = await new LocalChangeCatalog().load();
    expect(loaded).toMatchObject({ schemaVersion: 1, catalogVersion: '3' });
    expect(loaded.changes).toHaveLength(4);
    expect(loaded.changes.every((change) => change.verification.status === 'verified')).toBe(true);
  });

  it('loads example providers deterministically and preserves references', () => {
    const result = parseCatalog(exampleText);
    expect(result.changes.map((change) => change.provider)).toEqual(['anthropic', 'openai', 'shopify', 'stripe', 'twilio']);
    expect(result.changes.every((change) => change.verification.status === 'illustrative')).toBe(true);
    expect(result.changes.find((change) => change.provider === 'stripe')?.evidence[0]?.sourceUrl).toBe('https://example.invalid/patchwrk-examples/stripe');
    const reversed = { ...result, changes: [...result.changes].reverse() };
    expect(JSON.stringify(validateCatalog(reversed))).toBe(JSON.stringify(result));
  });

  it('rejects duplicate identifiers even when identical or cross-provider', () => {
    expect(() => deduplicateChanges([example(), example()])).toThrow('duplicate change identifier');
    const second = structuredClone(exampleCatalog.changes[0]!);
    second.id = example().id;
    expect(() => validateCatalog(catalog([example(), second]))).toThrow('duplicate change identifier');
  });

  it('rejects unsupported schemas, catalog fields, malformed JSON, and duplicate JSON keys', () => {
    expect(() => validateCatalog({ ...catalog(), schemaVersion: 2 })).toThrow('schemaVersion');
    expect(() => validateCatalog({ ...catalog(), extra: true })).toThrow('fields');
    expect(() => parseCatalog('{bad')).toThrow('catalog JSON');
    expect(() => parseCatalog('{"schemaVersion":1,"schemaVersion":1,"catalogVersion":"1","changes":[]}')).toThrow('duplicate JSON property');
  });

  it('enforces byte, record, and depth limits before accepting data', () => {
    expect(() => parseCatalog(exampleText, { maxBytes: 50 })).toThrow('byte limit');
    expect(() => validateCatalog(exampleCatalog, { maxRecords: 2 })).toThrow('record limit');
    expect(() => parseCatalog('['.repeat(25) + '0' + ']'.repeat(25))).toThrow('structure limit');
    expect(() => parseCatalog(exampleText, { maxBytes: 0 })).toThrow('limits');
  });

  it('normalizes array ordering without mutating callers or original URLs', () => {
    const input = example();
    input.targets = [{ kind: 'sdk-symbol', value: 'Z' }, { kind: 'endpoint', value: '/a' }];
    input.affectedApiVersions = [{ scheme: 'opaque', versions: ['v2', 'v1', 'v1'], versionRange: null }];
    const before = structuredClone(input);
    const normalized = validateChange(input);
    expect(input).toEqual(before);
    expect(normalized.targets[0]?.kind).toBe('endpoint');
    expect(normalized.affectedApiVersions[0]?.versions).toEqual(['v1', 'v2']);
    expect(validateChange(normalized)).toEqual(normalized);
  });

  it('rejects unsafe file paths, symlinks/hardlinks, invalid UTF-8, and oversized files', async () => {
    const sandbox = await mkdtemp(resolve('.scanner-test-catalog-'));
    try {
      const file = resolve(sandbox, 'catalog.json');
      await writeFile(file, exampleText);
      expect((await loadCatalogFile(file)).changes).toHaveLength(5);
      await expect(loadCatalogFile(file, { maxBytes: 10 })).rejects.toThrow('catalog file');
      await symlink(file, resolve(sandbox, 'linked.json'));
      await expect(loadCatalogFile(resolve(sandbox, 'linked.json'))).rejects.toThrow('catalog file');
      await mkdir(resolve(sandbox, 'sub'));
      await symlink(resolve(sandbox, 'sub'), resolve(sandbox, 'linked-dir'));
      await expect(loadCatalogFile(resolve(sandbox, 'linked-dir', 'catalog.json'))).rejects.toThrow('catalog path');
      await link(file, resolve(sandbox, 'hardlinked.json'));
      await expect(loadCatalogFile(resolve(sandbox, 'hardlinked.json'))).rejects.toThrow('catalog file');
      await writeFile(resolve(sandbox, 'invalid.json'), Buffer.from([0xff]));
      await expect(loadCatalogFile(resolve(sandbox, 'invalid.json'))).rejects.toThrow('UTF-8');
      await expect(loadCatalogFile('../outside.json')).rejects.toThrow('catalog path');
      await expect(loadCatalogFile('/catalog.json')).rejects.toThrow('root path');
      await expect(loadCatalogFile(resolve(sandbox, 'missing.json'))).rejects.toThrow('unreadable');
    } finally { await rm(sandbox, { recursive: true, force: true }); }
  });
});

describe('classification and adapters', () => {
  it.each(changeCategories)('uses verified metadata for category %s, never description keywords', (category) => {
    const change = simulatedReview();
    change.category = category;
    change.description = 'breaking deprecation security SDK release nonbreaking';
    expect(classifyChange(change).category).toBe(category);
    expect(classifyChange(change).verificationStatus).toBe('verified');
  });

  it('preserves insufficient evidence and illustrative classification uncertainty', () => {
    const change = example();
    change.description = 'Official verified breaking security notice';
    expect(classifyChange(change)).toEqual({ category: 'unknown', declaredCategory: 'sdk-update', verificationStatus: 'illustrative', basis: 'illustrative' });
    expect(classifyChange({ ...simulatedReview(), category: 'unknown' }).basis).toBe('insufficient-evidence');
  });

  it('prepares five offline-only adapters without fetch methods or implicit verification', () => {
    expect(sourceAdapters).toHaveLength(5);
    for (const adapter of sourceAdapters) {
      const input = exampleCatalog.changes.find((change) => change.provider === adapter.provider)!;
      expect(adapter.normalize(input).verification.status).toBe('illustrative');
      expect(adapter.retrievalPlan.mode).toBe('offline-only');
      expect(adapter).not.toHaveProperty('fetch');
      expect(adapter.isOfficialUrl('https://example.invalid/announcement')).toBe(false);
    }
    expect(() => sourceAdapters.find((adapter) => adapter.provider === 'openai')!.normalize(example())).toThrow('mismatch');
    expect(isOfficialUrl('stripe', 'https://github.com/stripe/stripe-node')).toBe(true);
    expect(isOfficialUrl('stripe', 'https://github.com/attacker/stripe')).toBe(false);
    expect(isOfficialUrl('stripe', 'https://stripe.com.attacker.invalid')).toBe(false);
  });
});

describe('reporting, CLI, and matching boundary', () => {
  it('filters providers and emits stable JSON and explicit offline warnings', async () => {
    const repository = { load: async () => validateCatalog(exampleCatalog) };
    const all = await listChanges(repository);
    const filtered = await listChanges(repository, 'stripe');
    expect(all.changes).toHaveLength(5);
    expect(filtered.changes).toHaveLength(1);
    expect(JSON.parse(formatChangesJson(filtered))).toEqual(filtered);
    expect(formatChangesTerminal(filtered)).toContain('SYNTHETIC EXAMPLE ONLY');
    expect(formatChangesTerminal(filtered)).toContain('Published: unknown');
    expect(formatChangesTerminal(filtered)).toContain('Official source: "unknown"');
    expect(formatChangesTerminal(filtered)).toContain('https://example.invalid/patchwrk-examples/stripe');
    expect(formatChangesJson(await listChanges(repository))).toBe(formatChangesJson(all));
    await expect(listChanges(repository, 'unknown')).rejects.toThrow('provider');
  });

  it('handles empty catalogs and never makes HTTP, HTTPS, or fetch calls', async () => {
    const fetch = vi.fn(() => { throw new Error('Network forbidden'); });
    vi.stubGlobal('fetch', fetch);
    const httpRequest = vi.spyOn(http, 'request').mockImplementation(() => { throw new Error('Network forbidden'); });
    const httpsRequest = vi.spyOn(https, 'request').mockImplementation(() => { throw new Error('Network forbidden'); });
    expect((await listChanges({ load: async () => catalog([]) })).changes).toEqual([]);
    expect((await listChanges()).changes).toHaveLength(4);
    for (const adapter of sourceAdapters) adapter.normalize(exampleCatalog.changes.find((change) => change.provider === adapter.provider)!);
    expect(fetch).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it.each([['changes'], ['changes', '--json'], ['changes', '--provider', 'stripe', '--json'], ['changes', '--help'], ['changes', '-h']])('supports CLI command %j', async (...args) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(await runCli(args, { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) })).toBe(0);
    expect(stderr).toEqual([]);
    if (args.includes('--json')) {
      const report = JSON.parse(stdout[0]!);
      expect(report).toMatchObject({ schemaVersion: 1, status: 'offline-catalog' });
      expect(report.changes).toHaveLength(args.includes('--provider') ? 2 : 4);
    }
    else expect(stdout[0]).toContain('offline');
  });

  it.each([['--provider'], ['--provider', 'unknown'], ['--provider', 'stripe', '--provider', 'twilio'], ['--bad'], ['directory'], ['--max-files', '1']])('rejects invalid changes arguments %j', async (...args) => {
    const errors: string[] = [];
    const outputs: string[] = [];
    expect(await runCli(['changes', ...args], { stdout: (value) => outputs.push(value), stderr: (value) => errors.push(value) })).toBe(1);
    expect(outputs).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('loads its own catalog independently of working directory through the actual CLI', async () => {
    const result = await execute(process.execPath, [resolve('src/cli/index.ts'), 'changes', '--json'], { cwd: resolve('tests') });
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'offline-catalog', catalogCoverage: { recordCount: 4, liveMonitoring: false } });
  });

  it('keeps candidate matching separate from SDK/API range assessment and risk conclusions', () => {
    const integration: Integration = {
      provider: 'stripe', packageName: 'stripe', locations: [], declaredVersions: [{
        file: 'package.json', section: 'dependencies', version: '99.0.0', status: 'declared',
        resolvedVersion: '99.0.0', resolutionStatus: 'lockfile', lockfile: 'package-lock.json',
      }],
    };
    const change = example();
    change.affectedApiVersions = [{ scheme: 'date', versions: ['2025-01-01'], versionRange: null }];
    const result = candidateMatcher.candidates({ integration, observedApiVersions: [] }, exampleCatalog.changes.map((item) => item.provider === 'stripe' ? change : item));
    expect(result).toEqual([{ changeId: change.id, provider: 'stripe', packageName: 'stripe', basis: 'provider-and-package', sdkVersionAssessment: 'not-evaluated', apiVersionAssessment: 'not-evaluated', riskConclusion: null }]);
    expect(candidateMatcher.candidates({ integration: { ...integration, packageName: 'unrelated' }, observedApiVersions: [] }, [change])).toEqual([]);
    expect(candidateMatcher.candidates({ integration, observedApiVersions: [] }, [{ ...change, affectedSdks: [] }])[0]?.basis).toBe('provider-only');
  });
});

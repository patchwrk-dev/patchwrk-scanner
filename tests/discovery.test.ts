import { chmod, link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { scanRepository } from '../src/scanner/index.ts';
import { analyzeSource } from '../src/scanner/source.ts';
import { providers } from '../src/providers/index.ts';
import { runCli } from '../src/cli/run.ts';

let sandbox: string;
let repository: string;
beforeEach(async () => {
  sandbox = await mkdtemp(resolve('.scanner-test-'));
  repository = resolve(sandbox, 'repo');
  await mkdir(repository);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(sandbox, { recursive: true, force: true });
});

async function fixture(name: string): Promise<void> {
  const source = resolve('tests/fixtures/discovery', name);
  for (const file of await readdir(source)) {
    await writeFile(resolve(repository, file.replace(/\.fixture$/u, '')), await readFile(resolve(source, file)));
  }
}

async function write(name: string, content: string): Promise<void> {
  const path = resolve(repository, name);
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, content);
}

function npmLock(version: 2 | 3 = 3, declaration = '^17.0.0', resolvedVersion = '17.2.1'): string {
  return JSON.stringify({
    lockfileVersion: version,
    packages: { '': { dependencies: { stripe: declaration } }, 'node_modules/stripe': { version: resolvedVersion } },
  });
}

describe('dependency and source discovery', () => {
  it('discovers all five providers across all four dependency sections with exact lines', async () => {
    await fixture('all-providers');
    const report = await scanRepository(repository);
    expect(report.integrations.map((item) => item.provider)).toEqual(['anthropic', 'openai', 'shopify', 'stripe', 'twilio']);
    const stripe = report.integrations.find((item) => item.provider === 'stripe')!;
    expect(stripe.declaredVersions).toEqual([{
      file: 'package.json', section: 'dependencies', version: '^17.0.0', status: 'declared',
      resolvedVersion: null, resolutionStatus: 'unknown', lockfile: null,
    }]);
    expect(stripe.locations).toEqual([
      { file: 'clients.ts', line: 1, type: 'esm-import', typeOnly: false },
      { file: 'clients.ts', line: 7, type: 'client-initialization', typeOnly: false },
      { file: 'package.json', line: 2, type: 'dependency', typeOnly: false },
    ]);
    for (const item of report.integrations) {
      expect(item.locations.some((location) => location.type === 'client-initialization')).toBe(true);
      expect(item.declaredVersions[0]?.resolvedVersion).toBeNull();
    }
    expect(report.coverage.complete).toBe(true);
  });

  it('discovers CommonJS bindings, destructuring, and direct Twilio initialization without a manifest', async () => {
    await fixture('commonjs');
    const report = await scanRepository(repository);
    expect(report.integrations).toHaveLength(5);
    expect(report.warnings).toContain('No root package.json found; declared versions may be unknown.');
    for (const item of report.integrations) {
      expect(item.declaredVersions).toEqual([]);
      expect(item.locations.some((location) => location.type === 'commonjs-require')).toBe(true);
      expect(item.locations.some((location) => location.type === 'client-initialization')).toBe(true);
    }
  });

  it('continues source discovery after malformed JSON', async () => {
    await fixture('malformed');
    const report = await scanRepository(repository);
    expect(report.integrations[0]?.provider).toBe('stripe');
    expect(report.integrations[0]?.declaredVersions).toEqual([]);
    expect(report.warnings.join(' ')).toContain('Malformed package.json');
    expect(report.coverage.complete).toBe(false);
  });

  it.each(['[]', 'null', '42', '{"dependencies":null}'])('handles malformed manifest structures %s', async (manifest) => {
    await write('package.json', manifest);
    const report = await scanRepository(repository);
    expect(report.integrations).toEqual([]);
    expect(report.coverage.complete).toBe(false);
  });

  it('keeps unknown values explicit and does not echo unsupported credential-bearing declarations', async () => {
    await fixture('unknown');
    const report = await scanRepository(repository);
    expect(report.integrations.find((item) => item.provider === 'stripe')?.declaredVersions[0]?.version).toBe('*');
    expect(report.integrations.find((item) => item.provider === 'openai')?.declaredVersions[0]?.status).toBe('unknown');
    expect(report.integrations.find((item) => item.provider === 'twilio')?.declaredVersions[0]?.status).toBe('unsupported');
    expect(JSON.stringify(report)).not.toContain('private-token');
    expect(report.integrations.every((item) => item.declaredVersions[0]?.resolvedVersion === null)).toBe(true);
  });

  it('does not treat comments, strings, unrelated dependencies, or similarly named classes as evidence', async () => {
    await fixture('unrelated');
    expect((await scanRepository(repository)).integrations).toEqual([]);
  });

  it('preserves prerelease declarations and records valid prerelease lock versions', async () => {
    await write('package.json', '{"dependencies":{"stripe":"^17.0.0-beta.1"}}');
    await write('package-lock.json', npmLock(3, '^17.0.0-beta.1', '17.0.0-beta.2+build.1'));
    expect((await scanRepository(repository)).integrations[0]?.declaredVersions[0]).toMatchObject({
      version: '^17.0.0-beta.1', status: 'declared', resolvedVersion: '17.0.0-beta.2+build.1',
    });
  });

  it('allows a custom registry and rejects conflicting package entries', async () => {
    await write('package.json', '{"dependencies":{"custom-sdk":"1.0.0"}}');
    const custom = { ...providers[0]!, id: 'custom', packages: ['custom-sdk'] };
    expect((await scanRepository(repository, { providers: [custom] })).integrations[0]?.provider).toBe('custom');
    await expect(scanRepository(repository, { providers: [custom, custom] })).rejects.toThrow('duplicate');
  });

  it('collects multiple declarations without conflating different manifest versions', async () => {
    await write('package.json', '{"dependencies":{"stripe":"^17.0.0"},"devDependencies":{"stripe":"^18.0.0"}}');
    await write('apps/api/package.json', '{"dependencies":{"stripe":"^19.0.0"}}');
    const item = (await scanRepository(repository)).integrations[0]!;
    expect(item.declaredVersions.map((declaration) => declaration.version).sort()).toEqual(['^17.0.0', '^18.0.0', '^19.0.0']);
    expect(item.declaredVersions.some((declaration) => declaration.file === 'apps/api/package.json')).toBe(true);
  });

  it('skips malformed source and invalid UTF-8 while keeping other evidence', async () => {
    await write('bad.ts', "import Stripe from 'stripe'; const = ;");
    await writeFile(resolve(repository, 'binary.js'), Buffer.from([0xff, 0xfe]));
    await write('good.ts', "import OpenAI from 'openai';");
    const report = await scanRepository(repository);
    expect(report.integrations.map((item) => item.provider)).toEqual(['openai']);
    expect(report.warnings.join(' ')).toContain('malformed syntax');
    expect(report.warnings.join(' ')).toContain('not UTF-8');
  });
});

describe('source binding accuracy', () => {
  it.each(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts'])('analyzes .%s files with the Compiler API', (extension) => {
    const result = analyzeSource(`client.${extension}`, "import Stripe from 'stripe'; new Stripe();", providers);
    expect(result.warnings).toEqual([]);
    expect(result.findings.map((finding) => finding.evidence.type)).toEqual(['esm-import', 'client-initialization']);
  });

  it('does not resolve modules or read TypeScript configs/libraries', () => {
    const read = vi.spyOn(ts.sys, 'readFile').mockImplementation(() => { throw new Error('Forbidden filesystem read'); });
    expect(analyzeSource('client.ts', "import OpenAI from 'openai'; new OpenAI();", providers).findings).toHaveLength(2);
    expect(read).not.toHaveBeenCalled();
  });

  it('respects shadowed SDK and require bindings and ignores helper functions', () => {
    const result = analyzeSource('client.ts', `
import Stripe from 'stripe';
import { toFile } from 'openai';
function local(Stripe: any, require: any) { new Stripe(); require('twilio')(); }
toFile('inert');
new Stripe();
`, providers);
    expect(result.findings.filter((finding) => finding.evidence.type === 'client-initialization')).toHaveLength(1);
    expect(result.findings.some((finding) => finding.provider === 'twilio')).toBe(false);
  });

  it('does not claim client initialization for mutable require variables', () => {
    const result = analyzeSource('client.js', "let Stripe = require('stripe'); Stripe = local; new Stripe();", providers);
    expect(result.findings.map((finding) => finding.evidence.type)).toEqual(['commonjs-require']);
  });

  it('supports namespaces and type-only evidence without claiming execution', () => {
    const result = analyzeSource('client.ts', `import * as sdk from 'openai';
import type Anthropic from '@anthropic-ai/sdk';
new sdk.OpenAI();
new Anthropic();`, providers);
    expect(result.findings.filter((finding) => finding.evidence.type === 'client-initialization')).toHaveLength(1);
    expect(result.findings.find((finding) => finding.provider === 'anthropic')?.evidence.typeOnly).toBe(true);
  });

  it('supports TypeScript import-equals requires', () => {
    const result = analyzeSource('client.cts', "import Stripe = require('stripe'); new Stripe();", providers);
    expect(result.findings.map((finding) => finding.evidence.type)).toEqual(['commonjs-require', 'client-initialization']);
  });

  it('warns about dynamic imports/requires and does not guess their providers', () => {
    const result = analyzeSource('client.js', "require(packageName); import('openai');", providers);
    expect(result.findings).toEqual([]);
    expect(result.warnings).toContain('Dynamic imports are not analyzed.');
    expect(result.warnings).toContain('Dynamic require cannot be resolved statically.');
  });
});

describe('resolved versions', () => {
  beforeEach(async () => {
    await write('package.json', '{"dependencies":{"stripe":"^17.0.0"}}');
  });

  it.each([2, 3] as const)('reports npm lockfile v%s versions separately', async (version) => {
    await write('package-lock.json', npmLock(version));
    const declaration = (await scanRepository(repository)).integrations[0]?.declaredVersions[0];
    expect(declaration).toMatchObject({ version: '^17.0.0', resolvedVersion: '17.2.1', resolutionStatus: 'lockfile', lockfile: 'package-lock.json' });
  });

  it('does not guess versions from unsupported pnpm locks', async () => {
    await write('pnpm-lock.yaml', 'lockfileVersion: 9.0\nstripe: 99.0.0');
    const report = await scanRepository(repository);
    expect(report.coverage.filesScanned).toBe(1);
    expect(report.integrations[0]?.declaredVersions[0]).toMatchObject({ resolvedVersion: null, resolutionStatus: 'unsupported' });
    expect(report.warnings.join(' ')).toContain('Unsupported lockfile');
  });

  it.each([
    '{bad',
    '{"lockfileVersion":1,"dependencies":{"stripe":{"version":"17.2.1"}}}',
    npmLock(3, '^18.0.0'),
    npmLock(3, '^17.0.0', '^17.2.1'),
    npmLock(3, '^17.0.0', '17.2.1-01'),
    npmLock(3, '^17.0.0', '17.2.1-beta.'),
    JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { stripe: '^17.0.0' } }, 'node_modules/stripe': { version: '17.2.1', link: true } } }),
  ])('leaves unreliable resolved versions unknown', async (lock) => {
    await write('package-lock.json', lock);
    const report = await scanRepository(repository);
    expect(report.integrations[0]?.declaredVersions[0]?.resolvedVersion).toBeNull();
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('honors shrinkwrap priority without falling back when it is malformed', async () => {
    await write('package-lock.json', npmLock());
    await write('npm-shrinkwrap.json', '{bad');
    expect((await scanRepository(repository)).integrations[0]?.declaredVersions[0]?.resolvedVersion).toBeNull();
  });

  it('uses valid shrinkwrap ahead of package-lock', async () => {
    await write('package-lock.json', npmLock());
    await write('npm-shrinkwrap.json', npmLock(3, '^17.0.0', '17.3.0'));
    expect((await scanRepository(repository)).integrations[0]?.declaredVersions[0]).toMatchObject({ resolvedVersion: '17.3.0', lockfile: 'npm-shrinkwrap.json' });
  });

  it('does not fall back to package-lock when shrinkwrap is an unsafe symlink', async () => {
    await write('package-lock.json', npmLock());
    const outside = resolve(sandbox, 'outside-lock.json');
    await writeFile(outside, npmLock(3, '^17.0.0', '17.3.0'));
    await symlink(outside, resolve(repository, 'npm-shrinkwrap.json'));
    expect((await scanRepository(repository)).integrations[0]?.declaredVersions[0]?.resolvedVersion).toBeNull();
  });
});

describe('filesystem policy and limits', () => {
  it('excludes environment, credential, generated, build, dependency, hidden, and unrelated files', async () => {
    const code = "import OpenAI from 'openai';";
    for (const name of ['.env', '.env.js', 'credentials.js', 'secrets/key.ts', '.hidden/client.js',
      'dist/client.js', 'build/client.ts', 'node_modules/client.js', 'vendor/client.js',
      'generated/client.ts', 'client.generated.ts', 'client.min.js', 'client.d.ts', 'data.txt']) await write(name, code);
    const report = await scanRepository(repository);
    expect(report.integrations).toEqual([]);
    expect(report.coverage.filesScanned).toBe(0);
    expect(report.coverage.bytesScanned).toBe(0);
  });

  it('skips generated source headers with a coverage warning', async () => {
    await write('client.ts', "// @generated\nimport OpenAI from 'openai';");
    const report = await scanRepository(repository);
    expect(report.integrations).toEqual([]);
    expect(report.warnings.join(' ')).toContain('Generated source header');
  });

  it('does not follow file, directory, or lockfile symlinks outside the selected root', async () => {
    const outside = resolve(sandbox, 'outside');
    await mkdir(outside);
    await writeFile(resolve(outside, 'client.ts'), "import OpenAI from 'openai';");
    await writeFile(resolve(outside, 'package-lock.json'), npmLock());
    await symlink(outside, resolve(repository, 'linked-directory'));
    await symlink(resolve(outside, 'client.ts'), resolve(repository, 'client.ts'));
    await symlink(resolve(outside, 'package-lock.json'), resolve(repository, 'package-lock.json'));
    const report = await scanRepository(repository);
    expect(report.integrations).toEqual([]);
    expect(report.coverage.filesScanned).toBe(0);
    expect(report.warnings.filter((warning) => warning.includes('symbolic link'))).toHaveLength(3);
  });

  it('does not read hardlinked files', async () => {
    const outside = resolve(sandbox, 'outside.js');
    await writeFile(outside, "import OpenAI from 'openai';");
    await link(outside, resolve(repository, 'client.js'));
    const report = await scanRepository(repository);
    expect(report.integrations).toEqual([]);
    expect(report.coverage.bytesScanned).toBe(0);
    expect(report.coverage.complete).toBe(false);
  });

  it('reports unreadable files without throwing or exposing their contents', async () => {
    await write('client.js', "import OpenAI from 'openai';");
    await chmod(resolve(repository, 'client.js'), 0);
    try {
      const report = await scanRepository(repository);
      expect(report.coverage.complete).toBe(false);
      expect(report.integrations).toEqual([]);
      expect(report.warnings.join(' ')).toContain('unreadable');
    } finally {
      await chmod(resolve(repository, 'client.js'), 0o600);
    }
  });

  it('limits file size before reading content', async () => {
    await write('client.js', "import OpenAI from 'openai';");
    const report = await scanRepository(repository, { limits: { maxFileBytes: 8 } });
    expect(report.integrations).toEqual([]);
    expect(report.coverage.bytesScanned).toBe(0);
    expect(report.warnings.join(' ')).toContain('File-size limit');
  });

  it('limits total bytes and makes partial coverage explicit', async () => {
    const code = "import OpenAI from 'openai';";
    await write('first.js', code);
    await write('second.js', code);
    const report = await scanRepository(repository, { limits: { maxTotalBytes: Buffer.byteLength(code) } });
    expect(report.coverage.filesScanned).toBe(1);
    expect(report.coverage.bytesScanned).toBe(Buffer.byteLength(code));
    expect(report.coverage.complete).toBe(false);
    expect(report.warnings.join(' ')).toContain('Total-byte limit');
  });

  it('limits file count', async () => {
    await write('one.js', "require('stripe');");
    await write('two.js', "require('openai');");
    const report = await scanRepository(repository, { limits: { maxFiles: 1 } });
    expect(report.coverage.filesScanned).toBe(1);
    expect(report.coverage.complete).toBe(false);
    expect(report.warnings.join(' ')).toContain('File-count limit');
  });

  it('bounds enumeration of unrelated entries', async () => {
    for (let index = 0; index < 4; index++) await write(`${index}.txt`, 'unrelated');
    const report = await scanRepository(repository, { limits: { maxEntries: 2 } });
    expect(report.coverage.entriesVisited).toBe(2);
    expect(report.warnings.join(' ')).toContain('Entry-count limit');
  });

  it('bounds recursion depth', async () => {
    await write('one/two/client.js', "require('openai');");
    const report = await scanRepository(repository, { limits: { maxDepth: 1 } });
    expect(report.integrations).toEqual([]);
    expect(report.warnings.join(' ')).toContain('Depth limit');
  });

  it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid limits %s', async (maxFiles) => {
    await expect(scanRepository(repository, { limits: { maxFiles } })).rejects.toThrow('positive safe integers');
  });

  it('accepts CLI budgets and returns valid JSON', async () => {
    await write('client.ts', "import OpenAI from 'openai';");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(['scan', repository, '--json', '--max-file-bytes', '8'], {
      stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value),
    });
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0]!).coverage.limits.maxFileBytes).toBe(8);
  });

  it.each([['--max-files'], ['--max-files', '0'], ['--max-depth', '999'], ['--max-total-bytes', 'no']])('rejects invalid CLI budget %j', async (...args) => {
    const errors: string[] = [];
    expect(await runCli(['scan', repository, ...args], { stdout: () => undefined, stderr: (value) => errors.push(value) })).toBe(1);
    expect(errors).toHaveLength(1);
  });
});

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run.ts';
import { scanRepository } from '../src/scanner/index.ts';

let sandbox: string;
let empty: string;

beforeEach(async () => {
  sandbox = await mkdtemp(resolve('.scanner-test-'));
  empty = resolve(sandbox, 'empty');
  await mkdir(empty);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

async function cli(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

describe('CLI', () => {
  it.each([['--help'], ['scan', '--help'], ['-h'], []])('shows help for %j', async (...args) => {
    const result = await cli(args);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: patchwrk scan [directory]');
    expect(result.stdout).toContain('--json');
    expect(result.stderr).toBe('');
  });

  it('scans an empty directory', async () => {
    const result = await cli(['scan', empty]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Integrations: 0');
  });

  it('produces valid, truthful JSON', async () => {
    const result = await cli(['scan', empty, '--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 2,
      directory: empty,
      status: 'discovery',
      integrations: [],
      warnings: ['No root package.json found; declared versions may be unknown.'],
      coverage: { complete: true, filesScanned: 0, bytesScanned: 0 },
    });
  });

  it('defaults to the working directory', async () => {
    const result = await cli(['scan', '--json']);
    expect(JSON.parse(result.stdout).directory).toBe(process.cwd());
  });

  it.each([['bogus'], ['scan', '--bad'], ['scan', 'a', 'b']])('rejects invalid arguments %j', async (...args) => {
    const result = await cli(args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('PatchWRK:');
  });

  it('handles missing directories with a failure status', async () => {
    const result = await cli(['scan', resolve(sandbox, 'missing'), '--json']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('does not exist');
  });
});

describe('path safety', () => {
  it.each(['/', '../outside', '', 'bad\0path'])('rejects unsafe path %j', async (path) => {
    await expect(scanRepository(path)).rejects.toThrow();
  });

  it('rejects a file target', async () => {
    const file = resolve(sandbox, 'file.txt');
    await writeFile(file, 'inert fixture');
    await expect(scanRepository(file)).rejects.toThrow('must be a directory');
  });

  it('rejects target and ancestor symlinks', async () => {
    const link = resolve(sandbox, 'link');
    await symlink(empty, link, 'dir');
    await mkdir(resolve(empty, 'nested'));
    await expect(scanRepository(link)).rejects.toThrow('Symbolic link');
    await expect(scanRepository(resolve(link, 'nested'))).rejects.toThrow('Symbolic link');
  });

  it('does not follow entries or execute scanned code', async () => {
    await symlink(resolve(sandbox, 'missing'), resolve(empty, 'unsafe-link'));
    await writeFile(resolve(empty, 'package.json'), '{"scripts":{"scan":"exit 99"}}');
    await writeFile(resolve(empty, 'index.js'), 'throw new Error("must never execute")');
    expect((await scanRepository(empty)).integrations).toEqual([]);
  });
});

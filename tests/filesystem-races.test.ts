import { mkdir, mkdtemp, open, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { scanRepository } from '../src/scanner/index.ts';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let sandbox: string;
let repository: string;
beforeEach(async () => {
  vi.mocked(open).mockReset().mockImplementation(actual.open);
  sandbox = await mkdtemp(resolve('.scanner-test-'));
  repository = resolve(sandbox, 'repo');
  await mkdir(repository);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(sandbox, { recursive: true, force: true });
});

it('fails closed when a file becomes an outside symlink between lstat and open', async () => {
  const file = resolve(repository, 'client.js');
  const outside = resolve(sandbox, 'outside.js');
  await writeFile(file, "require('stripe');");
  await writeFile(outside, "require('openai');");
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    await rename(file, resolve(repository, 'original.txt'));
    await symlink(outside, file);
    return actual.open(path, flags, mode);
  });
  const report = await scanRepository(repository);
  expect(report.integrations).toEqual([]);
  expect(report.coverage.bytesScanned).toBe(0);
  expect(report.coverage.complete).toBe(false);
});

it('checks ancestor identities before reading an opened descriptor after directory replacement', async () => {
  const directory = resolve(repository, 'src');
  const outside = resolve(sandbox, 'outside');
  await mkdir(directory);
  await mkdir(outside);
  await writeFile(resolve(directory, 'client.js'), "require('stripe');");
  await writeFile(resolve(outside, 'client.js'), "require('openai');");
  const read = vi.fn();
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    await rename(directory, resolve(repository, 'old-src'));
    await symlink(outside, directory);
    const handle = await actual.open(path, flags, mode);
    vi.spyOn(handle, 'read').mockImplementation(read);
    return handle;
  });
  const report = await scanRepository(repository);
  expect(read).not.toHaveBeenCalled();
  expect(report.integrations).toEqual([]);
  expect(report.coverage.bytesScanned).toBe(0);
});

it('discards evidence when a file grows while reading and never exceeds the reserved bytes', async () => {
  const file = resolve(repository, 'client.js');
  const code = "require('stripe');";
  await writeFile(file, code);
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    const handle = await actual.open(path, flags, mode);
    const originalRead = handle.read.bind(handle);
    vi.spyOn(handle, 'read').mockImplementationOnce(async (...args: Parameters<typeof handle.read>) => {
      await writeFile(file, code + ' '.repeat(1_000));
      return originalRead(...args);
    });
    return handle;
  });
  const report = await scanRepository(repository, { limits: { maxTotalBytes: Buffer.byteLength(code) } });
  expect(report.integrations).toEqual([]);
  expect(report.coverage.bytesScanned).toBeLessThanOrEqual(Buffer.byteLength(code));
  expect(report.coverage.complete).toBe(false);
});

import { lstat, open, readFile, writeFile, mkdtemp, mkdir, symlink, link, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { writeNewArtifact, maxHtmlBytes } from '../src/artifacts/filesystem.ts';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let sandbox: string;
beforeEach(async () => {
  vi.mocked(open).mockReset().mockImplementation(actual.open);
  sandbox = await mkdtemp(resolve('.scanner-test-artifact-'));
});
afterEach(async () => { vi.restoreAllMocks(); await rm(sandbox, { recursive: true, force: true }); });

it('creates only a new explicitly selected HTML file with private permissions', async () => {
  const file = resolve(sandbox, 'report.html');
  await writeNewArtifact(file, '<html>actual report</html>');
  expect(await readFile(file, 'utf8')).toBe('<html>actual report</html>');
  expect((await lstat(file)).mode & 0o777).toBe(0o600);
  await expect(writeNewArtifact(file, 'replacement')).rejects.toThrow('not saved');
  expect(await readFile(file, 'utf8')).toBe('<html>actual report</html>');
});

it.each(['../report.html', 'bad\0.html', '/report.ts', 'package.json', 'source.ts', ''])('refuses unsafe or non-HTML destination %j', async (path) => {
  await expect(writeNewArtifact(path, 'data')).rejects.toThrow('not saved');
});

it('rejects existing links, directory destinations, missing parents and linked ancestors', async () => {
  const original = resolve(sandbox, 'original.html');
  await writeFile(original, 'original');
  await symlink(original, resolve(sandbox, 'symlink.html'));
  await link(original, resolve(sandbox, 'hardlink.html'));
  await mkdir(resolve(sandbox, 'directory.html'));
  await symlink(sandbox, resolve(sandbox, 'parent'));
  for (const name of ['symlink.html', 'hardlink.html', 'directory.html', 'missing/report.html', 'parent/report.html']) {
    await expect(writeNewArtifact(resolve(sandbox, name), 'replacement')).rejects.toThrow('not saved');
  }
  expect(await readFile(original, 'utf8')).toBe('original');
});

it('allows only one concurrent creator and bounds output size', async () => {
  const file = resolve(sandbox, 'race.html');
  const results = await Promise.allSettled([writeNewArtifact(file, 'first'), writeNewArtifact(file, 'second')]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  await expect(writeNewArtifact(resolve(sandbox, 'large.html'), 'x'.repeat(maxHtmlBytes + 1))).rejects.toThrow('32 MiB');
});

it('detects ancestor replacement before writing but documents creation race residual', async () => {
  const parent = resolve(sandbox, 'parent');
  const outside = resolve(sandbox, 'other');
  await mkdir(parent); await mkdir(outside);
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    await rename(parent, resolve(sandbox, 'old-parent'));
    await symlink(outside, parent);
    return actual.open(path, flags, mode);
  });
  await expect(writeNewArtifact(resolve(parent, 'report.html'), 'must not write')).rejects.toThrow('not saved');
  // Portable Node cannot stop creation via a swapped ancestor. No content was written.
  expect(await readFile(resolve(outside, 'report.html'), 'utf8')).toBe('');
});

it('does not delete a replaced path after a failed write', async () => {
  const file = resolve(sandbox, 'replaced.html');
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    const handle = await actual.open(path, flags, mode);
    vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
      await rename(file, resolve(sandbox, 'old.html'));
      await writeFile(file, 'unrelated replacement');
      throw new Error('interrupted');
    });
    return handle;
  });
  await expect(writeNewArtifact(file, 'new')).rejects.toThrow('incomplete file');
  expect(await readFile(file, 'utf8')).toBe('unrelated replacement');
});

it('closes interrupted writes and never claims success or leaks OS error paths', async () => {
  let closed = false;
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    const handle = await actual.open(path, flags, mode);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementation(async () => { closed = true; await close(); });
    vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('/Users/PRIVATE_SECRET disk full'));
    return handle;
  });
  await expect(writeNewArtifact(resolve(sandbox, 'partial.html'), 'new')).rejects.toThrow('not saved');
  expect(closed).toBe(true);
  expect(await readFile(resolve(sandbox, 'partial.html'), 'utf8')).toBe('');
});

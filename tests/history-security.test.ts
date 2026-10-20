import { mkdtemp, mkdir, chmod, writeFile, readFile, rm, symlink, link, open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { LocalScanHistoryRepository } from '../src/history/repository.ts';
import { captureReportContext } from '../src/reports/context.ts';
import { buildReportView } from '../src/reports/view.ts';
import { buildSavedScan, parseHistory, validateSavedScan, historyLimits } from '../src/history/validation.ts';

vi.mock('node:fs/promises', async (importOriginal) => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, open: vi.fn(actual.open), unlink: vi.fn(actual.unlink) }; });
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let sandbox: string; let history: string;
beforeEach(async () => { vi.mocked(open).mockReset().mockImplementation(actual.open); vi.mocked(unlink).mockReset().mockImplementation(actual.unlink); sandbox = await mkdtemp(resolve('.scanner-test-history-security-')); history = resolve(sandbox, 'history'); });
afterEach(async () => { vi.restoreAllMocks(); await rm(sandbox, { recursive: true, force: true }); });
async function setup() {
  const project = await LocalScanHistoryRepository.init(history); const repo = await LocalScanHistoryRepository.open(history);
  const target = resolve(sandbox, 'synthetic'); await mkdir(target);
  const context = await captureReportContext(target, {}); const record = buildSavedScan(context.scan, buildReportView(context.scan, context.metadata), project.projectId);
  return { repo, record };
}

it.each(['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"__proto__":{}}', '{"constructor":{}}', '[] trailing'])('rejects ambiguous or malformed history JSON %s', (text) => { expect(() => parseHistory(text)).toThrow(); });
it('rejects excessive depth, nodes/bytes, unknown fields, dates, statuses and privacy-bearing values', async () => {
  expect(() => parseHistory('['.repeat(65) + '0' + ']'.repeat(65))).toThrow();
  expect(() => parseHistory(' '.repeat(historyLimits.maxRecordBytes + 1))).toThrow();
  const { record } = await setup();
  for (const mutation of [
    (r: typeof record) => { (r as unknown as Record<string, unknown>).sourceCode = 'private'; },
    (r: typeof record) => { r.savedAt = '2026-02-30T00:00:00.000Z'; },
    (r: typeof record) => { r.schemaVersion = 2 as never; },
    (r: typeof record) => { r.snapshot.sections[0]!.blocks[0]!.notes.push('/Users/private/SECRET'); },
    (r: typeof record) => { r.snapshot.sections[0]!.blocks[0]!.notes.push('/tmp/private-canary'); },
    (r: typeof record) => { r.snapshot.sections[0]!.blocks[0]!.notes.push('sk-proj-synthetic_canary_value_123'); },
    (r: typeof record) => { r.snapshot.stats[0]!.value = -1; },
    (r: typeof record) => { r.snapshot.sections[0]!.blocks[0]!.sourceUrl = 'javascript:alert(1)'; },
  ]) { const copy = structuredClone(record); mutation(copy); expect(() => validateSavedScan(copy)).toThrow(); }
  const getter = vi.fn(); const data = structuredClone(record); Object.defineProperty(data, 'snapshot', { get: getter });
  expect(() => validateSavedScan(data)).toThrow(); expect(getter).not.toHaveBeenCalled();
});

it('rejects traversal, linked ancestors, permissive directories and nonempty initialization', async () => {
  await expect(LocalScanHistoryRepository.init('../outside')).rejects.toThrow();
  await mkdir(history, { mode: 0o755 }); await chmod(history, 0o755); await expect(LocalScanHistoryRepository.init(history)).rejects.toThrow();
  await chmod(history, 0o700); await writeFile(resolve(history, 'existing.txt'), 'inert'); await expect(LocalScanHistoryRepository.init(history)).rejects.toThrow();
  const parent = resolve(sandbox, 'linked'); await symlink(history, parent);
  await expect(LocalScanHistoryRepository.open(parent)).rejects.toThrow();
});

it('refuses symlink/hardlink records and never deletes their targets', async () => {
  const { repo, record } = await setup(); await repo.save(record);
  const path = resolve(history, `${record.scanId}.json`); const outside = resolve(sandbox, 'outside.json');
  await rename(path, outside); await symlink(outside, path);
  await expect(repo.get(record.scanId)).rejects.toThrow(); await expect(repo.remove(record.scanId, true)).rejects.toThrow();
  expect(await readFile(outside, 'utf8')).toContain(record.scanId);
  await actual.unlink(path); await link(outside, path);
  await expect(repo.get(record.scanId)).rejects.toThrow(); await expect(repo.remove(record.scanId, true)).rejects.toThrow();
  expect(await readFile(outside, 'utf8')).toContain(record.scanId);
});

it('fails closed on changed marker and world-readable records', async () => {
  const { repo, record } = await setup(); await repo.save(record);
  const path = resolve(history, `${record.scanId}.json`); await chmod(path, 0o644); await expect(repo.get(record.scanId)).rejects.toThrow();
  await chmod(path, 0o600); await writeFile(resolve(history, 'project.json'), JSON.stringify({ schemaVersion: 1, projectId: randomUUID() }));
  await expect(repo.list()).rejects.toThrow(); await expect(repo.remove(record.scanId, true)).rejects.toThrow();
});

it('fails fast on active/interrupted mutex without clearing it automatically', async () => {
  const { repo, record } = await setup(); await mkdir(resolve(history, '.history-lock'), { mode: 0o700 });
  await expect(repo.save(record)).rejects.toThrow(); await expect(repo.list()).rejects.toThrow();
  await expect(repo.prune({ keepLast: 0 }, true)).rejects.toThrow();
});

it('bounds sparse oversized/corrupt records and aggregate storage without guessing contents', async () => {
  const { repo, record } = await setup();
  const large = resolve(history, `${randomUUID()}.json`); const handle = await actual.open(large, 'wx', 0o600); await handle.truncate(historyLimits.maxRecordBytes + 1); await handle.close();
  expect((await repo.list()).warnings).toHaveLength(1);
  for (let i = 0; i < 3; i++) { const handle = await actual.open(resolve(history, `unknown-${i}`), 'wx', 0o600); await handle.truncate(100 * 1024 * 1024); await handle.close(); }
  await expect(repo.save(record)).rejects.toThrow(); await expect(repo.list()).rejects.toThrow();
});

it('reports actual partial deletion when a later unlink fails', async () => {
  const { repo, record } = await setup(); const second = structuredClone(record); second.scanId = randomUUID(); second.savedAt = '2025-01-01T00:00:00.000Z';
  record.savedAt = '2024-01-01T00:00:00.000Z'; await repo.save(record); await repo.save(second);
  vi.mocked(unlink).mockImplementationOnce(actual.unlink).mockRejectedValueOnce(new Error('synthetic failure'));
  const result = await repo.prune({ keepLast: 0 }, true); expect(result.deleted).toHaveLength(1); expect(result.failed).toHaveLength(1);
  expect((await repo.list()).records).toHaveLength(1);
});

it('closes interrupted writes and leaves an incomplete record without deleting replacements', async () => {
  const { repo, record } = await setup(); let closed = false;
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    // save first reads the marker only during open(), already completed; listing sees no records.
    const handle = await actual.open(...args); const close = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementation(async () => { closed = true; await close(); });
    vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('synthetic disk full'));
    return handle;
  });
  await expect(repo.save(record)).rejects.toThrow(); expect(closed).toBe(true);
  expect((await repo.list()).warnings).toHaveLength(1);
});

it('discards a record if replaced by a symlink between inspection and opening', async () => {
  const { repo, record } = await setup(); await repo.save(record);
  const path = resolve(history, `${record.scanId}.json`); const outside = resolve(sandbox, 'outside.json');
  await writeFile(outside, 'must not read', { mode: 0o600 });
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    await rename(path, resolve(history, 'old-record'));
    await symlink(outside, path);
    return actual.open(...args);
  });
  await expect(repo.get(record.scanId)).rejects.toThrow('unsafe');
  expect(await readFile(outside, 'utf8')).toBe('must not read');
});

it('coordinates concurrent writers and never overwrites an immutable UUID', async () => {
  const { repo, record } = await setup(); const second = structuredClone(record); second.scanId = randomUUID();
  const results = await Promise.allSettled([repo.save(record), repo.save(second)]);
  expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
  const listing = await repo.list(); expect(listing.records.length).toBeGreaterThanOrEqual(1); expect(listing.records.length).toBeLessThanOrEqual(2);
  for (const saved of listing.records) await expect(repo.save(saved)).rejects.toThrow();
});

it('returns successful deletion IDs even if the owned lock cannot be released afterward', async () => {
  const { repo, record } = await setup(); await repo.save(record);
  vi.mocked(unlink).mockImplementationOnce(async (path) => {
    await actual.unlink(path);
    await writeFile(resolve(history, '.history-lock', 'unexpected'), 'synthetic obstruction', { mode: 0o600 });
  });
  const result = await repo.remove(record.scanId, true);
  expect(result.deleted).toEqual([record.scanId]); expect(result.lockCleanupFailed).toBe(true);
  expect(result.warnings.join(' ')).toContain('cleanup failed');
});

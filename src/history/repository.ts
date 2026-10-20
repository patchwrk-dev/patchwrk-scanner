import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, opendir, rmdir, unlink } from 'node:fs/promises';
import { resolve, dirname, parse, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { historyLimits, parseHistory, validateProject, validateSavedScan, uuid } from './validation.ts';
import type { HistoryProject, HistoryListing, SavedScan, HistoryDeletion } from '../types/history.ts';

const marker = 'project.json';
const mutex = '.history-lock';
const failure = () => new Error('History operation failed: use an initialized private, stable, non-symlink directory and valid record/project IDs. Records may be missing, corrupt, busy, unsafe or over budget. Inspect privately; no automatic cleanup or overwrite is performed.');
const identity = (stat: Stats) => `${stat.dev}:${stat.ino}`;
const stamp = (stat: Stats) => `${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
function privateEntry(stat: Stats, mode: number): void {
  if ((stat.mode & 0o777) !== mode || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw failure();
}
async function ancestors(path: string): Promise<string> {
  let current = parse(path).root; const entries: string[] = [];
  for (const component of path.slice(current.length).split(sep).filter(Boolean)) {
    current = resolve(current, component); const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
    entries.push(identity(stat));
  }
  return entries.join('/');
}
function directory(input: string): string {
  if (!input || input.includes('\0') || input.split(/[\\/]/u).includes('..')) throw failure();
  const path = resolve(input); if (path === parse(path).root || dirname(path) === parse(path).root) throw failure();
  return path;
}

/** Dedicated private directory, immutable records, bounded reads; not a hostile-filesystem sandbox. */
export class LocalScanHistoryRepository {
  private readonly root: string;
  private readonly rootIdentity: string;
  readonly project: HistoryProject;
  private readonly markerStamp: string | null;
  private constructor(root: string, rootIdentity: string, project: HistoryProject, markerStamp: string | null = null) {
    this.root = root; this.rootIdentity = rootIdentity; this.project = Object.freeze({ ...project }); this.markerStamp = markerStamp;
  }

  static async init(input: string): Promise<HistoryProject> {
    try {
      const root = directory(input); await ancestors(dirname(root));
      try { await mkdir(root, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = await lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure(); privateEntry(stat, 0o700);
      const repo = new LocalScanHistoryRepository(root, await ancestors(root), { schemaVersion: 1, projectId: randomUUID() });
      await repo.lock(async () => {
        const handle = await opendir(root); let count = 0;
        try { for await (const entry of handle) { if (++count > 1 || entry.name !== mutex) throw failure(); } } finally { await handle.close().catch(() => undefined); }
        await repo.write(marker, JSON.stringify(repo.project));
      });
      return repo.project;
    } catch { throw failure(); }
  }
  static async open(input: string, projectId?: string): Promise<LocalScanHistoryRepository> {
    try {
      const root = directory(input); const stat = await lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure(); privateEntry(stat, 0o700);
      const repo = new LocalScanHistoryRepository(root, await ancestors(root), { schemaVersion: 1, projectId: '' });
      const read = await repo.read(marker, 4096);
      const project = validateProject(parseHistory(read.text));
      if (projectId !== undefined && uuid(projectId) !== project.projectId) throw failure();
      return new LocalScanHistoryRepository(root, repo.rootIdentity, project, stamp(read.stat));
    } catch { throw failure(); }
  }
  private async guard(): Promise<void> {
    if (await ancestors(this.root) !== this.rootIdentity) throw failure();
    const stat = await lstat(this.root); privateEntry(stat, 0o700);
    if (this.markerStamp !== null) {
      const project = await lstat(resolve(this.root, marker));
      if (!project.isFile() || project.isSymbolicLink() || project.nlink !== 1 || stamp(project) !== this.markerStamp) throw failure();
      privateEntry(project, 0o600);
    }
  }
  private async read(name: string, maxBytes = historyLimits.maxRecordBytes): Promise<{ text: string; stat: Stats; hash: string }> {
    await this.guard(); const path = resolve(this.root, name); const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maxBytes) throw failure(); privateEntry(before, 0o600);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat(); await this.guard();
      if (!opened.isFile() || opened.nlink !== 1 || identity(opened) !== identity(before) || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) throw failure(); privateEntry(opened, 0o600);
      const data = Buffer.alloc(opened.size); let offset = 0;
      while (offset < data.length) { const result = await handle.read(data, offset, data.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
      const after = await handle.stat(); const current = await lstat(path); await this.guard();
      if (offset !== opened.size || identity(current) !== identity(opened) || current.isSymbolicLink() || current.nlink !== 1 || after.nlink !== 1 || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || current.mode !== opened.mode || stamp(current) !== stamp(after)) throw failure();
      privateEntry(current, 0o600);
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), stat: after, hash: createHash('sha256').update(data).digest('hex') };
    } finally { await handle.close(); }
  }
  private async write(name: string, text: string): Promise<void> {
    if (Buffer.byteLength(text, 'utf8') > historyLimits.maxRecordBytes) throw failure();
    await this.guard(); const path = resolve(this.root, name);
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const opened = await handle.stat();
      const verify = async () => { await this.guard(); const stat = await lstat(path); const fd = await handle.stat(); if (identity(stat) !== identity(opened) || stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || fd.nlink !== 1) throw failure(); privateEntry(stat, 0o600); };
      await verify(); await handle.writeFile(text); await handle.sync(); await verify();
      if ((await handle.stat()).size !== Buffer.byteLength(text, 'utf8')) throw failure();
    } finally { await handle.close(); }
  }
  private async lock<T>(operation: () => Promise<T>): Promise<T> {
    await this.guard(); const lockPath = resolve(this.root, mutex);
    await mkdir(lockPath, { mode: 0o700 }); const lockStat = await lstat(lockPath);
    const release = async () => {
      // Never remove an unrelated replacement or auto-clear an interrupted lock.
      await this.guard(); const current = await lstat(lockPath);
      if (identity(current) !== identity(lockStat) || !current.isDirectory() || current.isSymbolicLink()) throw failure();
      await rmdir(lockPath);
    };
    let result: T;
    try { await this.guard(); privateEntry(lockStat, 0o700); result = await operation(); }
    catch (error) { await release().catch(() => undefined); throw error; }
    try { await release(); } catch {
      if (result && typeof result === 'object' && 'deleted' in result && 'warnings' in result) {
        const deletion = result as unknown as HistoryDeletion;
        deletion.lockCleanupFailed = true;
        deletion.warnings.push('Write lock cleanup failed; actual deletion results above remain valid. Inspect the private directory before retrying.');
      } else throw failure();
    }
    return result;
  }
  async get(scanId: string): Promise<SavedScan> {
    uuid(scanId);
    try {
      const saved = validateSavedScan(parseHistory((await this.read(`${uuid(scanId)}.json`)).text));
      if (saved.scanId !== scanId || saved.projectId !== this.project.projectId) throw failure(); return saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('History record is missing or its directory is unavailable.', { cause: error });
      throw new Error('History record is corrupt, unsupported or unsafe; no record content was displayed.', { cause: error });
    }
  }
  private async listing(locked = false): Promise<HistoryListing> {
    await this.guard(); const records: SavedScan[] = []; const warnings: string[] = []; let bytes = 0; let count = 0; let unknown = 0;
    const before = stamp(await lstat(this.root));
    const handle = await opendir(this.root);
    try {
      for await (const entry of handle) {
        if (++count > historyLimits.maxEntries) throw failure();
        if (entry.name === mutex) { if (!locked) throw failure(); continue; }
        await this.guard(); const stat = await lstat(resolve(this.root, entry.name));
        if (stat.isFile()) bytes += stat.size;
        if (bytes > historyLimits.maxTotalBytes) throw failure();
        if (entry.name === marker) continue;
        const match = /^([a-f0-9-]{36})\.json$/u.exec(entry.name);
        if (!match) { unknown++; continue; }
        try { uuid(match[1]); records.push(await this.get(match[1]!)); }
        catch { warnings.push(`Record ${match[1]} is unreadable, corrupt, unsafe or unsupported; left untouched.`); }
      }
    } finally { await handle.close().catch(() => undefined); }
    await this.guard();
    if (stamp(await lstat(this.root)) !== before) throw failure();
    if (unknown) warnings.push(`${unknown} unrecognized entries left untouched; filenames withheld.`);
    records.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.scanId.localeCompare(b.scanId));
    return { schemaVersion: 1, projectId: this.project.projectId, records, warnings, bytes };
  }
  async list(): Promise<HistoryListing> { try { return await this.listing(); } catch { throw failure(); } }
  async save(input: SavedScan): Promise<string> {
    try {
      const record = validateSavedScan(input); if (record.projectId !== this.project.projectId) throw failure();
      await this.lock(async () => {
        const listing = await this.listing(true); const text = JSON.stringify(record);
        // Entry bound reserves space for marker, lock and the new immutable file.
        const handle = await opendir(this.root); let count = 0;
        try { for await (const entry of handle) { count++; if (!entry.name) throw failure(); } } finally { await handle.close().catch(() => undefined); }
        if (count >= historyLimits.maxEntries || listing.bytes + Buffer.byteLength(text) > historyLimits.maxTotalBytes) throw failure();
        await this.write(`${record.scanId}.json`, text);
      }); return record.scanId;
    } catch { throw failure(); }
  }
  async remove(scanId: string, apply: boolean): Promise<HistoryDeletion> {
    try { uuid(scanId); return await this.lock(async () => { await this.get(scanId); return this.removeSelected([scanId], apply); }); } catch { throw failure(); }
  }
  async prune(policy: { keepLast?: number; olderThanDays?: number }, apply: boolean, now = Date.now()): Promise<HistoryDeletion> {
    try {
      for (const value of Object.values(policy)) if (!Number.isSafeInteger(value) || value! < 0 || value! > 1_000_000) throw failure();
      if (!Object.keys(policy).length || !Number.isFinite(now)) throw failure();
      return await this.lock(async () => {
        const listing = await this.listing(true);
        if (listing.records.some((record) => Date.parse(record.savedAt) > now)) throw failure();
        const ids = listing.records.filter((record, index) => (policy.keepLast === undefined || index >= policy.keepLast)
          && (policy.olderThanDays === undefined || Date.parse(record.savedAt) < now - policy.olderThanDays * 86400_000)).map((record) => record.scanId);
        const outcome = await this.removeSelected(ids, apply); outcome.warnings.push(...listing.warnings); return outcome;
      });
    } catch { throw failure(); }
  }
  private async removeSelected(ids: string[], apply: boolean): Promise<HistoryDeletion> {
    const outcome: HistoryDeletion = { schemaVersion: 1, applied: apply, selected: ids, deleted: [], failed: [], lockCleanupFailed: false, warnings: ['Local unlink is not secure erasure or deletion from independent backups. Preview is not a reservation; apply validates current records.'] };
    if (!apply) return outcome;
    for (const id of ids) {
      try {
        const file = `${uuid(id)}.json`; const first = await this.read(file); const record = validateSavedScan(parseHistory(first.text));
        if (record.scanId !== id || record.projectId !== this.project.projectId) throw failure();
        const current = await this.read(file);
        if (identity(first.stat) !== identity(current.stat) || first.hash !== current.hash) throw failure();
        await this.guard(); await unlink(resolve(this.root, file)); outcome.deleted.push(id); await this.guard();
      } catch { outcome.failed.push(id); break; }
    }
    return outcome;
  }
}

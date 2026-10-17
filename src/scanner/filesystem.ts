import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { dirname, parse, relative, resolve, sep } from 'node:path';
import type { ScanReport } from '../types/index.ts';
import { ignoredName, lockNames, supportedSource } from './policy.ts';

function sameIdentity(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/** Validated metadata plus O_NOFOLLOW and descriptor checks; never uses readFile. */
export class SafeScope {
  readonly encounteredLocks = new Set<string>();
  readonly encounteredManifests = new Set<string>();
  private readonly directories = new Map<string, Stats>();
  private stopped = false;

  private readonly root: string;
  private readonly report: ScanReport;

  constructor(root: string, report: ScanReport) {
    this.root = root;
    this.report = report;
  }

  label(path: string): string {
    return relative(this.root, path).split(sep).join('/') || '.';
  }

  warn(message: string, incomplete = true): void {
    this.report.warnings.push(message);
    if (incomplete) this.report.coverage.complete = false;
  }

  async initialize(): Promise<void> {
    let current = parse(this.root).root;
    for (const part of this.root.slice(current.length).split(sep)) {
      current = resolve(current, part);
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe or changed scan directory.');
      this.directories.set(current, info);
    }
  }

  private assertContained(path: string): void {
    const pathFromRoot = relative(this.root, path);
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || resolve(this.root, pathFromRoot) !== path) {
      throw new Error('Path escaped scan scope.');
    }
  }

  private async checkAncestors(path: string): Promise<void> {
    this.assertContained(path);
    let current = parse(path).root;
    for (const part of path.slice(current.length).split(sep)) {
      current = resolve(current, part);
      const original = this.directories.get(current);
      const info = await lstat(current);
      if (!original || !info.isDirectory() || info.isSymbolicLink() || !sameIdentity(original, info)) {
        throw new Error('Directory identity changed or a symbolic link was encountered.');
      }
    }
  }

  async *files(directory = this.root, depth = 0): AsyncGenerator<string> {
    if (this.stopped) return;
    const coverage = this.report.coverage;
    const limits = coverage.limits;
    if (depth > limits.maxDepth) {
      this.warn(`Depth limit reached at ${JSON.stringify(this.label(directory))}.`);
      return;
    }
    try {
      await this.checkAncestors(directory);
      // Streaming enumeration bounds memory; do not materialize arbitrary directory listings.
      const handle = await opendir(directory);
      try {
        await this.checkAncestors(directory);
        for await (const entry of handle) {
          if (this.stopped) break;
          if (coverage.entriesVisited >= limits.maxEntries) {
            this.warn('Entry-count limit reached; remaining paths were not inspected.');
            this.stopped = true;
            break;
          }
          coverage.entriesVisited++;
          const path = resolve(directory, entry.name);
          this.assertContained(path);
          if (lockNames.has(entry.name)) this.encounteredLocks.add(path);
          if (entry.name === 'package.json') this.encounteredManifests.add(path);
          if (ignoredName(entry.name, entry.isDirectory())) {
            coverage.filesSkipped++;
            continue;
          }
          await this.checkAncestors(directory);
          const info = await lstat(path);
          if (info.isSymbolicLink()) {
            coverage.filesSkipped++;
            this.warn(`Skipped symbolic link ${JSON.stringify(this.label(path))}.`);
          } else if (info.isDirectory()) {
            this.directories.set(path, info);
            yield* this.files(path, depth + 1);
          } else if (info.isFile() && (entry.name === 'package.json' || lockNames.has(entry.name) || supportedSource(entry.name))) {
            if (coverage.filesScanned >= limits.maxFiles) {
              this.warn('File-count limit reached; remaining files were not read.');
              this.stopped = true;
              break;
            }
            yield path;
          } else {
            coverage.filesSkipped++;
          }
        }
      } finally {
        // Async iteration normally closes the handle, including early return.
        await handle.close().catch(() => undefined);
      }
    } catch {
      this.warn(`Directory unreadable or changed: ${JSON.stringify(this.label(directory))}.`);
    }
  }

  async read(path: string): Promise<string | undefined> {
    const coverage = this.report.coverage;
    const limits = coverage.limits;
    try {
      this.assertContained(path);
      await this.checkAncestors(dirname(path));
      const original = await lstat(path);
      if (!original.isFile() || original.isSymbolicLink() || original.nlink !== 1) {
        throw new Error('Unsafe file type or hardlink.');
      }
      if (original.size > limits.maxFileBytes) {
        coverage.filesSkipped++;
        this.warn(`File-size limit: ${JSON.stringify(this.label(path))}.`);
        return undefined;
      }
      if (original.size > limits.maxTotalBytes - coverage.bytesScanned) {
        coverage.filesSkipped++;
        this.warn(`Total-byte limit: ${JSON.stringify(this.label(path))}.`);
        return undefined;
      }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await handle.stat();
        await this.checkAncestors(dirname(path));
        const current = await lstat(path);
        if (!before.isFile() || before.nlink !== 1 || !sameIdentity(original, before)
          || !sameIdentity(current, before) || current.isSymbolicLink()
          || before.size !== original.size || before.mtimeMs !== original.mtimeMs) {
          throw new Error('File changed before reading.');
        }
        const buffer = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < buffer.length) {
          const result = await handle.read(buffer, offset, buffer.length - offset, offset);
          coverage.bytesScanned += result.bytesRead;
          if (result.bytesRead === 0) break;
          offset += result.bytesRead;
        }
        coverage.filesScanned++;
        const after = await handle.stat();
        await this.checkAncestors(dirname(path));
        if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
          || after.ctimeMs !== before.ctimeMs || !sameIdentity(await lstat(path), after)) {
          throw new Error('File changed during reading.');
        }
        // Reject invalid UTF-8 rather than silently corrupting parser input.
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } finally {
        await handle.close();
      }
    } catch {
      coverage.filesSkipped++;
      this.warn(`File unreadable, unsafe, changed, or not UTF-8: ${JSON.stringify(this.label(path))}.`);
      return undefined;
    }
  }
}

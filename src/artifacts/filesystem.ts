import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, parse, resolve, sep, extname } from 'node:path';

export const maxHtmlBytes = 32 * 1024 * 1024;

async function parents(target: string): Promise<string> {
  let current = parse(target).root;
  const result: string[] = [];
  for (const part of dirname(target).slice(current.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe report parent.');
    result.push(`${stat.dev}:${stat.ino}`);
  }
  return result.join('/');
}

/** No-clobber, explicit output only. Portable checks do not eliminate ancestor races. */
export async function writeNewArtifact(input: string, html: string): Promise<void> {
  try {
    if (!input || input.includes('\0') || input.split(/[\\/]/u).includes('..') || extname(input).toLowerCase() !== '.html') {
      throw new Error('Invalid report path.');
    }
    const data = Buffer.from(html, 'utf8');
    if (data.length > maxHtmlBytes) throw new Error('HTML exceeds the 32 MiB output limit.');
    const target = resolve(input);
    if (dirname(target) === parse(target).root) throw new Error('Filesystem-root output is not allowed.');
    const identity = await parents(target);
    // Exclusive creation refuses ALL existing destinations, including symlinks.
    const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const opened = await file.stat();
      const verify = async () => {
        const current = await lstat(target);
        if (!opened.isFile() || current.isSymbolicLink() || !current.isFile()
          || current.dev !== opened.dev || current.ino !== opened.ino || current.nlink !== 1
          || (await file.stat()).nlink !== 1 || await parents(target) !== identity) {
          throw new Error('Report destination changed.');
        }
      };
      await verify();
      await file.writeFile(data);
      await file.sync();
      await verify();
      if ((await file.stat()).size !== data.length) throw new Error('Incomplete report write.');
    } finally { await file.close(); }
  } catch {
    // Do not echo paths, OS errors, or attempt racy unlink cleanup of a replaced path.
    throw new Error('HTML report not saved: destination must be a new .html file in an existing stable non-symlink directory; verify permissions and the 32 MiB limit. A failed/interrupted write may leave an incomplete file; inspect it privately and choose a new destination.');
  }
}

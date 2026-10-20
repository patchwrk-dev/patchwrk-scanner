import { defineConfig } from 'tsup';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadCatalogFile } from './src/changes/catalog.ts';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

/** Trusted build inputs only; never used to walk a scanned project. */
export function reportDefines(): Record<string, string> {
  const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
  const hash = createHash('sha256');
  for (const file of [...sourceFiles('src'), 'package.json', 'pnpm-lock.yaml', 'tsup.config.ts', 'scripts/create-pilot-package.mjs'].sort()) {
    hash.update(JSON.stringify([file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
  }
  const metadata = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  return { PATCHWRK_VERSION: JSON.stringify(metadata.version), PATCHWRK_BUILD: JSON.stringify(hash.digest('hex')) };
}

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: false,
  define: reportDefines(),
  onSuccess: async () => {
    const catalog = await loadCatalogFile(resolve('src/changes/data/catalog.v1.json'));
    await mkdir('dist/data', { recursive: true });
    await writeFile('dist/data/catalog.v1.json', `${JSON.stringify(catalog, null, 2)}\n`);
  },
});

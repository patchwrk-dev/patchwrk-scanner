import { defineConfig } from 'tsup';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadCatalogFile } from './src/changes/catalog.ts';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: false,
  onSuccess: async () => {
    const catalog = await loadCatalogFile(resolve('src/changes/data/catalog.v1.json'));
    await mkdir('dist/data', { recursive: true });
    await writeFile('dist/data/catalog.v1.json', `${JSON.stringify(catalog, null, 2)}\n`);
  },
});

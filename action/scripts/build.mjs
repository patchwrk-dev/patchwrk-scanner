import { createRequire, isBuiltin } from 'node:module';
const tooling = createRequire(import.meta.url);
const { build } = createRequire(tooling.resolve('tsup'))('esbuild');
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const action = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.env.PATCHWRK_ENGINE_SOURCE ?? resolve(action, '..'));
const pins = JSON.parse(await readFile(resolve(action, 'engine-source.json'), 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
for (const [name, hash] of Object.entries(pins.files)) {
  if (sha(await readFile(resolve(source, name))) !== hash) throw Error('Unreviewed engine source: ' + name);
}
// Detect newly added engine modules as well as edited reviewed files.
async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, item.name);
    if (item.isSymbolicLink()) throw Error('Source symlink');
    if (item.isDirectory()) files.push(...await walk(p));
    else if (item.name.endsWith('.ts')) files.push(relative(source, p));
  }
  return files;
}
for (const file of await walk(resolve(source, 'src'))) if (!(file in pins.files)) throw Error('Unreviewed source added');
await mkdir(resolve(action, 'dist'), { recursive: true });
for (const entry of ['index', 'worker', 'result']) {
  const built = await build({ entryPoints: [resolve(action, `src/${entry}.ts`)], outfile: resolve(action, `dist/${entry}.mjs`),
    define: { PATCHWRK_ACTION_ENGINE_COMMIT: JSON.stringify(pins.commit) }, bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: false, metafile: true,
    banner: entry === 'worker' ? { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url); const __filename = import.meta.filename; const __dirname = import.meta.dirname;" } : {},
    plugins: [{ name: 'reviewed-engine', setup(b) { b.onResolve({ filter: /^\.\.\/\.\.\/src\// }, a => ({ path: resolve(source, a.path.slice(6)) })); b.onResolve({ filter: /^source-map-support$/ }, () => ({ path: 'optional-debug-maps', namespace: 'no-debug-maps' })); b.onLoad({ filter: /.*/, namespace: 'no-debug-maps' }, () => ({ contents: 'export function install() {}', loader: 'js' })); } }] });
  for (const out of Object.values(built.metafile.outputs)) {
    for (const dep of out.imports) if (dep.external && !isBuiltin(dep.path)) throw Error('External dependency: ' + dep.path);
  }
}
await writeFile(resolve(action, 'dist/catalog.json'), await readFile(resolve(source, 'src/changes/data/catalog.v1.json')));
const files = {};
for (const name of ['index.mjs', 'worker.mjs', 'result.mjs', 'catalog.json']) files[name] = sha(await readFile(resolve(action, 'dist', name)));
await writeFile(resolve(action, 'dist/manifest.json'), JSON.stringify({ engineCommit: pins.commit, files }, null, 2) + '\n');
console.log('PASS Action build: source pins verified; builtins-only imports; bundle hashes recorded');

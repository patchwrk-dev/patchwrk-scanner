import { build } from 'tsup';
import { createRequire, isBuiltin } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';

const publicCandidate=process.argv[2]==='--public-candidate';
assert.ok(process.argv.length===2||(process.argv.length===3&&publicCandidate),'Unsupported package mode');
const publicTemplates=existsSync('PUBLIC_PROVENANCE.md')?'.':'packaging/public-beta';
const root = process.cwd();
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pkg.private, true);
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
const cache = resolve('.cache');
const output = resolve(publicCandidate?'artifacts/public-beta':'artifacts/pilot');
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const staging = await mkdtemp(resolve(cache, 'pilot-package-'));
const require = createRequire(import.meta.url);
const expected = [
  'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.txt', 'dist/data/catalog.v1.json',
  'dist/index.js', 'licenses/semver.LICENSE', 'licenses/typescript.LICENSE.txt',
  'licenses/typescript.ThirdPartyNoticeText.txt', 'package.json',
] ;
if(publicCandidate)expected.push('SECURITY.md','CONTRIBUTING.md','FEEDBACK.md','PUBLIC_PROVENANCE.md');
expected.sort();
try {
  await mkdir(resolve(staging, 'licenses'));
  await build({
    entry: ['src/cli/index.ts'], outDir: resolve(staging, 'dist'),
    format: ['esm'], platform: 'node', target: 'node24', clean: true,
    sourcemap: false, noExternal: ['typescript', 'semver'], config: false,
    banner: { js: "import { createRequire as __patchwrkCreateRequire } from 'node:module'; const require = __patchwrkCreateRequire(import.meta.url); const __filename = import.meta.filename; const __dirname = import.meta.dirname;" },
    esbuildOptions(options) {
      options.metafile = true;
      options.plugins ??= [];
      options.plugins.push({ name: 'runtime-boundary', setup(builder) {
        builder.onEnd((result) => {
          for (const out of Object.values(result.metafile?.outputs ?? {})) {
            for (const imported of out.imports) if (imported.external && !isBuiltin(imported.path)) {
              throw new Error(`Unexpected external runtime module: ${imported.path}`);
            }
          }
        });
      } });
    },
  });
  const code = await readFile(resolve(staging, 'dist/index.js'), 'utf8');
  assert.match(code, /^#!\/usr\/bin\/env node\n/);
  assert.ok(!code.includes(root), 'Bundle leaked the workspace path');
  assert.ok(!code.includes('sourceMappingURL='), 'Source-map reference in bundle');
  await chmod(resolve(staging, 'dist/index.js'), 0o755);
  await mkdir(resolve(staging, 'dist/data'));
  const { loadCatalogFile } = await import('../src/changes/catalog.ts');
  const catalog = await loadCatalogFile(resolve('src/changes/data/catalog.v1.json'));
  assert.equal(catalog.changes.length, 4);
  await writeFile(resolve(staging, 'dist/data/catalog.v1.json'), JSON.stringify(catalog, null, 2) + '\n');
  await copyFile('LICENSE', resolve(staging, 'LICENSE'));
  await copyFile(publicCandidate?resolve(publicTemplates,'README.md'):'packaging/pilot/README.md', resolve(staging, 'README.md'));
  if(publicCandidate)for(const file of ['SECURITY.md','CONTRIBUTING.md','FEEDBACK.md','PUBLIC_PROVENANCE.md'])await copyFile(resolve(publicTemplates,file),resolve(staging,file));
  const notices = ['Bundled runtime dependencies (not registry dependencies):'];
  for (const [name, files] of [['typescript', ['LICENSE.txt', 'ThirdPartyNoticeText.txt']], ['semver', ['LICENSE']]]) {
    const base = dirname(require.resolve(name + '/package.json'));
    const metadata = JSON.parse(await readFile(resolve(base, 'package.json'), 'utf8'));
    notices.push(`${name} ${metadata.version}: ${metadata.license}. See licenses/${name}.*.`);
    for (const file of files) await copyFile(resolve(base, file), resolve(staging, 'licenses', `${name}.${file}`));
  }
  notices.push('TypeScript and semver are bundled/reformatted into the CLI; original license/notices are preserved.');
  await writeFile(resolve(staging, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n') + '\n');
  const manifest = {
    name: pkg.name, version: pkg.version, private: true, type: 'module',
    description: publicCandidate?'Experimental offline PatchWRK Scanner GitHub beta candidate (unpublished)':'Experimental offline PatchWRK Scanner private pilot archive',
    author: pkg.author, license: pkg.license, engines: pkg.engines,
    bin: { patchwrk: 'dist/index.js' }, files: expected.filter((file) => file !== 'package.json'),
  };
  await writeFile(resolve(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const pack = JSON.parse(execFileSync('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', output, '--cache', resolve(cache, 'npm')], { cwd: staging, encoding: 'utf8' }))[0];
  assert.deepEqual(pack.files.map((file) => file.path).sort(), expected);
  const archive = resolve(output, pack.filename);
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(archive + '.sha256', `${sha256}  ${pack.filename}\n`);
  console.log(JSON.stringify({ archive, sha256, files: expected, bytes: pack.size, bundledRuntime: ['typescript', 'semver'], published: false }, null, 2));
} finally { await rm(staging, { recursive: true, force: true }); }

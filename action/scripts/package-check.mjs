import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'dist/manifest.json'), 'utf8'));
for (const [name, hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(await readFile(resolve(root, 'dist', name))).digest('hex'), hash);
const files = [];
async function walk(dir) {
 for (const name of await readdir(dir)) {
  const p=resolve(dir,name),info=await lstat(p);assert.ok(!info.isSymbolicLink());
  if(info.isDirectory()) await walk(p); else files.push(relative(root,p));
 }
}
await walk(root);
const allowed = /^(?:action\.yml|package\.json|README\.md|HOSTED_ACCEPTANCE\.md|LICENSE|THIRD_PARTY_NOTICES\.txt|engine-source\.json|tsconfig\.json|eslint\.config\.mjs|src\/(?:index|worker|result)\.ts|scripts\/(?:build|package-check)\.mjs|test\/action\.test\.mjs|dist\/(?:index|worker|result)\.mjs|dist\/(?:catalog|manifest)\.json|licenses\/(?:typescript\.LICENSE\.txt|typescript\.ThirdPartyNoticeText\.txt|semver\.LICENSE)|examples\/(?:manual-push|pull-request)\.yml\.example)$/;
for(const name of files) assert.match(name,allowed);
const metadata=await readFile(resolve(root,'action.yml'),'utf8');assert.match(metadata,/using: node24/);assert.doesNotMatch(metadata,/token|post:|pre:/);
for(const name of ['manual-push','pull-request']) {
 const text=await readFile(resolve(root,`examples/${name}.yml.example`),'utf8');
 assert.match(text,/contents: read/);assert.match(text,/persist-credentials: false/);
 assert.doesNotMatch(text,/pull_request_target|secrets\.|write-all|id-token: write|schedule:/);
 assert.match(text,/FULL_REVIEWED_ACTION_COMMIT_SHA/);
}
console.log(JSON.stringify({status:'PASS',files:files.sort(),runtimeHashes:manifest.files,engineCommit:manifest.engineCommit,noLifecycleHooks:true,examplesInactive:true},null,2));

// Local/offline dry-run only. Never invokes publishing or project lifecycle scripts.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import console from 'node:console';
import { resolve } from 'node:path';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(pkg.private, true);
assert.equal(pkg.license, 'MIT');
assert.equal(pkg.engines.node, '>=24 <25');
assert.equal(pkg.bin.patchwrk, 'dist/index.js');
assert.match(readFileSync('dist/index.js', 'utf8'), /^#!\/usr\/bin\/env node\n/);
const output = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--offline', '--json', '--cache', resolve('.cache/npm')], {encoding:'utf8'}));
const expected = ['LICENSE', 'README.md', 'SECURITY.md', 'dist/data/catalog.v1.json', 'dist/index.js', 'package.json'].sort();
const files = output[0].files.map((file) => file.path).sort();
assert.deepEqual(files, expected);
assert.equal(output[0].bundled.length, 0);
console.log(JSON.stringify({private:pkg.private,files,size:output[0].size,unpackedSize:output[0].unpackedSize,lifecycleScriptsExecuted:false,networkRequired:false},null,2));

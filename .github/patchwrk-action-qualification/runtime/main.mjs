/* global process, console */
import assert from 'node:assert/strict';
import path from 'node:path';
import { appendCommandFile } from '../../../action/dist/index.mjs';
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
assert.equal(process.versions.node.split('.')[0], '24');
assert.ok(path.isAbsolute(process.execPath));
assert.doesNotMatch(process.execPath, /[\r\n]/);
await appendCommandFile(process.env.GITHUB_OUTPUT, process.env.GITHUB_WORKSPACE, `node=${process.execPath}\n`);
console.log(JSON.stringify({ probe: 'PASS', platform: process.platform, arch: process.arch, node: process.versions.node }));

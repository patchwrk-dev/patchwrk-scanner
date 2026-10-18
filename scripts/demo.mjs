// Reproduce one existing synthetic benchmark case; never import or execute its code.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

assert.equal(process.argv.length, 2, 'Usage: node scripts/demo.mjs');
const suite = JSON.parse(await readFile('tests/fixtures/benchmark/suite.json', 'utf8'));
const example = suite.cases.find(item => item.id === 'openai-typescript-retired-model');
assert.ok(example, 'Synthetic benchmark case missing');
assert.deepEqual(Object.keys(example.files).sort(), ['index.ts', 'package.json']);
await mkdir('.cache', { recursive: true });
const target = await mkdtemp(resolve('.cache', 'scanner-demo-'));
for (const [name, content] of Object.entries(example.files)) {
  await writeFile(resolve(target, name), content);
}
const run = (...args) => execFileSync(process.execPath, ['dist/index.js', 'scan', target, ...args], { encoding: 'utf8' });
const terminal = run();
const raw = run('--json');
const report = JSON.parse(raw);
for (const [name, content] of Object.entries(example.files)) {
  assert.equal(await readFile(resolve(target, name), 'utf8'), content, 'Target modified');
}
const assessment = report.compatibility.assessments.find(item => item.changeId === 'openai.text-davinci-003.retirement');
assert.ok(assessment, 'Expected catalog assessment missing');
await writeFile(resolve(target, 'terminal.txt'), terminal);
await writeFile(resolve(target, 'report.json'), raw);
console.log('Synthetic demonstration: existing openai-typescript-retired-model fixture.');
console.log('No target dependencies installed; target source was not executed.');
console.log('Terminal excerpt (directory and other lines omitted):');
console.log(terminal.split('\n').filter(line => /^(PatchWRK Scanner|Integrations:|openai \(| {2}Declared:| {2}"index\.ts"|Compatibility:| {2}Evidence level:)/.test(line)).join('\n'));
console.log('JSON excerpt (selected actual fields, not the complete report):');
console.log(JSON.stringify({ integrations: report.integrations, assessment: { changeId: assessment.changeId, status: assessment.status, evidenceLevel: assessment.evidenceLevel, scope: assessment.scope, unknowns: assessment.unknowns } }, null, 2));
console.log('Affected means applicability to a catalog record, not proven runtime failure.');
console.log('Raw reports retained at ' + relative(process.cwd(), target) + '; review paths before sharing.');

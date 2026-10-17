import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { scanRepository } from '../src/scanner/index.ts';
import { scanWithCompatibility } from '../src/compatibility/index.ts';
import { analyzeSource } from '../src/scanner/source.ts';
import { providers } from '../src/providers/index.ts';
import { runCli } from '../src/cli/run.ts';

// All repositories and version constraints in this file are synthetic examples.
let repository: string;
beforeEach(async () => { repository = await mkdtemp(resolve('.scanner-test-cross-file-')); });
afterEach(async () => { vi.restoreAllMocks(); await rm(repository, { recursive: true, force: true }); });
async function write(file: string, contents: string) {
  const target = resolve(repository, file); await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, contents);
}
async function manifest(file = 'package.json', version = '4.0.0') { await write(file, JSON.stringify({ dependencies: { openai: version } })); }
async function client(file = 'client.ts', declaration = 'export const client=new OpenAI();') { await write(file, `import OpenAI from 'openai';\n${declaration}`); }
async function use(statement = "import {client as c} from './client';", file = 'use.ts', model = 'text-davinci-003') {
  await write(file, `${statement}\nc.completions.create({model:'${model}'});`);
}

describe('static module relationships', () => {
  it('tracks a named export through a direct re-export, import alias, and JS-to-TS path mapping', async () => {
    for (const file of await readdir('tests/fixtures/cross-file')) await write(file.replace(/\.fixture$/u, ''), await readFile(resolve('tests/fixtures/cross-file', file), 'utf8'));
    const report = await scanWithCompatibility(repository);
    expect(report.analysis?.clients).toHaveLength(1);
    const tracked = report.analysis!.clients[0]!;
    expect(tracked.definition.file).toBe('client.ts');
    expect(tracked.manifestResolution).toMatchObject({manifest:'package.json',status:'resolved',basis:'nearest-manifest'});
    expect(tracked.usages).toContainEqual({file:'use.ts',line:2,type:'client-reference',typeOnly:false});
    expect(report.configuration?.find((item)=>item.file==='use.ts' && item.status==='literal')?.clientId).toBe(tracked.definition.id);
    expect(report.compatibility.assessments.find((item)=>item.changeId==='openai.text-davinci-003.retirement')).toMatchObject({status:'affected',client:{definition:{file:'client.ts'}}});
  });

  it.each([
    ['export default new OpenAI();', "import c from './client';"],
    ['const original=new OpenAI();export default original;', "import c from './client';"],
    ['const original=new OpenAI();export {original as api};', "import {api as c} from './client';"],
  ])('tracks default/named export form %s', async (definition, statement) => {
    await manifest(); await client('client.ts',definition); await use(statement);
    expect((await scanWithCompatibility(repository)).compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('affected');
  });

  it('supports namespaces without conflating export members', async () => {
    await client(); await write('use.ts',"import * as ns from './client';ns.client.completions.create({model:'text-davinci-003'});");
    expect((await scanWithCompatibility(repository)).compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('affected');
  });

  it.each(['wrapper(ns)', "ns['client'].completions.create({model:dynamic})", 'const alias=ns'])('keeps namespace escape/reflection through %s uncertain', async (escape) => {
    await client(); await write('use.ts',`import * as ns from './client';ns.client.completions.create({model:'gpt-4o'});${escape};`);
    expect((await scanWithCompatibility(repository)).compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('potentially-affected');
  });

  it.each([
    ['module.exports=client;', "const c=require('./client.cjs');"],
    ['exports.client=client;', "const {client:c}=require('./client.cjs');"],
    ['module.exports.client=client;', "const c=require('./client.cjs').client;"],
  ])('tracks CommonJS exports %s and imports %s', async (exportStatement, importStatement) => {
    await write('client.cjs',`const OpenAI=require('openai');const client=new OpenAI();${exportStatement}`);
    await use(importStatement,'use.cjs');
    expect((await scanWithCompatibility(repository)).compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('affected');
  });

  it('supports ESM default import of a direct CJS default export and CJS direct re-exports', async () => {
    await write('client.cjs',"const OpenAI=require('openai');const client=new OpenAI();module.exports=client;");
    await write('barrel.cjs',"const c=require('./client.cjs');module.exports=c;");
    await use("import c from './barrel.cjs';");
    expect((await scanWithCompatibility(repository)).compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('affected');
  });

  it('does not treat require of an ESM namespace as the default client instance', async () => {
    await client('client.ts','export default new OpenAI();');await use("const c=require('./client');",'use.cjs');
    const report=await scanWithCompatibility(repository);
    expect(report.compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).not.toBe('affected');
  });

  it('keeps two clients and their model usage separate', async () => {
    await client('client.ts','export const retired=new OpenAI();export const other=new OpenAI();');
    await write('a.ts',"import {retired as c} from './client';c.completions.create({model:'text-davinci-003'});");
    await write('b.ts',"import {other as c} from './client';c.completions.create({model:'gpt-4o'});");
    const report=await scanWithCompatibility(repository);
    expect(report.compatibility.assessments.filter(a=>a.changeId==='openai.text-davinci-003.retirement').map((item)=>item.status).sort()).toEqual(['affected','not-affected-by-this-change']);
    const affected=report.compatibility.assessments.find((item)=>item.status==='affected')!;
    expect(affected.configurationEvidence.every((item)=>item.clientId===affected.client!.definition.id)).toBe(true);
    expect(affected.configurationEvidence.some((item)=>item.file==='b.ts')).toBe(false);
  });

  it('keeps caller shadowing separate from imported aliases', async () => {
    await client();await write('use.ts',"import {client as c} from './client';function local(c:any){c.completions.create({model:'text-davinci-003'})}");
    expect((await scanWithCompatibility(repository)).compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('unknown');
  });

  it.each([
    "export function factory(){return new OpenAI()}",
    "const client=new OpenAI();export const wrapper=()=>client;",
    "const client=new OpenAI();export const alias=client;",
  ])('does not propagate unsupported factory/alias %s', async (definition) => {
    await client('client.ts',definition);await use("import {factory as c} from './client';");
    expect((await scanWithCompatibility(repository)).configuration?.some((item)=>item.file==='use.ts'&&item.status==='literal')).toBe(false);
  });

  it('detects circular dependencies without recursing forever or claiming runtime order', async () => {
    await client();
    await write('a.ts',"export {client} from './b';");await write('b.ts',"export {client} from './a';");await use("import {client as c} from './a';");
    const report=await scanWithCompatibility(repository);
    expect(report.analysis!.cyclesDetected).toBeGreaterThan(0);
    expect(report.analysis!.complete).toBe(false);
    expect(report.compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).not.toBe('affected');
  });

  it('keeps dynamic imports, export stars, extension ambiguity, and malformed code unresolved', async () => {
    await client();await write('use.ts',"const {client:c}=await import('./client');c.completions.create({model:'text-davinci-003'});");
    expect((await scanWithCompatibility(repository)).configuration?.some((item)=>item.file==='use.ts'&&item.status==='literal')).toBe(false);
    await write('barrel.ts',"export * from './client';");await use("import {client as c} from './barrel';");
    expect((await scanWithCompatibility(repository)).configuration?.some((item)=>item.file==='use.ts'&&item.status==='literal')).toBe(false);
    await write('client.js',"import OpenAI from 'openai';export const client=new OpenAI();");await use();
    expect((await scanWithCompatibility(repository)).configuration?.some((item)=>item.file==='use.ts'&&item.status==='literal')).toBe(false);
    await write('client.ts',"import OpenAI from 'openai';export const = ;");
    const report=await scanRepository(repository);
    expect(report.coverage.complete).toBe(false);
  });

  it('does not trust shadowed CommonJS require/module globals', async () => {
    await client();await write('use.cjs',"const require=(x)=>local;const {client:c}=require('./client');c.completions.create({model:'text-davinci-003'});");
    expect((await scanRepository(repository)).configuration?.some((item)=>item.file==='use.cjs'&&item.status==='literal')).toBe(false);
    await write('client.ts',"import OpenAI from 'openai';const module={exports:null};const c=new OpenAI();module.exports=c;");await use("import c from './client';");
    expect((await scanRepository(repository)).configuration?.some((item)=>item.file==='use.ts'&&item.status==='literal')).toBe(false);
  });

  it('does not infer clients from conflicting SDK/import aliases or duplicate exports', async () => {
    const result=analyzeSource('bad.ts',"import OpenAI from 'openai';import OpenAI from '@anthropic-ai/sdk';new OpenAI();",providers);
    expect(result.module.definitions).toEqual([]);
    await client('client.ts','const one=new OpenAI();const two=new OpenAI();export {one as client};export {two as client};');await use();
    expect((await scanRepository(repository)).configuration?.some((item)=>item.file==='use.ts'&&item.status==='literal')).toBe(false);
  });
});

describe('manifest mapping and workspaces', () => {
  it('resolves scoped SDK subpaths to package declarations without assuming constructors', async () => {
    await write('package.json','{"dependencies":{"@anthropic-ai/sdk":"1.0.0","openai":"4.0.0"}}');
    await write('index.ts',"import Message from '@anthropic-ai/sdk/resources/messages';import OpenAI from 'openai/helpers';new OpenAI();");
    const report=await scanRepository(repository);
    expect(report.integrations.map((item)=>item.packageName)).toEqual(['@anthropic-ai/sdk','openai']);
    expect(report.analysis?.bindings.every((binding)=>binding.manifest==='package.json')).toBe(true);
    expect(report.analysis?.clients).toEqual([]);
    expect(analyzeSource('index.ts',"import * as sdk from 'openai/helpers';new sdk.OpenAI();",providers).module.definitions).toEqual([]);
  });

  it('uses the original client manifest rather than a consumer manifest with a different SDK version', async () => {
    await manifest('apps/origin/package.json','4.0.0');await client('apps/origin/client.ts');
    await manifest('apps/consumer/package.json','9.0.0');await use("import {client as c} from '../origin/client';",'apps/consumer/use.ts');
    const report=await scanWithCompatibility(repository);
    const item=report.compatibility.assessments[0]!;
    expect(item.client?.manifestResolution.manifest).toBe('apps/origin/package.json');
    expect(item.facts.sdkDeclarations[0]?.version).toBe('4.0.0');
    expect(item.configurationEvidence.some((evidence)=>evidence.file==='apps/consumer/use.ts')).toBe(true);
  });

  it('does not fall through a nested manifest boundary without explicit workspace metadata', async () => {
    await manifest();await write('apps/api/package.json','{}');await client('apps/api/client.ts');
    const report=await scanRepository(repository);
    expect(report.analysis?.clients[0]?.manifestResolution).toMatchObject({status:'unknown',manifest:'apps/api/package.json',declarations:[]});
  });

  it.each([['packages/*'], {packages:['packages/*']}])('supports explicit JSON workspace root declarations %j', async (workspaces) => {
    await write('package.json',JSON.stringify({workspaces,dependencies:{openai:'4.0.0'}}));await write('packages/api/package.json','{}');await client('packages/api/client.ts');
    expect((await scanRepository(repository)).analysis?.clients[0]?.manifestResolution).toMatchObject({status:'resolved',manifest:'package.json',basis:'workspace-root'});
  });

  it('resolves a declared workspace package with a single explicit exports entry', async () => {
    await write('package.json','{"workspaces":["packages/*"]}');
    await write('packages/client/package.json','{"name":"@app/client","exports":"./client.ts","dependencies":{"openai":"4.0.0"}}');
    await client('packages/client/client.ts');
    await write('packages/app/package.json','{"dependencies":{"@app/client":"workspace:*"}}');await use("import {client as c} from '@app/client';",'packages/app/use.ts');
    const report=await scanWithCompatibility(repository);
    expect(report.configuration?.some((item)=>item.file==='packages/app/use.ts'&&item.status==='literal')).toBe(true);
    expect(report.compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.client?.manifestResolution.manifest).toBe('packages/client/package.json');
  });

  it('does not guess versions from conflicting or malformed nearest manifests', async () => {
    await write('package.json','{"dependencies":{"openai":"4.0.0"},"devDependencies":{"openai":"9.0.0"}}');await client();
    expect((await scanRepository(repository)).analysis?.clients[0]?.manifestResolution.status).toBe('ambiguous');
    await manifest();await write('apps/api/package.json','{bad');await client('apps/api/client.ts');
    const report=await scanRepository(repository);
    expect(report.analysis?.clients.find((item)=>item.definition.file==='apps/api/client.ts')?.manifestResolution).toMatchObject({status:'unknown',manifest:'apps/api/package.json'});
  });

  it('handles declarations with unknown versions without guessing resolved versions', async () => {
    await write('package.json','{"dependencies":{"openai":"workspace:*"}}');await client();
    const resolution=(await scanRepository(repository)).analysis?.clients[0]?.manifestResolution;
    expect(resolution?.declarations[0]).toMatchObject({version:null,status:'unsupported',resolvedVersion:null});
  });
});

describe('bounded in-memory analysis and CLI', () => {
  it('never reads TypeScript host files or follows an outside or unsafe module path', async () => {
    await client();await write('use.ts',"import c from '../../outside';c.completions.create({model:'text-davinci-003'});");
    const read=vi.spyOn(ts.sys,'readFile').mockImplementation(()=>{throw new Error('Forbidden host read')});
    const report=await scanRepository(repository);
    expect(read).not.toHaveBeenCalled();
    expect(report.analysis?.warnings.join(' ')).toContain('Out-of-scope');
    await symlink(resolve(repository,'client.ts'),resolve(repository,'link.ts'));await use("import {client as c} from './link';");
    const linked=await scanRepository(repository);
    expect(linked.configuration?.some((item)=>item.file==='use.ts'&&item.status==='literal')).toBe(false);
    expect(linked.coverage.complete).toBe(false);
  });

  it.each([
    {maxModules:1}, {maxEdges:1}, {maxTraversalDepth:1}, {maxResolutionSteps:1},
  ])('bounds analysis using %j', async (analysisLimits) => {
    await client();await write('barrel.ts',"export {client} from './client';");await write('bridge.ts',"export {client} from './barrel';");await use("import {client as c} from './bridge';");await write('other.ts',"import {client} from './client';export {client};");
    const report=await scanRepository(repository,{analysisLimits});
    expect(report.analysis!.complete).toBe(false);
    expect(report.coverage.complete).toBe(false);
    expect(report.analysis!.edgesInspected).toBeLessThanOrEqual(report.analysis!.limits.maxEdges);
    expect(report.analysis!.resolutionSteps).toBeLessThanOrEqual(report.analysis!.limits.maxResolutionSteps);
  });

  it('preserves file-size and total-byte limits when cross-file modules are unavailable', async () => {
    await client();await use();
    const report=await scanRepository(repository,{limits:{maxFileBytes:8,maxTotalBytes:8}});
    expect(report.analysis?.modulesAnalyzed).toBe(0);
    expect(report.coverage.bytesScanned).toBe(0);
    expect(report.coverage.complete).toBe(false);
  });

  it.each([0,-1,NaN,1.5,Infinity,999999])('rejects invalid module budgets %s', async (maxModules) => {
    await expect(scanRepository(repository,{analysisLimits:{maxModules}})).rejects.toThrow('module analysis limits');
  });

  it('adds analysis metadata without breaking scanner schema or existing commands', async () => {
    await client();await use();const outputs:string[]=[];
    expect(await runCli(['scan',repository,'--json','--max-modules','10'],{stdout:(value)=>outputs.push(value),stderr:()=>expect.fail('unexpected error')})).toBe(0);
    const report=JSON.parse(outputs[0]!);
    expect(report).toMatchObject({schemaVersion:2,status:'discovery',analysis:{schemaVersion:1,complete:true}});
    expect(report.compatibility.assessments[0].client.definition.file).toBe('client.ts');
    expect(await runCli(['scan',repository,'--max-modules','1','--max-modules','2'],{stdout:()=>expect.fail('stdout'),stderr:()=>undefined})).toBe(1);
    expect(await runCli(['changes','--json'],{stdout:()=>undefined,stderr:()=>expect.fail('unexpected error')})).toBe(0);
  });
});

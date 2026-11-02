import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runAction, validateRoot, appendCommandFile, scanWorker } from '../dist/index.mjs';
import { minimize } from '../dist/result.mjs';
const runtime = { platform: 'linux', arch: 'x64', node: '24.18.1' };
async function fixture(fn) {
  const temp = await mkdtemp(join(tmpdir(), 'patchwrk-action-'));
  // Canonical paths matter on macOS, where /var is a symlink.
  const { realpath } = await import('node:fs/promises'); const dir = await realpath(temp);
  await mkdir(join(dir, 'repo')); await mkdir(join(dir, 'repo/src'));
  try { await fn(join(dir, 'repo'), dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function synthetic(repo) {
  await writeFile(join(repo, 'package.json'), JSON.stringify({name:'synthetic-inert',dependencies:{stripe:'12.0.0',openai:'4.0.0','@anthropic-ai/sdk':'0.20.0','@shopify/shopify-api':'9.0.0',twilio:'5.0.0'},scripts:{postinstall:'exit 77'}}));
  await writeFile(join(repo, 'src/index.ts'), `import Stripe from 'stripe'; import OpenAI from 'openai'; import Anthropic from '@anthropic-ai/sdk'; import {shopifyApi} from '@shopify/shopify-api'; import twilio from 'twilio'; const stripe=new Stripe('SENSITIVE_SENTINEL'); const openai=new OpenAI({apiKey:'SENSITIVE_SENTINEL'}); const a=new Anthropic(); shopifyApi({}); twilio();`);
}

test('real bundled engine: five providers, four-record scope, JSON findings and no project execution/source leak', async () => fixture(async (repo, dir) => {
  await synthetic(repo);
  await writeFile(join(repo,'src/DO_NOT_EXECUTE.cjs'), `require('fs').writeFileSync(${JSON.stringify(join(dir,'EXECUTED'))},'bad');`);
  await writeFile(join(repo,'.env'),'TOKEN=SENSITIVE_SENTINEL');
  const out=join(dir,'output'), summary=join(dir,'summary'); await writeFile(out,'');await writeFile(summary,'');
  const result=await runAction({GITHUB_WORKSPACE:repo,GITHUB_OUTPUT:out,GITHUB_STEP_SUMMARY:summary,SECRET_TOKEN:'SENSITIVE_SENTINEL'},runtime);
  for(const p of ['stripe','openai','anthropic','shopify','twilio'])assert.equal(result.discoveries[p],1);
  assert.equal(result.catalogRecords,4);assert.ok(result.findings.length>0);assert.ok(['complete','partial'].includes(result.status));
  const text=JSON.stringify(result)+await readFile(out,'utf8')+await readFile(summary,'utf8');
  for(const value of ['SENSITIVE_SENTINEL',repo,'DO_NOT_EXECUTE','src/index.ts','SECRET_TOKEN'])assert.ok(!text.includes(value));
  await assert.rejects(access(join(dir,'EXECUTED')));
  assert.match(await readFile(out,'utf8'),/^status=(complete|partial)\nresult=\{/);
  assert.match(await readFile(summary,'utf8'),/no production-health guarantee/);
}));

test('empty report is not a compatibility guarantee',async()=>fixture(async repo=>{
  const result=await runAction({GITHUB_WORKSPACE:repo},runtime);assert.equal(result.findings.length,0);
  assert.ok(result.limitations.some(x=>x.includes('not a compatibility')));
}));

for(const relative of ['../escape','a/../../escape','/tmp','a\\b','https://example.test','a\0b','x'.repeat(1025),'']) {
  test('reject unsafe relative path '+JSON.stringify(relative.slice(0,40)),async()=>fixture(async repo=>{await assert.rejects(validateRoot(repo,relative));}));
}
test('valid nested directory stays inside workspace',async()=>fixture(async repo=>{assert.equal(await validateRoot(repo,'src'),join(repo,'src'));}));
test('symlinked input and workspace fail closed',async()=>fixture(async(repo,dir)=>{
  await symlink(dir,join(repo,'jump'));await assert.rejects(validateRoot(repo,'jump'));
  await symlink(repo,join(dir,'alias'));await assert.rejects(validateRoot(join(dir,'alias')));
}));
test('hardlinked source skipped, not copied into output',async()=>fixture(async(repo,dir)=>{
  await writeFile(join(dir,'outside.ts'),`import OpenAI from 'openai'; const client=new OpenAI();`);
  await link(join(dir,'outside.ts'),join(repo,'src/link.ts'));
  const r=await runAction({GITHUB_WORKSPACE:repo},runtime);assert.equal(r.discoveries.openai,0);
}));
for(const host of [{...runtime,node:'22.0.0'},{...runtime,platform:'win32'},{...runtime,arch:'arm64'}]) {
  test('reject unsupported runtime '+JSON.stringify(host),async()=>fixture(async repo=>{await assert.rejects(runAction({GITHUB_WORKSPACE:repo},host));}));
}
test('unknown Action input fails closed',async()=>fixture(async repo=>{await assert.rejects(runAction({GITHUB_WORKSPACE:repo,INPUT_COMMAND:'arbitrary'},runtime));}));
test('command files inside repo, symlinks and hardlinks are rejected',async()=>fixture(async(repo,dir)=>{
  const inside=join(repo,'out');await writeFile(inside,'');await assert.rejects(appendCommandFile(inside,repo,'no'));
  const out=join(dir,'out');await writeFile(out,'');await symlink(out,join(dir,'sym'));await assert.rejects(appendCommandFile(join(dir,'sym'),repo,'no'));
  await link(out,join(dir,'hard'));await assert.rejects(appendCommandFile(out,repo,'no'));assert.equal(await readFile(out,'utf8'),'');
}));
test('missing output file fails rather than create arbitrary output',async()=>fixture(async(repo,dir)=>{await assert.rejects(runAction({GITHUB_WORKSPACE:repo,GITHUB_OUTPUT:join(dir,'missing')},runtime));}));
test('scan deadline terminates worker and rejects',async()=>fixture(async repo=>{await synthetic(repo);await assert.rejects(scanWorker(repo,1));}));
test('malicious filename does not create workflow command or leak filename',async()=>fixture(async repo=>{
 await writeFile(join(repo,'src/::error::SENSITIVE_SENTINEL.ts'),`import OpenAI from 'openai'; const client=new OpenAI();`);
 const r=await runAction({GITHUB_WORKSPACE:repo},runtime);assert.equal(r.discoveries.openai,1);assert.doesNotMatch(JSON.stringify(r),/::error::|SENSITIVE_SENTINEL/);
}));
test('minimized result preserves partial/truncation, unknown and status distinctions',()=>{
 const report={coverage:{complete:false,filesScanned:2},analysis:{complete:false},integrations:[],compatibility:{catalogVersion:"1.0.0",catalogRecordCount:4,coverage:{complete:false,assessmentsTruncated:true,evidenceDisplayTruncated:false},assessments:[{provider:'openai',changeId:'openai.example',status:'unknown'}]}};
 const r=minimize(report);assert.equal(r.status,'partial');assert.equal(r.coverage.truncated,true);assert.equal(r.counts.unknown,1);assert.equal(r.findings[0].status,'unknown');
 report.compatibility.assessments[0].changeId='::error::';assert.throws(()=>minimize(report));
});
test('CLI unsupported runner failure is generic and contains no workspace/token',()=>{
 const env={PATH:process.env.PATH,GITHUB_WORKSPACE:'/SENSITIVE_SENTINEL',INPUT_PATH:'../SENSITIVE_SENTINEL'};
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('../dist/index.mjs',import.meta.url))],{encoding:'utf8',env});
 assert.equal(r.status,1);assert.equal(r.stdout,'');assert.doesNotMatch(r.stderr,/SENSITIVE_SENTINEL/);assert.match(r.stderr,/action failed/);
});

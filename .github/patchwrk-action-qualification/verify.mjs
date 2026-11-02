/* global process, Buffer, console */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.equal(process.versions.node.split('.')[0],'24');
const base=await realpath(process.env.GITHUB_WORKSPACE),temp=await realpath(process.env.RUNNER_TEMP);
const result=JSON.parse(process.env.QUALIFICATION_RESULT);assert.equal(process.env.QUALIFICATION_STATUS,'complete');assert.equal(result.status,'complete');
assert.equal(result.engineCommit,'8fa08313e65b4d313460936e606d2f3f92979c16');assert.equal(result.catalogRecords,4);
for(const p of ['stripe','openai','anthropic','shopify','twilio'])assert.equal(result.discoveries[p],1);
for(const value of ['SYNTHETIC_SENTINEL',base,'src/index.ts','::error::'])assert.ok(!JSON.stringify(result).includes(value));
const state=JSON.parse(await readFile(path.join(temp,'patchwrk-qualification-state.json'),'utf8'));
for(const [name,hash] of Object.entries(state.hashes))assert.equal(createHash('sha256').update(await readFile(path.join(base,'synthetic',name))).digest('hex'),hash);
await assert.rejects(access(path.join(temp,'patchwrk-EXECUTED')));
await mkdir(path.join(base,'synthetic-empty'));
await mkdir(path.join(base,'synthetic-partial'));
await writeFile(path.join(base,'synthetic-partial','oversized.ts'),Buffer.alloc(1048577,32),{flag:'wx',mode:0o600});
const entry=path.join(base,'trusted/action/dist/index.mjs');
const outcomes=[];
for(const [input,expected] of [['synthetic-empty',0],['synthetic-partial',2],['../escape',1]]){
 const i=outcomes.length,out=path.join(temp,`qualification-${i}.out`),summary=path.join(temp,`qualification-${i}.summary`);
 await writeFile(out,'',{flag:'wx',mode:0o600});await writeFile(summary,'',{flag:'wx',mode:0o600});
 const r=spawnSync(process.execPath,[entry],{encoding:'utf8',timeout:90000,maxBuffer:200000,env:{GITHUB_WORKSPACE:base,INPUT_PATH:input,GITHUB_OUTPUT:out,GITHUB_STEP_SUMMARY:summary}});
 assert.equal(r.error,undefined);assert.equal(r.status,expected);
 if(expected===1){assert.equal(r.stdout,'');assert.equal(await readFile(out,'utf8'),'');assert.equal(await readFile(summary,'utf8'),'');}
 else{const data=JSON.parse(r.stdout);assert.equal(data.status,expected===2?'partial':'complete');assert.match(await readFile(out,'utf8'),/^status=(complete|partial)\nresult=\{/);assert.match(await readFile(summary,'utf8'),/no production-health guarantee/);}
 for(const value of ['SYNTHETIC_SENTINEL',base,'../escape'])assert.ok(!(r.stdout+r.stderr).includes(value));
 outcomes.push({expectedExit:expected,actualExit:r.status});
}
const {scanWorker}=await import(path.join(base,'trusted/action/dist/index.mjs'));
await assert.rejects(scanWorker(path.join(base,'synthetic'),1),/Scan failed/);
console.log(JSON.stringify({hostedContracts:'PASS',platform:process.platform,arch:process.arch,node:process.versions.node,exitOutcomes:outcomes,deadlineCancellation:'PASS',sourceUnchanged:true,canaryNotExecuted:true}));

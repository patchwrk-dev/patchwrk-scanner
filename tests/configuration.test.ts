import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { analyzeSource } from '../src/scanner/source.ts';
import { providers } from '../src/providers/index.ts';
import { scanWithCompatibility, assessCompatibility } from '../src/compatibility/index.ts';
import { LocalChangeCatalog, validateCatalog } from '../src/changes/catalog.ts';
import { listChanges } from '../src/changes/index.ts';
import { runCli } from '../src/cli/run.ts';
import { defaultLimits } from '../src/scanner/policy.ts';
// Repository snippets are synthetic test examples, never verified runtime configs.
import type { ScanReport } from '../src/types/index.ts';

const analyze = (text: string) => analyzeSource('src/client.ts', text, providers).configurations;
const catalog = await new LocalChangeCatalog().load();
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('static scoped configuration', () => {
  it('observes Stripe client literals and scoped request overrides without global substitution', () => {
    const result = analyze(`import Stripe from 'stripe';
const client = new Stripe(process.env.KEY, {apiVersion: '2024-06-20'});
client.customers.create({}, {apiVersion: '2024-09-30.acacia'});`);
    expect(result).toHaveLength(2);
    expect(result.map((item) => [item.scope, item.value, item.line])).toEqual([
      ['client', '2024-06-20', 2], ['request', '2024-09-30.acacia', 3],
    ]);
    expect(result[0]?.clientId).toBe(result[1]?.clientId);
    expect(result.every((item) => item.origin === 'observed-source-configuration' && !item.runtimeVerified)).toBe(true);
  });

  it('records unresolved account/SDK defaults without reading credentials or inferring SDK defaults', () => {
    const result = analyze("import Stripe from 'stripe'; const s=new Stripe('sk_test_DO_NOT_OUTPUT');");
    expect(result[0]).toMatchObject({ scope: 'default-unresolved', value: null, status: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('sk_test');
  });

  it.each([
    'process.env.STRIPE_VERSION', 'getVersion()', "'2024-' + '06-20'", '`2024-${month}-20`',
  ])('does not evaluate dynamic expression %s', (expression) => {
    const result = analyze(`import Stripe from 'stripe'; const s=new Stripe(process.env.KEY,{apiVersion:${expression}});`);
    expect(result[0]).toMatchObject({ value: null, status: 'dynamic' });
    expect(JSON.stringify(result)).not.toContain(expression);
  });

  it('supports const primitive version declarations but not mutable or indirect object configuration', () => {
    expect(analyze("import Stripe from 'stripe'; const API_VERSION='2024-06-20'; const s=new Stripe(process.env.KEY,{apiVersion:API_VERSION});")[0]?.value).toBe('2024-06-20');
    expect(analyze("import Stripe from 'stripe'; let API_VERSION='2024-06-20'; const s=new Stripe(process.env.KEY,{apiVersion:API_VERSION});")[0]?.status).toBe('dynamic');
    expect(analyze("import Stripe from 'stripe'; const config={apiVersion:'2024-06-20'}; const s=new Stripe(process.env.KEY,config);")[0]?.status).toBe('dynamic');
  });

  it.each([
    "{apiVersion:'2024-06-20', ...config}",
    "{...config, apiVersion:'2024-06-20'}",
    "{apiVersion:'2024-06-20', apiVersion:'2024-09-30.acacia'}",
    "{[key]:'2024-06-20'}",
    "{get apiVersion(){throw new Error('MUST NOT RUN')}}",
  ])('keeps unsafe or conflicting option objects unknown: %s', (options) => {
    expect(analyze(`import Stripe from 'stripe'; const s=new Stripe(process.env.KEY,${options});`)[0]?.status).toBe('dynamic');
  });

  it('distinguishes legacy request options, parameters, and rawRequest version overrides', () => {
    const result = analyze(`const Stripe=require('stripe');const s=Stripe(process.env.KEY);
s.customers.create({apiVersion:'2024-06-20'});
s.customers.create({}, {stripeVersion:'2019-11-03'});
s.rawRequest('GET','/v1/customers',{}, {apiVersion:'2024-06-20'});`);
    expect(result.filter((item) => item.scope === 'request').map((item) => item.optionName)).toEqual(['stripeVersion', 'apiVersion']);
  });

  it('does not invent legacy option presence from an indirect request options object', () => {
    const result = analyze("import Stripe from 'stripe';const s=new Stripe(process.env.KEY);s.customers.create({},options);");
    expect(result.some((item) => item.optionName === 'stripeVersion')).toBe(false);
    expect(result.some((item) => item.status === 'dynamic')).toBe(true);
  });

  it('observes literal Stripe-Version headers only for unshadowed fetch to the exact official API host', () => {
    const result = analyze(`fetch('https://api.stripe.com/v1/customers',{headers:{'Stripe-Version':'2024-06-20'}});
fetch('https://api.stripe.com.attacker.invalid/v1/customers',{headers:{'Stripe-Version':'2024-06-20'}});
function local(fetch:any){fetch('https://api.stripe.com/v1/customers',{headers:{'Stripe-Version':'2024-06-20'}})}`);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ packageName: null, evidenceType: 'version-header', scope: 'request', value: '2024-06-20' });
  });

  it('keeps OpenAI model identifiers separate from API versions and tracks const clients only', () => {
    const result = analyze(`import OpenAI from 'openai';const client=new OpenAI({apiKey:process.env.KEY});
client.completions.create({model:'text-davinci-003'});
client.responses.create({model:process.env.MODEL});`);
    expect(result.every((item) => item.kind === 'model')).toBe(true);
    expect(result.filter((item) => item.scope === 'request')).toMatchObject([
      { value: 'text-davinci-003', status: 'literal' }, { value: null, status: 'dynamic' },
    ]);
    expect(analyze("import OpenAI from 'openai';let c=new OpenAI();c.completions.create({model:'text-davinci-003'});").filter((item) => item.scope === 'request')).toEqual([]);
  });

  it('does not inspect unrelated objects, helper imports, shadowed SDKs, or type-only constructors', () => {
    expect(analyze(`import type Stripe from 'stripe';new Stripe('key',{apiVersion:'2024-06-20'});
const unrelated={apiVersion:'2024-06-20',model:'text-davinci-003'};
function local(Stripe:any){new Stripe('key',{apiVersion:'2024-06-20'})}`)).toEqual([]);
  });

  it('withholds unsupported and credential-like literal values instead of echoing secrets', () => {
    const result = analyze("import Stripe from 'stripe';import OpenAI from 'openai';const s=new Stripe(process.env.KEY,{apiVersion:'sk_secret'});const o=new OpenAI();o.responses.create({model:'sk-secret'});");
    expect(result.filter((item) => item.status === 'unsupported')).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('sk_secret');
    expect(JSON.stringify(result)).not.toContain('sk-secret');
  });
});

function observedScan(source: string): ScanReport {
  return { schemaVersion: 2, directory: resolve('.'), status: 'discovery', warnings: [],
    integrations: [{ provider: 'openai', packageName: 'openai', declaredVersions: [], locations: [{file:'src/client.ts',line:1,type:'esm-import',typeOnly:false}] }],
    configuration: analyze(source), coverage: { filesScanned:1, bytesScanned:100,entriesVisited:1,filesSkipped:0,complete:true,limits:{...defaultLimits},limitations:[] } };
}

describe('verified records and matching', () => {
  it('validates exact official provenance, narrow version constraints, unknown dates, and documented model dates', () => {
    expect(validateCatalog(catalog)).toEqual(catalog);
    const stripe = catalog.changes.find((item) => item.id === 'stripe.sdk8.request-option-rename')!;
    expect(stripe.affectedSdks).toEqual([{packageName:'stripe',versionRange:'8.0.0'}]);
    expect(stripe.publicationDate).toBeNull();
    const openai = catalog.changes.find((item) => item.id === 'openai.text-davinci-003.retirement')!;
    expect(openai.retirementDate).toBe('2024-01-04');
    expect(openai.targets).toContainEqual({kind:'model',value:'text-davinci-003'});
    expect(catalog.changes.every((item) => item.provenance.sources.every((source) => source.retrievedAt !== null) && item.evidence.length)).toBe(true);
    expect(() => validateCatalog({...catalog,changes:[stripe,stripe]})).toThrow('duplicate');
  });

  it.each([
    ["'text-davinci-003'",'affected'], ["'gpt-4o'",'not-affected-by-this-change'], ['process.env.MODEL','unknown'],
  ])('matches observed model %s without treating it as an API version', (model, status) => {
    const repository = observedScan(`import OpenAI from 'openai';const c=new OpenAI();c.completions.create({model:${model}});`);
    const summary = assessCompatibility(repository,catalog);
    expect(summary.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe(status);
    expect(summary.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.changeRecord.targets[0]?.kind).toBe('model');
    expect(summary.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.apiEvaluation.outcome).toBe('not-specified');
    expect(summary.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.userDeclared).toEqual([]);
  });

  it('preserves conflicting models, unused clients, and dynamic wrappers as uncertainty', () => {
    const sources = [
      "const c=new OpenAI();c.completions.create({model:'text-davinci-003'});c.responses.create({model:dynamic});",
      "const c=new OpenAI();c.completions.create({model:'text-davinci-003'});const other=new OpenAI();",
      "function wrapper(){return new OpenAI()} const c=wrapper();c.completions.create({model:'text-davinci-003'});",
    ];
    expect(assessCompatibility(observedScan(`import OpenAI from 'openai';${sources[0]}`),catalog).assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('potentially-affected');
    expect(assessCompatibility(observedScan(`import OpenAI from 'openai';${sources[1]}`),catalog).assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('potentially-affected');
    expect(assessCompatibility(observedScan(`import OpenAI from 'openai';${sources[2]}`),catalog).assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('unknown');
  });

  it.each([
    'wrapper(c)', 'const alias=c;alias.completions.create({model:dynamic})',
    'const fn=c.completions.create;fn({model:dynamic})',
  ])('does not use a known literal to hide client escape through %s', (escape) => {
    const repository=observedScan(`import OpenAI from 'openai';const c=new OpenAI();c.completions.create({model:'gpt-4o'});${escape};`);
    expect(assessCompatibility(repository,catalog).assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('potentially-affected');
  });

  it.each(["{baseURL:'https://other.example.invalid/v1'}",'{baseURL:process.env.BASE_URL}', 'options'])('does not treat a custom/unknown OpenAI backend as verified official scope: %s', (options) => {
    const repository=observedScan(`import OpenAI from 'openai';const c=new OpenAI(${options});c.completions.create({model:'text-davinci-003'});`);
    expect(assessCompatibility(repository,catalog).assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('potentially-affected');
    expect(JSON.stringify(repository.configuration)).not.toContain('other.example.invalid');
  });

  it('matches scoped literal API versions but does not let a request override erase an unknown default', () => {
    // Synthetic rule only: not a real documented provider change.
    const rule = structuredClone(catalog.changes.find((item) => item.provider==='stripe')!);
    rule.id='example.stripe.static-api';rule.targets=[];rule.affectedSdks=[];
    rule.affectedApiVersions=[{scheme:'date',versions:['2024-06-20'],versionRange:null}];
    rule.provenance.notes='SYNTHETIC TEST ONLY: simulated reviewed API-version constraint.';
    const repository=observedScan("import Stripe from 'stripe';const c=new Stripe(process.env.KEY);c.customers.create({}, {apiVersion:'2024-06-20'});");
    repository.integrations=[{provider:'stripe',packageName:'stripe',declaredVersions:[],locations:[]}];
    expect(assessCompatibility(repository,{...catalog,changes:[rule]}).assessments.find(a=>a.changeId==='example.stripe.static-api')?.status).toBe('potentially-affected');
    repository.configuration=analyze("import Stripe from 'stripe';const c=new Stripe(process.env.KEY,{apiVersion:'2024-06-20'});");
    expect(assessCompatibility(repository,{...catalog,changes:[rule]}).assessments.find(a=>a.changeId==='example.stripe.static-api')?.status).toBe('affected');
    expect(assessCompatibility(repository,{...catalog,changes:[rule]},['stripe=2024-09-30.acacia']).assessments.find(a=>a.changeId==='example.stripe.static-api')?.status).toBe('potentially-affected');
  });

  it('reports source freshness and whole-catalog coverage with no live monitoring claim', async () => {
    const report=await listChanges();
    expect(report.catalogCoverage).toMatchObject({recordCount:4,liveMonitoring:false});
    expect(report.catalogCoverage?.providers.find((item)=>item.provider==='anthropic')?.records).toBe(0);
    const output:string[]=[];
    expect(await runCli(['changes','--coverage','--json'],{stdout:(value)=>output.push(value),stderr:()=>expect.fail('unexpected error')})).toBe(0);
    expect(JSON.parse(output[0]!).catalogCoverage.newestRetrievalAt).not.toBeNull();
  });

  it('matches the real narrowly scoped Stripe record using a lockfile and observed legacy request option', async () => {
    const directory=await mkdtemp(resolve('.scanner-test-stripe-options-'));
    try {
      await writeFile(resolve(directory,'package.json'),'{"dependencies":{"stripe":"8.0.0"}}');
      await writeFile(resolve(directory,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':{dependencies:{stripe:'8.0.0'}},'node_modules/stripe':{version:'8.0.0'}}}));
      await writeFile(resolve(directory,'client.js'),"const Stripe=require('stripe');const s=new Stripe(process.env.KEY);s.customers.create({}, {stripeVersion:'2019-11-03'});");
      const report=await scanWithCompatibility(directory);
      expect(report.compatibility.assessments.find(a=>a.changeId==='stripe.sdk8.request-option-rename')).toMatchObject({status:'affected',changeId:'stripe.sdk8.request-option-rename',scope:'documented-configuration-applicability'});
      expect(report.compatibility.assessments.find(a=>a.changeId==='stripe.sdk8.request-option-rename')?.changeRecord.category).toBe('nonbreaking-change');
      expect(report.compatibility.assessments.find(a=>a.changeId==='stripe.sdk8.request-option-rename')?.configurationEvidence.some((item)=>item.optionName==='stripeVersion')).toBe(true);
    } finally {await rm(directory,{recursive:true,force:true});}
  });

  it('preserves scan budgets, excludes secret files, never executes code or makes network calls, and leaves targets unchanged', async () => {
    const directory=await mkdtemp(resolve('.scanner-test-configuration-'));
    try {
      const source="import OpenAI from 'openai'; const c=new OpenAI({apiKey:process.env.KEY});c.completions.create({model:'text-davinci-003'});throw new Error('MUST NOT RUN');";
      await writeFile(resolve(directory,'client.js'),source);
      await writeFile(resolve(directory,'.env'),'SECRET=DO_NOT_READ');
      const fetch=vi.fn(()=>{throw new Error('network forbidden')});vi.stubGlobal('fetch',fetch);
      const httpCall=vi.spyOn(http,'request').mockImplementation(()=>{throw new Error('network forbidden')});
      const httpsCall=vi.spyOn(https,'request').mockImplementation(()=>{throw new Error('network forbidden')});
      const report=await scanWithCompatibility(directory);
      expect(report.compatibility.assessments.find(a=>a.changeId==='openai.text-davinci-003.retirement')?.status).toBe('affected');
      expect(JSON.stringify(report)).not.toContain('DO_NOT_READ');
      expect(await readFile(resolve(directory,'client.js'),'utf8')).toBe(source);
      const limited=await scanWithCompatibility(directory,{scan:{limits:{maxFileBytes:8}}});
      expect(limited.configuration).toEqual([]);expect(limited.coverage.complete).toBe(false);
      expect(fetch).not.toHaveBeenCalled();expect(httpCall).not.toHaveBeenCalled();expect(httpsCall).not.toHaveBeenCalled();
    } finally {await rm(directory,{recursive:true,force:true});}
  });
});

describe('Task 045 source-reviewed catalog additions',()=>{
 it.each([["'gpt-4-0314'",'affected'],["'gpt-4o'",'not-affected-by-this-change'],['process.env.MODEL','unknown']])('matches exact retired snapshot %s conservatively', (model,status)=>{
  const scan=observedScan(`import OpenAI from 'openai';const c=new OpenAI();c.chat.completions.create({model:${model}});`);
  const result=assessCompatibility(scan,catalog).assessments.find(a=>a.changeId==='openai.gpt-4-0314.retirement');
  expect(result?.status).toBe(status);expect(result?.changeRecord.retirementDate).toBe('2026-03-26');expect(result?.apiEvaluation.outcome).toBe('not-specified');
 });
 it('keeps Stripe release scope exact and does not invent symbol-use or API-version evidence',async()=>{
  const root=await mkdtemp(resolve('.scanner-test-sdk12-'));
  try{
   await writeFile(resolve(root,'package.json'),JSON.stringify({dependencies:{stripe:'12.0.0'}}));
   await writeFile(resolve(root,'index.js'),"import Stripe from 'stripe';const c=new Stripe(process.env.KEY);");
   const before=await scanWithCompatibility(root);
   expect(before.compatibility.assessments.find(a=>a.changeId==='stripe.sdk12.removed-constructor-aliases')?.status).not.toBe('affected');
   await writeFile(resolve(root,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':{dependencies:{stripe:'12.0.0'}},'node_modules/stripe':{version:'12.0.0'}}}));
   const after=await scanWithCompatibility(root),record=after.compatibility.assessments.find(a=>a.changeId==='stripe.sdk12.removed-constructor-aliases')!;
   expect(record.status).toBe('affected');expect(record.changeRecord.affectedSdks).toEqual([{packageName:'stripe',versionRange:'12.0.0'}]);
   expect(record.changeRecord.migrationInstructions).toContain('does not establish');expect(record.apiEvaluation.outcome).toBe('not-specified');
  }finally{await rm(root,{recursive:true,force:true});}
 });
});

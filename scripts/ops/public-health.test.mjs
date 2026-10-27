import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublicHealth,galleryState,installUrl,userAgent,markdown } from './public-health.mjs';
const csp="default-src 'self'; object-src 'none'; form-action 'none'; frame-ancestors 'none'";
const gallery=(versions=[{targetPlatform:'linux-x64',version:'0.2.6'},{targetPlatform:'darwin-x64',version:'0.2.6'},{targetPlatform:'darwin-arm64',version:'0.2.5'}])=>JSON.stringify({results:[{extensions:[{publisher:{publisherName:'PatchWRK'},extensionName:'patchwrk-scanner-local',versions}]}]});
const response=(body,status=200,extra={})=>new globalThis.Response(body,{status,headers:{'content-type':'text/html; charset=utf-8','content-security-policy':csp,'x-content-type-options':'nosniff',...extra}});
const good=async(url,options)=>{
 assert.equal(options.headers['user-agent'],userAgent);assert.equal(options.headers.authorization,undefined);assert.equal(options.redirect,'manual');
 if(url.endsWith('extensionquery')){assert.equal(options.method,'POST');assert.equal(JSON.parse(options.body).flags,17);return response(gallery(),200,{'content-type':'application/json'});}
 return response('PatchWRK '+installUrl);
};
test('healthy public probes use an honest identity, no credentials, and emit only finite metadata',async()=>{
 const r=await runPublicHealth(good,async()=>{});assert.equal(r.healthy,true);assert.equal(r.checks.length,6);assert.equal(r.checks.every(c=>c.state==='PASS'),true);
 assert.ok(!JSON.stringify(r).includes('default-src'));assert.match(markdown(r),/website-home/);
});
test('403/1010 is ACCESS_BLOCKED, never an outage or green result, and is not retried',async()=>{
 let calls=0;const r=await runPublicHealth(async()=>{calls++;return response('error code: 1010\n',403);},async()=>{});
 assert.equal(calls,6);assert.equal(r.healthy,false);assert.equal(r.checks.every(c=>c.state==='ACCESS_BLOCKED'&&c.reason==='CLOUDFLARE_1010'),true);
});
test('same-origin canonical redirects work; foreign/downgrade/loop redirects are refused before following',async()=>{
 let followed=false;const r=await runPublicHealth(async(u,o)=>{
  if(u==='https://patchwrk.dev/docs/'){followed=true;return response(null,308,{location:'/docs-canonical/'});}return good(u,o);
 },async()=>{});assert.equal(followed,true);assert.equal(r.healthy,true);
 for(const location of ['https://example.invalid/secret','http://patchwrk.dev/','https://user:password@patchwrk.dev/','/']){
  let calls=0;const q=await runPublicHealth(async()=>{calls++;return response(null,308,{location});},async()=>{});
  assert.equal(q.healthy,false);assert.ok(calls<=12);assert.ok(q.checks.every(c=>['REDIRECT_REFUSED','REDIRECT_LOOP','REDIRECT_LIMIT'].includes(c.reason)));
 }
});
test('transient failures get at most two attempts and an independently visible final result',async()=>{
 const seen=new Map();let waits=0;const r=await runPublicHealth(async(u,o)=>{const n=seen.get(u)??0;seen.set(u,n+1);if(n===0)return response('temporary',503);return good(u,o);},async()=>{waits++;});
 assert.equal(r.healthy,true);assert.equal(waits,6);assert.ok(r.checks.every(c=>c.attempts===2));
 const fail=await runPublicHealth(async()=>{throw Error('secret diagnostic must not escape');},async()=>{});
 assert.equal(fail.healthy,false);assert.ok(fail.checks.every(c=>c.reason==='NETWORK_OR_TLS'&&c.attempts===2));assert.ok(!JSON.stringify(fail).includes('secret diagnostic'));
});
test('missing CTA/security headers and wrong content type are drift, not silently healthy',async()=>{
 const r=await runPublicHealth(async()=>response('PatchWRK',200,{'x-content-type-options':'unsafe'}),async()=>{});
 assert.equal(r.healthy,false);assert.equal(r.checks[0].reason,'INSTALL_LINK_MISSING');assert.equal(r.checks[2].reason,'SECURITY_HEADERS');
 const q=await runPublicHealth(async()=>response('PatchWRK',200,{'content-type':'text/plain'}),async()=>{});assert.equal(q.checks[0].reason,'CONTENT_TYPE');
});
test('oversize/invalid UTF8 bodies fail closed without exposing body data',async()=>{
 const r=await runPublicHealth(async()=>response('x',200,{'content-length':String(2*1024*1024+1)}),async()=>{});assert.ok(r.checks.every(c=>c.reason==='BODY_LIMIT'));
 const q=await runPublicHealth(async()=>response(new Uint8Array([255])),async()=>{});assert.ok(q.checks.every(c=>c.reason==='INVALID_UTF8'));
});
test('Gallery validates identity, platforms, reviewed versions, channels and malformed responses',()=>{
 assert.deepEqual(galleryState(gallery()),['PASS','IDENTITY_TARGETS_MATCH']);
 assert.deepEqual(galleryState('{"results":[]}'),['FAIL','GALLERY_INVALID']);
 assert.deepEqual(galleryState(gallery().replace('PatchWRK','Other')),['FAIL','IDENTITY_MISMATCH']);
 assert.deepEqual(galleryState(gallery([{targetPlatform:'win32-x64',version:'0.2.6'}])),['DRIFT','UNREVIEWED_TARGET']);
 assert.deepEqual(galleryState(gallery([{targetPlatform:'linux-x64',version:'0.2.7'}])),['DRIFT','TARGET_VERSION_DRIFT']);
 assert.deepEqual(galleryState(gallery([{targetPlatform:'linux-x64',version:'0.2.6',properties:[{key:'Microsoft.VisualStudio.Code.PreRelease',value:'true'}]}])),['DRIFT','CHANNEL_DRIFT']);
 assert.deepEqual(galleryState(gallery([null])),['FAIL','GALLERY_INVALID']);
 assert.deepEqual(galleryState(gallery([{targetPlatform:'linux-x64',version:'0.2.6',properties:{}}])),['FAIL','GALLERY_INVALID']);
});

test('exhausted global probe budget cannot start requests or become healthy',async()=>{
 let calls=0;const r=await runPublicHealth(async()=>{calls++;throw Error();},async()=>{},0);assert.equal(calls,0);assert.equal(r.healthy,false);assert.ok(r.checks.every(c=>c.reason==='MONITOR_BUDGET'&&c.attempts===0));
});

test('historical prerelease tags do not mislabel current normal-platform releases',()=>{
 const old={targetPlatform:'darwin-arm64',version:'0.1.7',properties:[{key:'Microsoft.VisualStudio.Code.PreRelease',value:'true'}]};
 assert.deepEqual(galleryState(gallery([old,{targetPlatform:'linux-x64',version:'0.2.6'},{targetPlatform:'darwin-x64',version:'0.2.6'},{targetPlatform:'darwin-arm64',version:'0.2.5'}])),['PASS','IDENTITY_TARGETS_MATCH']);
});

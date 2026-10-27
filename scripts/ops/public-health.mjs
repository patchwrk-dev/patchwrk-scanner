// Operator/CI probe only. Never imported by the Scanner or included in its runtime allowlist.
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { pathToFileURL, URL } from 'node:url';
import { TextDecoder } from 'node:util';
import { setTimeout as pause } from 'node:timers/promises';
export const installUrl='https://marketplace.visualstudio.com/items?itemName=PatchWRK.patchwrk-scanner-local';
export const userAgent='PatchWRK-Product-Health/0.1 (+https://github.com/patchwrk-dev/patchwrk-scanner)';
const targets=Object.freeze({'linux-x64':'0.2.6','darwin-x64':'0.2.6','darwin-arm64':'0.2.5'});
const endpoints=Object.freeze([
 {id:'website-home',url:'https://patchwrk.dev/',cta:true,site:true},
 {id:'website-docs',url:'https://patchwrk.dev/docs/',cta:true,site:true},
 {id:'website-privacy',url:'https://patchwrk.dev/privacy/',site:true},
 {id:'website-security',url:'https://patchwrk.dev/security/',site:true},
 {id:'marketplace-install',url:installUrl},
 {id:'marketplace-platforms',url:'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',gallery:true},
]);
class Refused extends Error{constructor(code){super(code);this.code=code;}}
function result(id,state,reason,httpStatus=null,attempts=1){return Object.freeze({id,state,reason,httpStatus,attempts});}
async function boundedBody(response){
 const declared=response.headers.get('content-length');if(declared!==null&&(!/^[0-9]+$/.test(declared)||Number(declared)>2*1024*1024)){await response.body?.cancel().catch(()=>{});throw new Refused('BODY_LIMIT');}
 let size=0;const chunks=[];for await(const chunk of response.body??[]){size+=chunk.length;if(size>2*1024*1024){await response.body?.cancel().catch(()=>{});throw new Refused('BODY_LIMIT');}chunks.push(Buffer.from(chunk));}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new Refused('INVALID_UTF8');}
}
export function galleryState(text){
 let e;try{const d=JSON.parse(text);if(!Array.isArray(d.results)||d.results.length!==1||d.results[0].extensions?.length!==1)throw Error();e=d.results[0].extensions[0];}catch{return ['FAIL','GALLERY_INVALID'];}
 if(!e||typeof e!=='object'||Array.isArray(e))return ['FAIL','GALLERY_INVALID'];
 if(e.publisher?.publisherName!=='PatchWRK'||e.extensionName!=='patchwrk-scanner-local')return ['FAIL','IDENTITY_MISMATCH'];
 if(!Array.isArray(e.versions)||!e.versions.length||e.versions.length>100)return ['FAIL','GALLERY_INVALID'];
 const latest=new Map();for(const v of e.versions){
  if(!v||typeof v!=='object'||(v.properties!==undefined&&(!Array.isArray(v.properties)||v.properties.some(p=>!p||typeof p.key!=='string'||typeof p.value!=='string'))))return ['FAIL','GALLERY_INVALID'];
  if(!Object.hasOwn(targets,v.targetPlatform))return ['DRIFT','UNREVIEWED_TARGET'];
  if(typeof v.version!=='string'||!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v.version))return ['FAIL','GALLERY_INVALID'];
    const old=latest.get(v.targetPlatform);let newer=!old;if(old){const a=v.version.split('.').map(Number),b=old.version.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i]){newer=a[i]>b[i];break;}}}if(newer)latest.set(v.targetPlatform,{version:v.version,preRelease:v.properties?.some(p=>p.key==='Microsoft.VisualStudio.Code.PreRelease'&&p.value==='true')??false});
 }
 for(const [target,version] of Object.entries(targets)){const item=latest.get(target);if(!item||item.version!==version)return ['DRIFT','TARGET_VERSION_DRIFT'];if(item.preRelease)return ['DRIFT','CHANNEL_DRIFT'];}
 return ['PASS','IDENTITY_TARGETS_MATCH'];
}
async function once(endpoint,request,deadline){
 let current=endpoint.url;const visited=new Set();
 for(let redirects=0;redirects<=3;redirects++){
  if(visited.has(current))throw new Refused('REDIRECT_LOOP');visited.add(current);
  const remaining=deadline-Date.now();if(remaining<=0)throw new Refused('MONITOR_BUDGET');
  const headers={'user-agent':userAgent,accept:endpoint.gallery?'application/json;api-version=7.2-preview.1':'text/html'};
  const options={method:endpoint.gallery?'POST':'GET',headers,redirect:'manual',signal:globalThis.AbortSignal.timeout(Math.min(15000,remaining))};
  if(endpoint.gallery){headers['content-type']='application/json';options.body=JSON.stringify({filters:[{criteria:[{filterType:7,value:'PatchWRK.patchwrk-scanner-local'}],pageNumber:1,pageSize:1}],flags:17});}
  const r=await request(current,options);
  if([301,302,303,307,308].includes(r.status)){
   await r.body?.cancel().catch(()=>{});if(endpoint.gallery||redirects===3)throw new Refused('REDIRECT_LIMIT');
   let next;try{next=new URL(r.headers.get('location'),current);}catch{throw new Refused('REDIRECT_REFUSED');}
   if(!r.headers.get('location')||next.protocol!=='https:'||next.origin!==new URL(endpoint.url).origin||next.username||next.password||next.hash)throw new Refused('REDIRECT_REFUSED');
   current=next.href;continue;
  }
  const text=await boundedBody(r);
  if(r.status===401||r.status===403)return result(endpoint.id,'ACCESS_BLOCKED',/error\s+code\s*:\s*1010/i.test(text)?'CLOUDFLARE_1010':'HTTP_ACCESS_POLICY',r.status);
  if(r.status===429||r.status>=500)return result(endpoint.id,'DEGRADED','HTTP_TRANSIENT',r.status);
  if(r.status!==200)return result(endpoint.id,'FAIL','HTTP_UNEXPECTED',r.status);
  if(endpoint.gallery){const [state,reason]=galleryState(text);return result(endpoint.id,state,reason,200);}
  if(!r.headers.get('content-type')?.toLowerCase().includes('text/html'))return result(endpoint.id,'DRIFT','CONTENT_TYPE',200);
  if(endpoint.site){
   if(!text.includes('PatchWRK'))return result(endpoint.id,'DRIFT','PRODUCT_CONTENT',200);
   if(endpoint.cta&&!text.includes(installUrl))return result(endpoint.id,'DRIFT','INSTALL_LINK_MISSING',200);
   const csp=r.headers.get('content-security-policy')??'';
   if(r.headers.get('x-content-type-options')?.toLowerCase()!=='nosniff'||!["object-src 'none'","form-action 'none'","frame-ancestors 'none'"].every(rule=>csp.includes(rule)))return result(endpoint.id,'DRIFT','SECURITY_HEADERS',200);
  }else if(!text.toLowerCase().includes('patchwrk-scanner-local'))return result(endpoint.id,'DRIFT','INSTALL_IDENTITY_MISSING',200);
  return result(endpoint.id,'PASS','CONTENT_MATCH',200);
 }
 throw new Refused('REDIRECT_LIMIT');
}
export async function runPublicHealth(request=globalThis.fetch,delay=()=>pause(3000),budgetMs=120000){
 if(!Number.isSafeInteger(budgetMs)||budgetMs<0||budgetMs>120000)throw Error('Invalid monitor budget');
 const checks=[],deadline=Date.now()+budgetMs;
 for(const endpoint of endpoints){
  if(Date.now()>=deadline){checks.push(result(endpoint.id,'UNKNOWN','MONITOR_BUDGET',null,0));continue;}
  let item;
  for(let attempt=1;attempt<=2;attempt++){
   try{item=await once(endpoint,request,deadline);}catch(error){item=result(endpoint.id,'UNKNOWN',error instanceof Refused?error.code:'NETWORK_OR_TLS');}
   const transient=item.reason==='HTTP_TRANSIENT'||item.reason==='NETWORK_OR_TLS';
   item={...item,attempts:attempt};if(!transient||attempt===2)break;await delay();
  }
  checks.push(Object.freeze(item));
 }
 return Object.freeze({schemaVersion:1,observedAt:new Date().toISOString(),vantage:'single operator or GitHub runner; not customer telemetry',checks:Object.freeze(checks),healthy:checks.every(c=>c.state==='PASS')});
}
export function markdown(report){return ['# PatchWRK public health',report.observedAt,'','| Check | State | Reason | HTTP |','| --- | --- | --- | --- |',...report.checks.map(c=>`| ${c.id} | ${c.state} | ${c.reason} | ${c.httpStatus??'unknown'} |`),'','A failed probe is not a confirmed outage. Check access policy, retries and independent evidence.'].join('\n');}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const r=await runPublicHealth();console.log(process.argv.includes('--markdown')?markdown(r):JSON.stringify(r,null,2));process.exitCode=r.healthy?0:1;
}

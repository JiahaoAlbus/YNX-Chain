import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {AUTHORITY_V2_REPOSITORY,AUTHORITY_V2_URLS,authorityV2SigningMessage,canonicalAuthorityV2} from '../../../sdk/js/endpoint-authority-v2.js';
import {prepareAuthorityV2Draft} from '../../../scripts/ops/endpoint-authority-v2.mjs';

const origin='https://finance.ynxweb4.com',nowMs=Date.parse('2026-09-21T00:00:00.000Z'),iso=value=>new Date(value).toISOString(),sha=value=>createHash('sha256').update(value).digest('hex');
const key=generateKeyPairSync('ed25519'),source={repository:AUTHORITY_V2_REPOSITORY,commit:'1'.repeat(40),tree:'2'.repeat(40)},consumer={consumerId:'ynx-finance-v1',origin,minimumClientVersion:'1.0.0'};
const root={schemaVersion:'ynx-endpoint-authority-trust/v2',authorityId:'ynx-testnet-endpoints',rootVersion:1,chainId:6423,anchor:{rootVersion:1,sequence:0,payloadSha256:'0'.repeat(64)},keys:[{keyId:'finance-browser-test',algorithm:'Ed25519',publicKeyBase64url:key.publicKey.export({format:'jwk'}).x,notBefore:iso(nowMs-86400000),notAfter:iso(nowMs+86400000),revoked:false}],consumers:[{...consumer,endpoints:['walletGateway'],products:['finance']}],maxValiditySeconds:86400};
const observation=url=>({url,httpStatus:200,bodySha256:sha('{}'),observedAt:iso(nowMs-1000),tlsVerified:true,directDNS:true});
function signed(tree=source.tree){
  const selected={...source,tree},endpoints=Object.fromEntries(Object.entries(AUTHORITY_V2_URLS).map(([name,url])=>[name,{url,status:'PENDING',evidence:null}]));
  endpoints.walletGateway={url:AUTHORITY_V2_URLS.walletGateway,status:'VERIFIED',evidence:{health:observation(AUTHORITY_V2_URLS.walletGateway+'/health'),version:observation(AUTHORITY_V2_URLS.walletGateway+'/version'),source:selected,chainId:6423,receiptSha256:'a'.repeat(64)}};
  const manifest=prepareAuthorityV2Draft({schemaVersion:'2.0.0',authorityId:'ynx-testnet-endpoints',manifestVersion:'2.0.0.1',sequence:1,previousPayloadSha256:'0'.repeat(64),environment:'testnet',chainId:6423,cosmosChainId:'ynx_6423-1',asset:'YNXT',issuedAt:iso(nowMs-100),expiresAt:iso(nowMs+3600000),issuerSource:selected,consumers:[consumer],endpoints,products:{finance:{status:'VERIFIED',evidence:{origin,source:selected,observedAt:iso(nowMs-1000),receiptSha256:'b'.repeat(64),registrySha256:'c'.repeat(64),callbackContractSha256:'d'.repeat(64),currentPublicSourceAccepted:true,productSessionAccepted:true},officialSandboxVerified:false,providerVerified:false,productionApproved:false}},policy:{mainnetEnabled:false,automaticWriteRetry:false,automaticFailover:false,clientRenewal:false},integrity:{}},'finance-browser-test');
  manifest.integrity.signature=sign(null,Buffer.from(authorityV2SigningMessage(manifest,manifest.integrity.keyId)),key.privateKey).toString('base64url');return manifest;
}
function signedSuccessor(previous){
  const next=structuredClone(previous);
  next.sequence=2;next.manifestVersion='2.0.0.2';next.previousPayloadSha256=previous.integrity.payloadSha256;
  next.issuedAt=iso(nowMs+1000);next.expiresAt=iso(nowMs+3601000);
  next.products.finance={status:'PENDING',evidence:null,officialSandboxVerified:false,providerVerified:false,productionApproved:false};
  next.integrity={};
  const manifest=prepareAuthorityV2Draft(next,'finance-browser-test');
  manifest.integrity.signature=sign(null,Buffer.from(authorityV2SigningMessage(manifest,manifest.integrity.keyId)),key.privateKey).toString('base64url');
  return manifest;
}

const rotatedBrowserKey=generateKeyPairSync('ed25519'),anchorDocuments=longHistory(3),root2={...structuredClone(root),rootVersion:2,anchor:{...manifestCheckpointForRootTest(anchorDocuments.documents[1]),rootVersion:2},keys:[...structuredClone(root.keys),{...structuredClone(root.keys[0]),keyId:'browser-new-finite',publicKeyBase64url:rotatedBrowserKey.publicKey.export({format:'jwk'}).x,notBefore:iso(nowMs-1000),notAfter:iso(nowMs+7200000)}]};
function manifestCheckpointForRootTest(m){return {rootVersion:1,sequence:m.sequence,payloadSha256:m.integrity.payloadSha256}}
function root2Current(){const d=structuredClone(anchorDocuments.current);d.integrity={};const m=prepareAuthorityV2Draft(d,'browser-new-finite');m.integrity.signature=sign(null,Buffer.from(authorityV2SigningMessage(m,m.integrity.keyId)),rotatedBrowserKey.privateKey).toString('base64url');return m;}
const testRootPins={1:sha(canonicalAuthorityV2(root)),2:sha(canonicalAuthorityV2(root2))};
const testRootPinPlugin={name:'reviewed-test-root-pins',setup(b){b.onLoad({filter:/endpoint-authority-trust-roots\.js$/},()=>({contents:'export const FINANCE_AUTHORITY_TRUST_ROOTS=Object.freeze('+JSON.stringify(testRootPins)+');',loader:'js'}))}};
const sdkAlias={'@ynx-chain/sdk':fileURLToPath(new URL('../../../sdk/js/index.js',import.meta.url))};
const built=await build({alias:sdkAlias,plugins:[testRootPinPlugin],absWorkingDir:fileURLToPath(new URL('../web/',import.meta.url)),entryPoints:['endpoint-authority-entry.js'],bundle:true,platform:'browser',target:'es2022',format:'iife',globalName:'FinanceAuthorityTest',write:false});
const authorityBundle=Buffer.from(built.outputFiles[0].contents);
const storeBuilt=await build({alias:sdkAlias,absWorkingDir:fileURLToPath(new URL('../web/',import.meta.url)),entryPoints:['endpoint-authority-store.js'],bundle:true,platform:'browser',target:'es2022',format:'iife',globalName:'FinanceStoreTest',write:false});
const storeBundle=Buffer.from(storeBuilt.outputFiles[0].contents);
async function setup(configResponse=null){
  const browser=await chromium.launch({headless:true}),context=await browser.newContext(),requests=[];
  await context.route('**/*',route=>{requests.push(route.request().url());const url=new URL(route.request().url());if(url.pathname==='/authority.js')return route.fulfill({contentType:'text/javascript',body:authorityBundle});if(url.pathname==='/api/endpoint-authority/v2/config'&&configResponse)return route.fulfill({contentType:'application/json',headers:{'cache-control':'no-store'},body:JSON.stringify(configResponse)});return route.fulfill({contentType:'text/html',body:'<!doctype html><script src="/authority.js"></script>'});});
  const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!globalThis.FinanceAuthorityTest);
  return {browser,context,page,requests};
}
const manifestCheckpoint=manifest=>({rootVersion:root.rootVersion,sequence:manifest.sequence,payloadSha256:manifest.integrity.payloadSha256});
async function configure(page,manifest=signed(),trustRoot=root,clock=nowMs,serverCheckpoint=manifestCheckpoint(manifest)){await page.evaluate(({manifest,trustRoot,clock,serverCheckpoint})=>{globalThis.__financeClock=clock;globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__={manifest,serverCheckpoint,trustRoot,trustedClock:()=>globalThis.__financeClock};},{manifest,trustRoot,clock,serverCheckpoint});}
const invoke=page=>page.evaluate(async()=>{try{return {ok:true,value:await FinanceAuthorityTest.assertFinancePrivateAuthority()};}catch(error){return {ok:false,error:String(error?.message??error)};}});

test('concurrent authority HTTP readers share one trusted anchor but completed validation never masks real rollback',async()=>{
  const fixture=await setup(),manifest=signed();let requests=0,rollback=false;
  try{
    await fixture.context.route('**/api/endpoint-authority/v2/config',async route=>{
      requests++;await new Promise(resolve=>setTimeout(resolve,30));
      await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',manifest,trustRoot:root,serverCheckpoint:manifestCheckpoint(manifest),trustedTimeMs:rollback?nowMs-1000:nowMs})});
    });
    const result=await fixture.page.evaluate(async()=>{
      const first=FinanceAuthorityTest.assertFinancePrivateAuthority(),second=FinanceAuthorityTest.assertFinancePrivateAuthority();
      await Promise.all([first,second]);return {same:first===second};
    });
    assert.equal(result.same,true);assert.equal(requests,1);
    rollback=true;const rejected=await invoke(fixture.page);
    assert.equal(requests,2);assert.equal(rejected.ok,false);assert.match(rejected.error,/CLOCK_ROLLBACK/);
  }finally{await fixture.browser.close()}
});

test('a fixed global wire configuration keeps its original monotonic trusted clock instead of reanchoring backwards',async()=>{
  const fixture=await setup(),manifest=signed();
  try{
    await fixture.page.evaluate(config=>{globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__=config},{schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',manifest,trustRoot:root,serverCheckpoint:manifestCheckpoint(manifest),trustedTimeMs:nowMs});
    assert.equal((await invoke(fixture.page)).ok,true);
    await fixture.page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,25)));
    assert.equal((await invoke(fixture.page)).ok,true);
    assert.equal((await invoke(fixture.page)).ok,true);
    await fixture.page.evaluate(()=>{globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__.extra=true});
    const malformed=await invoke(fixture.page);assert.equal(malformed.ok,false);assert.match(malformed.error,/CONFIGURATION_INVALID/);
    await fixture.page.evaluate(()=>{delete globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__.extra;globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__.trustedTimeMs-=1000});
    const rollback=await invoke(fixture.page);assert.equal(rollback.ok,false);assert.match(rollback.error,/CLOCK_ROLLBACK/);
  }finally{await fixture.browser.close()}
});

test('same-origin tabs serialize fresh HTTP anchors before the shared durable clock high-water',async()=>{
  const fixture=await setup(),manifest=signed();let pending=0,maximum=0,count=0;
  const started=performance.now();
  try{
    await fixture.context.route('**/api/endpoint-authority/v2/config',async route=>{
      pending++;maximum=Math.max(maximum,pending);count++;
      const trustedTimeMs=nowMs+Math.floor(performance.now()-started);
      await new Promise(resolve=>setTimeout(resolve,count===1?60:5));
      await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',manifest,trustRoot:root,serverCheckpoint:manifestCheckpoint(manifest),trustedTimeMs})});pending--;
    });
    const second=await fixture.context.newPage();await second.goto(origin);await second.waitForFunction(()=>!!globalThis.FinanceAuthorityTest);
    const outcomes=await Promise.all([invoke(fixture.page),invoke(second)]);
    assert.ok(outcomes.every(result=>result.ok),JSON.stringify(outcomes));assert.equal(count,2);assert.equal(maximum,1);
    await second.close();
  }finally{await fixture.browser.close()}
});

test('a hung configuration fetch expires and releases the authority lock for a fresh validation',async()=>{
  const fixture=await setup(),manifest=signed();let hang=true;
  try{
    await fixture.context.route('**/api/endpoint-authority/v2/config',async route=>{
      if(hang)return; // deliberately unanswered; browser AbortController owns the deadline
      await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',manifest,trustRoot:root,serverCheckpoint:manifestCheckpoint(manifest),trustedTimeMs:nowMs})});
    });
    const failed=await invoke(fixture.page);assert.equal(failed.ok,false);assert.match(failed.error,/NETWORK_UNAVAILABLE/);
    hang=false;assert.equal((await invoke(fixture.page)).ok,true);
    await configure(fixture.page,signed('f'.repeat(40)),root,nowMs+1000);
    const invalid=await invoke(fixture.page);assert.equal(invalid.ok,false);assert.match(invalid.error,/EQUIVOCATION/);
  }finally{await fixture.browser.close()}
});

test('browser authority uses durable CAS and rejects equivocation, storage loss, clock rollback, expiry and revocation before network',async()=>{
  const fixture=await setup();
  try{
    await configure(fixture.page);let result=await invoke(fixture.page);assert.equal(result.ok,true);assert.equal(result.value.walletGateway,AUTHORITY_V2_URLS.walletGateway);assert.equal(result.value.providerVerified,false);
    const second=await fixture.context.newPage();await second.goto(origin);await second.waitForFunction(()=>!!globalThis.FinanceAuthorityTest);await configure(second,signed('f'.repeat(40)));result=await invoke(second);assert.equal(result.ok,false);assert.match(result.error,/EQUIVOCATION/);await second.close();
    await fixture.page.evaluate(()=>{globalThis.__financeClock--;});result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,/CLOCK_ROLLBACK/);
    await configure(fixture.page,signed(),root,nowMs+3600000);result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,/EXPIRED_OR_FUTURE/);
    await configure(fixture.page,signed(),{...root,keys:root.keys.map(value=>({...value,revoked:true}))});result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,/TRUST_ROOT_PIN_MISMATCH/);
    await configure(fixture.page);await fixture.page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('ynx-finance-endpoint-authority-v2');request.onsuccess=resolve;request.onerror=()=>reject(request.error);}));result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,/CHECKPOINT_LOST/);
    const accepted=signed(),fork=signed('e'.repeat(40));await fixture.page.evaluate(()=>{localStorage.clear();return new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('ynx-finance-endpoint-authority-v2');request.onsuccess=resolve;request.onerror=()=>reject(request.error);});});await configure(fixture.page,fork,root,nowMs,manifestCheckpoint(accepted));result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,/EQUIVOCATION/);
    assert.deepEqual(fixture.requests.filter(url=>!url.startsWith(origin)),[]);
  }finally{await fixture.browser.close();}
});

test('invalid signature fails before any private endpoint request',async()=>{
  const fixture=await setup();
  try{const manifest=signed();manifest.integrity.signature=Buffer.alloc(64).toString('base64url');await configure(fixture.page,manifest);const result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,/SIGNATURE_INVALID/);assert.deepEqual(fixture.requests.filter(url=>!url.startsWith(origin)),[]);}
  finally{await fixture.browser.close();}
});

test('shipped browser path loads same-origin verified configuration without a custom global',async()=>{
  const manifest=signed(),fixture=await setup({schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',trustRoot:root,manifest,serverCheckpoint:manifestCheckpoint(manifest),trustedTimeMs:nowMs});
  try{const result=await invoke(fixture.page);assert.equal(result.ok,true);assert.equal(result.value.walletGateway,AUTHORITY_V2_URLS.walletGateway);assert.equal(fixture.requests.filter(url=>url.endsWith('/api/endpoint-authority/v2/config')).length,1);assert.deepEqual(fixture.requests.filter(url=>!url.startsWith(origin)),[]);}
  finally{await fixture.browser.close();}
});

test('parallel Finance authority reads of an unchanged signed checkpoint do not supersede one another',async()=>{
  const manifest=signed(),fixture=await setup();
  try{
    await configure(fixture.page,manifest);
    const outcomes=await fixture.page.evaluate(async()=>Promise.all([FinanceAuthorityTest.assertFinancePrivateAuthority(),FinanceAuthorityTest.assertFinancePrivateAuthority()].map(promise=>promise.then(()=>({ok:true}),error=>({ok:false,code:String(error?.message??error)})))));
    assert.deepEqual(outcomes,[{ok:true},{ok:true}]);
  }finally{await fixture.browser.close()}
});

test('same-tab pending authority revocation advances revision and rejects private authority',async()=>{
  const initial=signed(),fixture=await setup();
  try{
    await configure(fixture.page,initial);assert.equal((await invoke(fixture.page)).ok,true);
    const before=await fixture.page.evaluate(()=>FinanceAuthorityTest.financePrivateAuthorityRevision());
    const pending=signedSuccessor(initial);
    await configure(fixture.page,pending,root,nowMs+2000,manifestCheckpoint(initial));
    const outcome=await invoke(fixture.page);
    assert.equal(outcome.ok,false);assert.match(outcome.error,/FINANCE_NOT_AUTHORIZED/);
    const after=await fixture.page.evaluate(()=>FinanceAuthorityTest.financePrivateAuthorityRevision());
    assert.ok(after>before,'a same-tab signed checkpoint change must invalidate old async work');
  }finally{await fixture.browser.close()}
});

test('cross-tab pending checkpoint invalidates an older Finance reader',async()=>{
  const initial=signed(),fixture=await setup();
  try{
    await configure(fixture.page,initial);assert.equal((await invoke(fixture.page)).ok,true);
    const second=await fixture.context.newPage();await second.goto(origin);await second.waitForFunction(()=>!!globalThis.FinanceAuthorityTest);
    await configure(second,initial);assert.equal((await invoke(second)).ok,true);
    const before=await fixture.page.evaluate(()=>FinanceAuthorityTest.financePrivateAuthorityRevision());
    await configure(second,signedSuccessor(initial),root,nowMs+2000,manifestCheckpoint(initial));
    const result=await invoke(second);assert.equal(result.ok,false);
    await fixture.page.waitForFunction(value=>FinanceAuthorityTest.financePrivateAuthorityRevision()>value,before);
    await second.close();
  }finally{await fixture.browser.close()}
});

test('marker write failure cannot commit a checkpoint and failed durable write fails closed',async()=>{
  const fixture=await setup();
  try{
    await fixture.page.addScriptTag({content:storeBundle.toString()});
    const result=await fixture.page.evaluate(async()=>{
      const anchor={rootVersion:1,sequence:0,payloadSha256:'0'.repeat(64)},next={rootVersion:1,sequence:1,payloadSha256:'a'.repeat(64)};
      const clock=()=>Date.parse('2026-09-21T00:00:00.000Z');
      const rejected=FinanceStoreTest.createBrowserAuthorityCheckpointStore({anchor,clock,localStorage:{getItem:()=>null,setItem(){throw new Error('MARKER_WRITE_DENIED')}}});
      let markerError='';try{await rejected.compareAndSwap(anchor,next)}catch(error){markerError=error.message}rejected.close();
      const store=FinanceStoreTest.createBrowserAuthorityCheckpointStore({anchor,clock});
      const afterMarkerFailure=await store.read();store.close();
      const originalPut=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(){throw new Error('DURABLE_WRITE_DENIED')};
      let durableError='';try{await FinanceStoreTest.createBrowserAuthorityCheckpointStore({anchor,clock}).compareAndSwap(anchor,next)}catch(error){durableError=error.message}finally{IDBObjectStore.prototype.put=originalPut}
      const guard=FinanceStoreTest.createBrowserAuthorityCheckpointStore({anchor,clock});
      let readError='';try{await guard.read()}catch(error){readError=error.message}guard.close();
      return {markerError,afterMarkerFailure,durableError,readError};
    });
    assert.equal(result.markerError,'MARKER_WRITE_DENIED');
    assert.deepEqual(result.afterMarkerFailure,{rootVersion:1,sequence:0,payloadSha256:'0'.repeat(64)});
    assert.equal(result.durableError,'DURABLE_WRITE_DENIED');
    assert.equal(result.readError,'FINANCE_AUTHORITY_V2_CHECKPOINT_LOST');
  }finally{await fixture.browser.close()}
});

function bridgeDocument(previous,sequence,issued){
 const d=structuredClone(signed());d.sequence=sequence;d.manifestVersion='2.0.0.'+sequence;d.previousPayloadSha256=previous?.integrity.payloadSha256??'0'.repeat(64);d.issuedAt=iso(issued);d.expiresAt=iso(issued+3600000);
 d.endpoints.walletGateway.evidence.health.observedAt=iso(issued-100);d.endpoints.walletGateway.evidence.version.observedAt=iso(issued-100);d.products.finance.evidence.observedAt=iso(issued-100);d.integrity={};
 const m=prepareAuthorityV2Draft(d,'finance-browser-test');m.integrity.signature=sign(null,Buffer.from(authorityV2SigningMessage(m,m.integrity.keyId)),key.privateKey).toString('base64url');return m;
}
for(const bad of [false,true])test('original durable browser checkpoint bridges expired signed history '+(bad?'missing chain rejects without reset':'and survives reload'),async()=>{
 const fixture=await setup();const old=nowMs-7200000,one=bridgeDocument(null,1,old),two=bridgeDocument(one,2,old+1000),three=bridgeDocument(two,3,old+2000),current=bridgeDocument(three,4,nowMs-100);
 try{
  await configure(fixture.page,one,root,old+100);assert.equal((await invoke(fixture.page)).ok,true);
  await fixture.context.route('**/api/endpoint-authority/v2/history?*',route=>{const q=new URL(route.request().url()).searchParams;const after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};return route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-history/v1',after,manifests:bad?[three]:[two,three]})});});
  await configure(fixture.page,current,root,nowMs);const result=await invoke(fixture.page);
  if(bad){assert.equal(result.ok,false);assert.match(result.error,/PREDECESSOR/);}else{assert.equal(result.ok,true);assert.equal(result.value.payloadSha256,current.integrity.payloadSha256);}
  const checkpoint=await fixture.page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('ynx-finance-endpoint-authority-v2');r.onsuccess=()=>{const db=r.result,q=db.transaction('checkpoint').objectStore('checkpoint').get('state');q.onsuccess=()=>{resolve(q.result.checkpoint);db.close();};q.onerror=()=>reject(q.error);};r.onerror=()=>reject(r.error);}));
  assert.deepEqual(checkpoint,manifestCheckpoint(bad?one:current));
  if(!bad){await fixture.page.reload();await configure(fixture.page,current,root,nowMs+100);assert.equal((await invoke(fixture.page)).ok,true);}
 }finally{await fixture.browser.close();}
});

async function durableCheckpoint(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('ynx-finance-endpoint-authority-v2');r.onsuccess=()=>{const db=r.result,q=db.transaction('checkpoint').objectStore('checkpoint').get('state');q.onsuccess=()=>{resolve(q.result.checkpoint);db.close()};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)}));}
function longHistory(count){const old=nowMs-7200000;const documents=[bridgeDocument(null,1,old)];for(let i=0;i<count;i++)documents.push(bridgeDocument(documents.at(-1),documents.length+1,old+documents.length*1000));return {old,documents,current:bridgeDocument(documents.at(-1),documents.length+1,nowMs-100)};}
async function serveHistory(fixture,documents){await fixture.context.route('**/api/endpoint-authority/v2/history?*',route=>{const q=new URL(route.request().url()).searchParams,after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};return route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-history/v1',after,manifests:documents.slice(after.sequence,after.sequence+2)})})});}
for(const count of [64,65,130])test('Finance original IDB advances '+count+' signed historical revisions in one bounded user intent',async()=>{
 const fixture=await setup(),{old,documents,current}=longHistory(count);
 try{
  await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);await serveHistory(fixture,documents);await configure(fixture.page,current,root,nowMs);
  const result=await invoke(fixture.page);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.payloadSha256,current.integrity.payloadSha256);assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(current));
  await fixture.page.reload();await configure(fixture.page,current,root,nowMs+100);assert.equal((await invoke(fixture.page)).ok,true);
 }finally{await fixture.browser.close()}
});
test('Finance bad later history preserves each verified page without current authority',async()=>{
 const fixture=await setup(),{old,documents,current}=longHistory(65);
 try{await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);documents[65].integrity.signature=Buffer.alloc(64).toString('base64url');await serveHistory(fixture,documents);await configure(fixture.page,current,root,nowMs);
  const rejected=await invoke(fixture.page);assert.equal(rejected.ok,false);assert.match(rejected.error,/SIGNATURE/);assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(documents[64]));
 }finally{await fixture.browser.close()}
});
test('Finance network deadline before 64 documents preserves signed page progress for original IDB reload',async()=>{
 const fixture=await setup(),{old,documents,current}=longHistory(65);let requests=0;
 try{await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);await configure(fixture.page,current,root,nowMs);
  await fixture.context.route('**/api/endpoint-authority/v2/history?*',route=>{requests++;if(requests>1)return;const q=new URL(route.request().url()).searchParams,after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};return route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-history/v1',after,manifests:documents.slice(1,3)})})});
  const started=performance.now(),rejected=await invoke(fixture.page);assert.equal(rejected.ok,false);assert.equal(rejected.error,'NETWORK_UNAVAILABLE');assert.ok(performance.now()-started<12000);assert.equal(requests,2);assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(documents[2]));
  await fixture.page.reload();await serveHistory(fixture,documents);await configure(fixture.page,current,root,nowMs+100);const recovered=await invoke(fixture.page);assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(current));
 }finally{await fixture.browser.close()}
});
test('Finance config N ignores unused history N after reaching its authenticated predecessor',async()=>{
 const fixture=await setup(),{old,documents,current}=longHistory(1);const unused=structuredClone(current);unused.integrity.signature='untrusted-unused';
 try{await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);await serveHistory(fixture,[...documents,unused]);await configure(fixture.page,current,root,nowMs);const result=await invoke(fixture.page);assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(current));}
 finally{await fixture.browser.close()}
});

test('Finance rereads config once when another accepted checkpoint is ahead of the captured target',async()=>{
 const fixture=await setup(),{old,documents,current}=longHistory(1);let count=0;
 try{await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);await configure(fixture.page,documents[1],root,old+1100);assert.equal((await invoke(fixture.page)).ok,true);
  await fixture.page.evaluate(()=>delete globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__);
  await fixture.context.route('**/api/endpoint-authority/v2/config',route=>{count++;const manifest=count===1?documents[0]:current;return route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',manifest,trustRoot:root,serverCheckpoint:manifestCheckpoint(manifest),trustedTimeMs:nowMs+count})})});
  const result=await invoke(fixture.page);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(count,2);assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(current));
 }finally{await fixture.browser.close()}
});
for(const bad of ['digest','expired'])test('Finance partial history rejects '+bad+' target without checkpoint or broad retry',async()=>{
 const fixture=await setup(),{old,documents,current}=longHistory(65);let count=0;
 try{await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);await serveHistory(fixture,documents);let target=current;
  if(bad==='digest')target.integrity.payloadSha256='f'.repeat(64);else target=bridgeDocument(documents.at(-1),current.sequence,nowMs-3600000);
  await fixture.page.evaluate(()=>delete globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__);
  await fixture.context.route('**/api/endpoint-authority/v2/config',route=>{count++;return route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',manifest:target,trustRoot:root,serverCheckpoint:manifestCheckpoint(target),trustedTimeMs:nowMs})})});
  const result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,bad==='digest'?/DIGEST_MISMATCH/:/EXPIRED_OR_FUTURE/);assert.equal(count,1);assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(documents[0]));
 }finally{await fixture.browser.close()}
});
test('Finance fallback cross-tab CAS conflict rereads the shared checkpoint without resetting its prefix',async()=>{
 const fixture=await setup(),{old,documents,current}=longHistory(65);
 try{await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);await serveHistory(fixture,documents);
  const second=await fixture.context.newPage();await second.goto(origin);await second.waitForFunction(()=>!!globalThis.FinanceAuthorityTest);
  for(const page of [fixture.page,second]){await page.evaluate(()=>Object.defineProperty(navigator,'locks',{value:undefined}));await configure(page,current,root,nowMs)}
  const results=await Promise.all([invoke(fixture.page),invoke(second)]);assert.ok(results.some(r=>r.ok),JSON.stringify(results));assert.ok(results.every(r=>r.ok||['AUTHORITY_V2_CHECKPOINT_CONFLICT','AUTHORITY_V2_SUPERSEDED'].includes(r.error)),JSON.stringify(results));assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(current));await second.close();
 }finally{await fixture.browser.close()}
});

test('Finance pins the captured signed target through asynchronous history rotation',async()=>{
 const fixture=await setup(),{old,documents,current}=longHistory(1);let changed=false;
 try{await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);await configure(fixture.page,current,root,nowMs);
  await fixture.context.route('**/api/endpoint-authority/v2/history?*',async route=>{if(!changed){changed=true;await fixture.page.evaluate(()=>{const m=globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__.manifest;m.integrity.payloadSha256='f'.repeat(64)})}const q=new URL(route.request().url()).searchParams,after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-history/v1',after,manifests:documents.slice(after.sequence,after.sequence+2)})})});
  const result=await invoke(fixture.page);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.payloadSha256,current.integrity.payloadSha256);assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(current));
  const failed=await invoke(fixture.page);assert.equal(failed.ok,false);assert.match(failed.error,/DIGEST_MISMATCH|EQUIVOCATION/);
 }finally{await fixture.browser.close()}
});

test('Finance target snapshot rejects accessors without invoking them',async()=>{
 const fixture=await setup();try{await configure(fixture.page,signed());await fixture.page.evaluate(()=>{globalThis.getterCalls=0;Object.defineProperty(globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__.manifest,'sequence',{enumerable:true,get(){globalThis.getterCalls++;return 1}})});const rejected=await invoke(fixture.page);assert.equal(rejected.ok,false);assert.equal(rejected.error,'AUTHORITY_V2_ACCESSOR');assert.equal(await fixture.page.evaluate(()=>globalThis.getterCalls),0);}finally{await fixture.browser.close()}
});
test('Finance hard invalidation cannot be bypassed by bounded config rotation retry',async()=>{
 const fixture=await setup(),{old,documents}=longHistory(1);let count=0;
 try{await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);await configure(fixture.page,documents[1],root,old+1100);assert.equal((await invoke(fixture.page)).ok,true);await fixture.page.evaluate(()=>delete globalThis.__YNX_FINANCE_ENDPOINT_AUTHORITY_V2__);
  await fixture.context.route('**/api/endpoint-authority/v2/config',async route=>{count++;await fixture.page.evaluate(()=>FinanceAuthorityTest.invalidateFinancePrivateAuthority());await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-browser-config/v1',manifest:documents[0],trustRoot:root,serverCheckpoint:manifestCheckpoint(documents[0]),trustedTimeMs:nowMs})})});const rejected=await invoke(fixture.page);assert.equal(rejected.ok,false);assert.equal(rejected.error,'AUTHORITY_V2_SUPERSEDED');assert.equal(count,1);assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(documents[1]));
 }finally{await fixture.browser.close()}
});

test('Finance hard invalidation during historical fetch never commits or activates the returned page',async()=>{
 const fixture=await setup(),{old,documents,current}=longHistory(65);
 try{await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);await configure(fixture.page,current,root,nowMs);
  await fixture.context.route('**/api/endpoint-authority/v2/history?*',async route=>{await fixture.page.evaluate(()=>FinanceAuthorityTest.invalidateFinancePrivateAuthority());const q=new URL(route.request().url()).searchParams,after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-history/v1',after,manifests:documents.slice(1,3)})})});
  const rejected=await invoke(fixture.page);assert.equal(rejected.ok,false);assert.equal(rejected.error,'AUTHORITY_V2_SUPERSEDED');assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(documents[0]));
 }finally{await fixture.browser.close()}
});

for(const failure of [false,'signature','unknown-root','wrong-anchor','expired-current'])test('old durable root1 browser to reviewed root2 '+String(failure),async()=>{
 const fixture=await setup(),{old,documents}=anchorDocuments,current=root2Current();
 try{
  await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);
  let selectedRoot=root2;if(failure==='unknown-root'){selectedRoot=structuredClone(root2);selectedRoot.keys[1].publicKeyBase64url=key.publicKey.export({format:'jwk'}).x}
  let anchor=structuredClone(documents[1]);if(failure==='signature')anchor.integrity.signature=Buffer.alloc(64).toString('base64url');if(failure==='wrong-anchor')anchor=documents[2];
  await fixture.context.route('**/api/endpoint-authority/v2/root-anchor?*',route=>{const q=new URL(route.request().url()).searchParams,after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};return route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-root-anchor/v1',after,manifest:anchor})})});
  await fixture.context.route('**/api/endpoint-authority/v2/history?*',route=>{const q=new URL(route.request().url()).searchParams,after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};return route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-history/v1',after,manifests:documents.slice(after.sequence,after.sequence+2)})})});
  await configure(fixture.page,current,selectedRoot,failure==='expired-current'?Date.parse(current.expiresAt):nowMs,{rootVersion:2,sequence:current.sequence,payloadSha256:current.integrity.payloadSha256});const result=await invoke(fixture.page);
  if(failure){assert.equal(result.ok,false,JSON.stringify(result));assert.match(result.error,/SIGNATURE_INVALID|PIN_MISMATCH|ANCHOR_CONFLICT|EXPIRED_OR_FUTURE/);assert.deepEqual(await durableCheckpoint(fixture.page),manifestCheckpoint(documents[0]));}
  else{assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(await durableCheckpoint(fixture.page),{rootVersion:2,sequence:current.sequence,payloadSha256:current.integrity.payloadSha256});await fixture.page.reload();await configure(fixture.page,current,root2,nowMs+100,{rootVersion:2,sequence:current.sequence,payloadSha256:current.integrity.payloadSha256});assert.equal((await invoke(fixture.page)).ok,true);await configure(fixture.page,documents[0],root,nowMs+200);const rollback=await invoke(fixture.page);assert.equal(rollback.ok,false);assert.match(rollback.error,/CONFIGURATION_ROTATED|ROOT_ROLLBACK/);}
 }finally{await fixture.browser.close()}
});

test('two real browser tabs cannot overwrite reviewed root2 checkpoint through concurrent anchor CAS',async()=>{
 const fixture=await setup(),{old,documents}=anchorDocuments,current=root2Current();let second;
 try{
  await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);
  await fixture.context.route('**/api/endpoint-authority/v2/root-anchor?*',async route=>{const q=new URL(route.request().url()).searchParams,after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};await new Promise(r=>setTimeout(r,40));await route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-root-anchor/v1',after,manifest:documents[1]})})});
  await fixture.context.route('**/api/endpoint-authority/v2/history?*',route=>{const q=new URL(route.request().url()).searchParams,after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};return route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-history/v1',after,manifests:documents.slice(after.sequence,after.sequence+2)})})});
  second=await fixture.context.newPage();await second.goto(origin);await second.waitForFunction(()=>!!FinanceAuthorityTest);
  const target={rootVersion:2,sequence:current.sequence,payloadSha256:current.integrity.payloadSha256};await configure(fixture.page,current,root2,nowMs,target);await configure(second,current,root2,nowMs,target);
  const results=await Promise.all([invoke(fixture.page),invoke(second)]);assert.ok(results.some(r=>r.ok),JSON.stringify(results));assert.ok(results.every(r=>r.ok||/CHECKPOINT_CONFLICT|SUPERSEDED/.test(r.error)),JSON.stringify(results));assert.deepEqual(await durableCheckpoint(fixture.page),target);
 }finally{await fixture.browser.close()}
});

test('durable same-sequence signed root anchor upgrades through verified capability then current accept',async()=>{
 const fixture=await setup(),{old,documents}=anchorDocuments,current=root2Current();
 try{
  await configure(fixture.page,documents[0],root,old+100);assert.equal((await invoke(fixture.page)).ok,true);
  await configure(fixture.page,documents[1],root,old+1100);assert.equal((await invoke(fixture.page)).ok,true);
  const previous=manifestCheckpoint(documents[1]);assert.deepEqual(await durableCheckpoint(fixture.page),previous);
  await fixture.page.addScriptTag({content:storeBundle.toString()});
  const rejected=await fixture.page.evaluate(async({previous,anchor})=>{
    const store=FinanceStoreTest.createBrowserAuthorityCheckpointStore({anchor,clock:()=>globalThis.__financeClock});
    const errors=[];for(const next of [anchor,{...anchor,payloadSha256:'f'.repeat(64)},{...previous,rootVersion:0}]){try{await store.compareAndSwap(previous,next,{});errors.push('ACCEPTED')}catch(error){errors.push(error.message)}}
    store.close();return errors;
  },{previous,anchor:root2.anchor});assert.deepEqual(rejected,Array(3).fill('FINANCE_AUTHORITY_V2_CHECKPOINT_ROLLBACK'));
  assert.deepEqual(await durableCheckpoint(fixture.page),previous);
  await fixture.context.route('**/api/endpoint-authority/v2/root-anchor?*',route=>{const q=new URL(route.request().url()).searchParams,after={rootVersion:Number(q.get('rootVersion')),sequence:Number(q.get('sequence')),payloadSha256:q.get('payloadSha256')};return route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-root-anchor/v1',after,manifest:documents[1]})})});
  await serveHistory(fixture,documents);
  const target={rootVersion:2,sequence:current.sequence,payloadSha256:current.integrity.payloadSha256};
  await configure(fixture.page,current,root2,nowMs,target);const accepted=await invoke(fixture.page);assert.equal(accepted.ok,true,JSON.stringify(accepted));assert.deepEqual(await durableCheckpoint(fixture.page),target);
  await fixture.page.reload();await configure(fixture.page,current,root2,nowMs+100,target);assert.equal((await invoke(fixture.page)).ok,true);
 }finally{await fixture.browser.close()}
});

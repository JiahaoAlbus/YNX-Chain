import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {AUTHORITY_V2_REPOSITORY,AUTHORITY_V2_URLS,authorityV2SigningMessage} from '../../../sdk/js/endpoint-authority-v2.js';
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

const built=await build({absWorkingDir:fileURLToPath(new URL('../web/',import.meta.url)),entryPoints:['endpoint-authority-entry.js'],bundle:true,platform:'browser',target:'es2022',format:'iife',globalName:'FinanceAuthorityTest',write:false});
const authorityBundle=Buffer.from(built.outputFiles[0].contents);
const storeBuilt=await build({absWorkingDir:fileURLToPath(new URL('../web/',import.meta.url)),entryPoints:['endpoint-authority-store.js'],bundle:true,platform:'browser',target:'es2022',format:'iife',globalName:'FinanceStoreTest',write:false});
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

test('browser authority uses durable CAS and rejects equivocation, storage loss, clock rollback, expiry and revocation before network',async()=>{
  const fixture=await setup();
  try{
    await configure(fixture.page);let result=await invoke(fixture.page);assert.equal(result.ok,true);assert.equal(result.value.walletGateway,AUTHORITY_V2_URLS.walletGateway);assert.equal(result.value.providerVerified,false);
    const second=await fixture.context.newPage();await second.goto(origin);await second.waitForFunction(()=>!!globalThis.FinanceAuthorityTest);await configure(second,signed('f'.repeat(40)));result=await invoke(second);assert.equal(result.ok,false);assert.match(result.error,/EQUIVOCATION/);await second.close();
    await fixture.page.evaluate(()=>{globalThis.__financeClock--;});result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,/CLOCK_ROLLBACK/);
    await configure(fixture.page,signed(),root,nowMs+3600000);result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,/EXPIRED_OR_FUTURE/);
    await configure(fixture.page,signed(),{...root,keys:root.keys.map(value=>({...value,revoked:true}))});result=await invoke(fixture.page);assert.equal(result.ok,false);assert.match(result.error,/REVOKED/);
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

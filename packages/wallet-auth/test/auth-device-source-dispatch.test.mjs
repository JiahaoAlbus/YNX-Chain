import test,{after,mock}from'node:test';import assert from'node:assert/strict';
import{pathToFileURL,fileURLToPath}from'node:url';
const stage=process.env.AUTH_DISPATCH_STAGE??fileURLToPath(new URL('../',import.meta.url));
const {dispatchOriginalSourceV2:dispatch}=await import(pathToFileURL(stage+'/native/original-auth-source-v2-dispatch.mjs'));
const {createScopeFixtureContext}=await import(pathToFileURL(stage+'/test/fixtures/native-dispatch-public.fixture.mjs'));
const {inspectPQAuthorizationView}=await import(pathToFileURL(stage+'/src/pq-wallet-policy.js'));
const ctx=createScopeFixtureContext();after(()=>ctx.close());mock.method(Date,'now',()=>ctx.at);
function raw(owner,height='5'){
 const role=['root','profile','current','subject'].find(r=>ctx.registrations[r].owner===owner),s=ctx.registrations[role],r=inspectPQAuthorizationView(s).activeRecord;
 return{owner,executionHeight:height,ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,records:[{algorithmVersion:'YNX-BATCH/v0.1',owner,pkA:r.pkA,pkB:r.pkB,revision:'1',registeredAt:'2',activeFrom:'3',ledgerNonce:'1'}],policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:ctx.network,enableAt:'1',activeRevision:'1'};
}
function input(c){return{operation:'auth-source-v2-native-node/v1',node:{origin:'https://PUBLIC.invalid',spki:'e'.repeat(64),nativeChainId:'6423'},rootRaw:c.rootRaw,enrollmentRaw:c.enrollmentRaw,profileRaw:c.profileRaw,headRaw:c.currentRaw,policy:c.policy,previous:c.previous};}
function current(c){return async(_url,_spki,digest,nonce)=>{
 assert.equal(digest,ctx.sha(c.profileRaw));assert.equal(_url,c.policy.endpoint);assert.equal(_spki,c.policy.spki);
 return ctx.signCurrentForPublicFixture({...c.c,nonce},c.policy.signatureContract.currentFrame);
};}
test('both real device families traverse original dispatcher + four-role dual-PQ/current mathematics',async()=>{
 for(const kind of['http','finalization']){
  const c=ctx.fixture(kind).credentials(),seen=[];
  const result=await dispatch(input(c),async(_node,owner)=>{seen.push(owner);return raw(owner);},current(c));
  assert.equal(seen.length,8);assert.equal(new Set(seen).size,4);
  assert.equal(result.projection.profileDigest,ctx.sha(c.profileRaw));
  assert.equal(result.projection.status,'active');assert.equal(result.projection.dataOnly,true);
  assert.equal(result.projection.nativeAdmission,false);
 }
});
test('missing/extra device policy fields fail before any producer is called',async()=>{
 for(const change of[p=>delete p.applicationId,p=>delete p.productId,p=>{p.approved=true}]){
  const c=ctx.fixture('http').credentials(),i=input(c);i.policy={...i.policy};change(i.policy);let called=0;
  await assert.rejects(dispatch(i,async()=>{called++;throw Error('must not be reached')},current(c)),{code:'AUTH_SOURCE_V2_DISPATCH_SCHEMA'});
  assert.equal(called,0);
 }
});
test('device application/product are checked against actual signed original, not new parser acceptance alone',async()=>{
 for(const key of['applicationId','productId']){
  const c=ctx.fixture('http').credentials(),i=input(c);i.policy={...i.policy,[key]:'PUBLIC-wrong'};
  await assert.rejects(dispatch(i,async(_node,owner)=>raw(owner),current(c)));
 }
});
test('after-current observation height drift fails real pre/post registration fence',async()=>{
 const c=ctx.fixture('http').credentials();let calls=0;
 await assert.rejects(dispatch(input(c),async(_node,owner)=>raw(owner,++calls>4?'6':'5'),current(c)));
 assert.equal(calls,8);
});
test('normal production path has no injected get/fetch selectors in the stdin document',async()=>{
 const c=ctx.fixture('http').credentials(),i={...input(c),get:()=>({approved:true})};let calls=0;
 await assert.rejects(dispatch(i,async()=>{calls++;throw Error('not reached')},current(c)),{code:'AUTH_SOURCE_V2_DISPATCH_SCHEMA'});
 assert.equal(calls,0);
});

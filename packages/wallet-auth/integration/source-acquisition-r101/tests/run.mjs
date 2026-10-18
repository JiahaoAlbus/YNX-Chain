// Executes actual Source v2 dispatch and HTTP client event handling. Sole SDK
// mathematics/registered views and network events are explicitly PUBLIC seams.
import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
const dispatchURL=new URL('../../../native/original-auth-source-v2-dispatch.mjs',import.meta.url).href;
const cliURL=new URL('../../../native/original-auth-identity-source-verifier.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
 if(context.parentURL===dispatchURL){
  const seams={'./original-auth-identity-source-v2-verifier.mjs':'./public-math-seam.mjs','../src/pq-wallet-policy.js':'./public-policy-seam.mjs','./original-ide-auth-proof-dispatch.mjs':'./public-node-seam.mjs'};
  if(Object.hasOwn(seams,specifier))return next(new URL(seams[specifier],import.meta.url).href,context);
 }
 if(context.parentURL===cliURL&&specifier==='node:https')return next(new URL('./public-http-seam.mjs',import.meta.url).href,context);
 return next(specifier,context);
}});
const {canonical,sha,fetchSourceCurrent,fetchSourceCurrentV2}=await import(cliURL);
const {dispatchOriginalSourceV2:dispatch}=await import(dispatchURL);
const input=()=>{
 const body=b=>canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',body:Buffer.from(canonical(b)).toString('base64url')});
 const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',networkId:'12'.repeat(32),rootOwner:'0x'+'11'.repeat(20)}),enrollmentRaw=body({profileOwner:'0x'+'22'.repeat(20),currentOwner:'0x'+'33'.repeat(20)});
 return {operation:'auth-source-v2-native-node/v1',node:{origin:'https://PUBLIC.invalid',spki:'34'.repeat(32),nativeChainId:'6423'},rootRaw,enrollmentRaw,profileRaw:body({subjectOwner:'0x'+'44'.repeat(20)}),headRaw:body({nonce:'A'.repeat(43)}),policy:{rootDigest:sha(rootRaw),enrollmentDigest:sha(enrollmentRaw),endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'56'.repeat(32),signatureContract:{purpose:'AUTH-IDENTITY-RECEIVE',enrollmentFrame:'PUBLIC E',profileFrame:'PUBLIC P',currentFrame:'PUBLIC C'}},previous:{sequence:30,floor:9,head:'ef'.repeat(32),timeFloor:0,executionHeight:'9'}};
};
function setup(mode='normal'){
 const c=globalThis.__auth101={mode,gets:0,fetches:0,currentMathCalls:0,transitionCalls:0};
 return {c,get:async(node,owner)=>{const i=c.gets++;return {owner,height:mode==='role-height'&&i===1?'11':mode==='height-change'&&i>=4?'11':'10',revision:mode==='revision-change'&&i>=4?'2':'1'};},current:async(endpoint,spki,digest,nonce)=>{c.fetches++;return canonical({nonce});}};
}
const cases=[];
{
 const{c,get,current}=setup();const result=await dispatch(input(),get,current);assert.equal(result.projection.sequence,31);assert.equal(c.gets,8);assert.equal(c.fetches,1);assert.equal(c.previous.sequence,30);assert.equal(c.previous.floor,10);assert.equal(c.previous.head,'ef'.repeat(32));cases.push('immutable older baseline merged with later Native sequence; second current can work');
}
for(const mode of ['terminal','role-height','height-change','revision-change','expired','math-reject']){
 const{c,get,current}=setup(mode);await assert.rejects(dispatch(input(),get,current));
 assert.equal(c.fetches,['terminal','role-height'].includes(mode)?0:1);cases.push(mode+' fail closed');
}
{
 const{c,get,current}=setup();const x=input();x.previous={...x.previous,sequence:20,head:'ef'.repeat(32)};await assert.rejects(dispatch(x,get,current),e=>e.code==='AUTH_SOURCE_V2_DISPATCH_EQUIVOCATION');assert.equal(c.fetches,0);cases.push('same sequence different historical head denied');
}
{
 const{c,get,current}=setup();const x=input();x.previous.executionHeight='11';await assert.rejects(dispatch(x,get,current),e=>e.code==='AUTH_SOURCE_V2_DISPATCH_OBSERVATION_ROLLBACK');assert.equal(c.fetches,0);cases.push('retained Native observation H cannot roll back');
}
{
 const{c,get,current}=setup();await assert.rejects(dispatch({...input(),provider:'PUBLIC'},get,current));assert.equal(c.gets,0);cases.push('no provider or callback selector in stdin schema');
}
{
 const{c,get,current}=setup();const x=input();x.rootRaw+=' ';await assert.rejects(dispatch(x,get,current));assert.equal(c.gets,0);cases.push('pinned original mismatch before any GET');
}
const args=['https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current','12'.repeat(32),'34'.repeat(32),'A'.repeat(43)];
for(const mode of ['bad-status','bad-mime','oversize','timeout','truncated']){
 globalThis.__auth101http={mode};await assert.rejects(fetchSourceCurrentV2(...args));cases.push('fixed HTTP '+mode+' denied');
}
globalThis.__auth101http={mode:'large'};assert((await fetchSourceCurrentV2(...args)).length>8192);cases.push('fixed v2 N1 cap accepts larger envelope DATA');
globalThis.__auth101http={mode:'large'};await assert.rejects(fetchSourceCurrent(...args),e=>e.code==='AUTH_IDENTITY_SOURCE_CURRENT_CAPACITY');cases.push('legacy cap remains unchanged');
console.log(JSON.stringify({cases:cases.length,results:cases,actualDispatch:true,actualHTTPEventBody:true,mathAndViews:'PUBLIC seams; SDK327 math CI separate',network:'PUBLIC events, not TLS success',nativeAdmission:false},null,2));

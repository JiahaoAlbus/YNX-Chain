import test from'node:test';import assert from'node:assert/strict';import{readFileSync,mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{createServer}from'node:http';import{randomBytes}from'node:crypto';import{p256}from'@noble/curves/nist.js';
import{ProductSessionGatewayNodeHost,readOriginalDeveloperHTTPCredential}from'./src/product-session-gateway-node-host.js';import{createProductSessionRequest,signProductSessionApproval,signProductSessionChallenge}from'./src/product-session-v2.js';import{createProductSessionProofV2}from'./src/product-session-proof-v2.js';import{encodeProductSessionGatewayProofHeaderV2}from'./src/product-session-gateway-client.js';import{canonicalJSON}from'./src/canonical.js';import{httpBodyDigest}from'./src/session-proof.js';import{evmAddressFromYNX}from'./src/crypto.js';
import{OriginalAuthSourceCurrentV2Kernel}from'./src/original-auth-source-current-v2.js';import{handleOriginalDeveloperPrincipalCurrent}from'./src/original-auth-identity-source-current.js';import{keyGen,batchSign,extract,encodeMember,discardBatch,destroyKey}from'@ynx/batch-v01-candidate';import{canonical,sha}from'./native/original-auth-identity-source-verifier.mjs';import{encodeOriginalAuthSourceStatementV2 as frame,canonicalOriginalAuthSourceEnvelopeV2 as envelope}from'./native/original-auth-identity-source-v2-verifier.mjs';
const registry=JSON.parse(readFileSync(new URL('./product-session-registry.json',import.meta.url))),token=()=>randomBytes(32).toString('base64url'),device=Buffer.alloc(32,9),secret=device.toString('base64url');
// Only PUBLIC fixture keys. Actual HTTP, original PS authority/current/replay,
// atomic persisted file and registered dual-signature mathematics are real;
// no real Root, customer keys, admission or deployed identity is asserted.
const keys=Array.from({length:4},()=>keyGen({provider:'portable'}));test.after(()=>keys.forEach(k=>destroyKey(k.privateKey)));
async function fixture(productId='developer'){
 const dir=mkdtempSync(join(tmpdir(),'ynx-http-principal-PUBLIC-'));let now=new Date();const start=+now;
 const options={statePath:join(dir,'state'),now:()=>now,tokenFactory:token};const host=new ProductSessionGatewayNodeHost(registry,options),server=createServer(host.handler());await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,body,headers={})=>{const r=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json','x-request-id':'req_'+token(),...headers},body:canonicalJSON(body)});return{status:r.status,body:await r.json()};};
 const request=createProductSessionRequest(registry,{productId,platform:'macos',deviceId:token(),deviceKey:Buffer.from(p256.getPublicKey(device,true)).toString('base64url'),scopes:productId==='developer'?['account:read']:['social.profile'],purpose:'PUBLIC identity regression only',nonce:token(),state:token()},now),approval=signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt},now);
 const challenge=await call('/v2/product-sessions/challenge',{request,approval});assert.equal(challenge.status,200);
 const complete=await call('/v2/product-sessions/complete',{request,approval,completion:signProductSessionChallenge(challenge.body.result,secret)});assert.equal(complete.status,200);const session=complete.body.result;
 const bound=(path='/api/developer/projects',body='{}')=>({requestId:'req_'+token(),method:'POST',path,body,proofHeader:encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session,{method:'POST',path,bodyDigest:httpBodyDigest(body),nonce:token(),issuedAt:now.toISOString(),expiresAt:new Date(Math.min(+now+30000,Date.parse(session.expiresAt))).toISOString()},secret))});
 return{host,session,options,start,now:()=>+now,advance:ms=>{now=new Date(+now+ms)},bound,call,revoke:async()=>{const path='/v2/product-sessions/revoke',b=bound(path,'{}');const r=await call(path,{}, {'x-ynx-product-session-proof-v2':b.proofHeader});assert.equal(r.status,200)},close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true})}};
}

async function rootFixture(f,patch={}){
 const owners=['0x'+'1'.repeat(40),'0x'+'2'.repeat(40),'0x'+'3'.repeat(40),evmAddressFromYNX(f.session.account)],networkId='ab'.repeat(32),height='9007199254740993',purpose='ide-project-authority-v1',ops=['CurrentProject','CurrentPublisher','RecheckProject'];
 const contract={purpose,enrollmentFrame:'PUBLIC-ORIGINAL-ENROLLMENT',profileFrame:'PUBLIC-ORIGINAL-PROFILE',currentFrame:'PUBLIC-ORIGINAL-CURRENT'},policy={endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'aa'.repeat(32),signatureContract:contract};
 const signed=(role,index,body)=>{const b={networkId,owner:owners[index],keyVersion:'1',executionHeight:height};let batch;try{batch=batchSign(keys[index].privateKey,{chainId:Buffer.from(networkId,'hex'),owner:owners[index],purpose:'AUTH-SOURCE-'+role.toUpperCase()},[Buffer.from(frame(role,contract[role+'Frame'],b,canonical(body)))]).batch;return envelope(role,b,canonical(body),encodeMember(extract(batch,0)));}finally{if(batch)discardBatch(batch)}};
 const rootRaw=canonical({version:2,algorithmVersion:'YNX-BATCH/v0.1',purpose,rootId:'PUBLIC-not-admitted',networkId,rootOwner:owners[0]});policy.rootDigest=sha(rootRaw);
 const e={version:2,purpose,rootId:'PUBLIC-not-admitted',rootOwner:owners[0],sourceId:'PUBLIC-source',service:purpose,productId:'developer',platform:'macos',applicationId:f.session.applicationId,gatewayOrigin:'https://wallet-auth.ynxweb4.com',registryDigest:'bb'.repeat(32),profileOwner:owners[1],currentOwner:owners[2],endpoint:policy.endpoint,spki:policy.spki,currentStatePath:'/PUBLIC-NOT-PROVISIONED/current',operations:ops,issuedAtMs:f.start-1000,expiresAtMs:f.start+60000};
 const enrollmentRaw=signed('enrollment',0,e);policy.enrollmentDigest=sha(enrollmentRaw);
 const principal={account:f.session.account,deviceId:f.session.deviceId,sessionRef:f.session.sessionBinding,currentRef:'PUBLIC-original-auth-current',accountGeneration:'9007199254740993',sessionGeneration:'18446744073709551615',expiresMS:f.start+15000,...patch};
 const p={version:2,purpose,sourceId:e.sourceId,enrollmentDigest:policy.enrollmentDigest,instanceId:'PUBLIC-instance',generation:1,minimumSequence:1,minimumFloor:0,subjectOwner:owners[3],selection:{association:{account:f.session.account,clientId:f.session.clientId,productId:f.session.productId,platform:f.session.platform,applicationId:f.session.applicationId,deviceId:f.session.deviceId},expectedRequest:{service:e.service,productId:e.productId,platform:e.platform,applicationId:e.applicationId,gatewayOrigin:e.gatewayOrigin,registryDigest:e.registryDigest,operations:ops,instanceId:'PUBLIC-instance'},originalHostStatePath:'/PUBLIC-HOST',originalHostTerminalDirectory:'/PUBLIC-HOST.private-terminal',projectAuthority:{principal,project:{projectId:'PUBLIC-project',ownerAccount:f.session.account,runtimeOrigin:'https://PUBLIC.invalid',currentReference:'PUBLIC-project-current',projectRevision:'1',catalogRevision:'1',read:true,publish:false,runtime:false,expiresMS:f.start+15000},publisher:null,endpoint:'https://wallet-auth.ynxweb4.com/v1/developer',spki:'cc'.repeat(32)}},issuedAtMs:f.start-500,expiresAtMs:f.start+30000};
 p.selection.projectAuthority.project.runtimeOrigin='https://public.invalid'; // URL origins are canonical lowercase.
 const profileRaw=signed('profile',1,p),digest=sha(profileRaw),records=new Map();let observations=0,onObserve=null;
 const get=async(_node,owner)=>{if(onObserve)await onObserve(++observations);const i=owners.indexOf(owner);return{owner,executionHeight:height,ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner,pkA:keys[i].publicKey.pkA.toString('hex'),pkB:keys[i].publicKey.pkB.toString('hex'),revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]}};
 const io={openV2(){return{}},ready(){},list(){return[...records.keys()]},read(_l,n){return records.get(n)},write(_l,n,v){assert(!records.has(n));records.set(n,v)},close(){}};
 const signer={assertCurrent(){},signCurrent(m,b){let batch;try{batch=batchSign(keys[2].privateKey,{chainId:Buffer.from(networkId,'hex'),owner:owners[2],purpose:'AUTH-SOURCE-CURRENT'},[Buffer.from(m)]).batch;return encodeMember(extract(batch,0))}finally{if(batch)discardBatch(batch)}},close(){}};
 const kernel=new OriginalAuthSourceCurrentV2Kernel(rootRaw,enrollmentRaw,[profileRaw],policy,{origin:'https://PUBLIC.invalid',spki:'dd'.repeat(32),nativeChainId:'6423'},signer,io,f.now,get);await kernel.initialize();await kernel.transition(digest,{status:'active',floor:0,head:'ee'.repeat(32)});
 return{kernel,digest,principal,setObserve:fn=>{onObserve=fn;observations=0}};
}


// Prepended by the bounded runner to the original PUBLIC fixture declarations;
// none of that file's previously green tests run here.
import {r237PUBLICBrand} from './src/original-auth-identity-source-current.js';
async function principalHTTP(action){
 const f=await fixture();let r,server;
 try{
  r=await rootFixture(f);r237PUBLICBrand(r.kernel);
  const host=new ProductSessionGatewayNodeHost(registry,{...f.options,authIdentitySourceCurrent:r.kernel});
  const method=host.currentExistingDeveloperPrincipal.bind(host);
  host.currentExistingDeveloperPrincipal=async input=>{const result=await method(input);await action(f,r,result);return result;};
  server=createServer(host.handler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/developer/original-http-principal`,{method:'POST',headers:{'content-type':'application/json','x-request-id':'req_'+token()},body:canonicalJSON({operation:'authenticate',...f.bound()})});
  return {status:response.status,raw:await response.text()};
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}r?.kernel.close();await f.close();}
}
test('physical Principal writer denies expiry after actual Source result completion',async()=>{
 const out=await principalHTTP(f=>f.advance(15000));assert.notEqual(out.status,200);assert(!out.raw.includes('principalOriginal'));
});
test('physical Principal writer denies same Source retirement after awaited result',async()=>{
 const out=await principalHTTP((_f,r)=>r.kernel.retire());assert.notEqual(out.status,200);assert(!out.raw.includes('principalOriginal'));
});
test('physical Principal writer denies same Source close after awaited result',async()=>{
 const out=await principalHTTP((_f,r)=>r.kernel.close());assert.notEqual(out.status,200);assert(!out.raw.includes('principalOriginal'));
});
test('physical Principal writer delivers unchanged original DATA with no authority promotion',async()=>{
 const out=await principalHTTP(()=>{});assert.equal(out.status,200);const body=JSON.parse(out.raw);assert.equal(body.authorized,false);assert.equal(body.nativeAdmission,false);assert.equal(body.dataOnly,true);assert.equal(sha(body.principalOriginal),body.principalSHA256);assert(body.principalOriginal.includes('9007199254740993'));assert.deepEqual(Object.keys(body).sort(),['version','principalOriginal','principalSHA256','profileDigest','currentRaw','method','path','bodyDigest','expiresAtMs','dataOnly','authorized','nativeAdmission'].sort());
});
test('physical Principal writer denies an original Source row transition during response continuation',async()=>{
 const out=await principalHTTP(async(_f,r)=>r.kernel.transition(r.digest,{status:'revoked',floor:0,head:'ef'.repeat(32)}));assert.notEqual(out.status,200);assert(!out.raw.includes('principalOriginal'));
});
test('physical Principal writer denies original PS expiry after the narrower Source lifetime',async()=>{
 const out=await principalHTTP(f=>f.advance(30000));assert.notEqual(out.status,200);assert(!out.raw.includes('principalOriginal'));
});
test('same Source completion rejects a copied DATA object and wrong credential',async()=>{
 const f=await fixture();let r;try{r=await rootFixture(f);const c=await f.host.authenticateOriginalDeveloperHTTPRequest(f.bound()),out=await r.kernel.existingDeveloperPrincipal(c);assert.equal(typeof r.kernel.assertOriginalDeveloperPrincipalCompletion,'function');r.kernel.assertOriginalDeveloperPrincipalCompletion(c,out);assert.throws(()=>r.kernel.assertOriginalDeveloperPrincipalCompletion(c,{...out}),/COMPLETION_NOT_ORIGINAL/);assert.throws(()=>r.kernel.assertOriginalDeveloperPrincipalCompletion({},out),/COMPLETION_NOT_ORIGINAL/);}finally{r?.kernel.close();await f.close();}
});
test('same opaque credential completion denies a real persisted session revocation',async()=>{
 const f=await fixture();let r;try{r=await rootFixture(f);const c=await f.host.authenticateOriginalDeveloperHTTPRequest(f.bound()),out=await r.kernel.existingDeveloperPrincipal(c);await f.revoke();assert.throws(()=>r.kernel.assertOriginalDeveloperPrincipalCompletion(c,out),{code:'ORIGINAL_HTTP_COMPLETION_CHANGED'});}finally{r?.kernel.close();await f.close();}
});
test('normal branded Principal handler fences expiry after awaiting the original kernel',async()=>{
 const f=await fixture();let r;try{r=await rootFixture(f);r237PUBLICBrand(r.kernel);const c=await f.host.authenticateOriginalDeveloperHTTPRequest(f.bound()),method=r.kernel.existingDeveloperPrincipal.bind(r.kernel);r.kernel.existingDeveloperPrincipal=async input=>{const out=await method(input);f.advance(15000);return out;};await assert.rejects(handleOriginalDeveloperPrincipalCurrent(r.kernel,c),/EXPIRED/);}finally{r?.kernel.close();await f.close();}
});

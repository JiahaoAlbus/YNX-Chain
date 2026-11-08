// PUBLIC controlled deterministic keys only; never copied into runtime/source.
// No keys are exported or persisted. Static PUBLIC fixture originals repeat
// across child processes so the genuine fixed stdin runner can be exercised.
import fs from 'node:fs';import crypto from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
// PUBLIC local fixture config is read from the same facts file, including when
// the production qualification runner starts with Env=[]. No production port.
const factsFile=process.argv[2]==='generate'?process.argv[3]:new URL('./PUBLIC-facts.json',import.meta.url);
const testConfig=JSON.parse(fs.readFileSync(factsFile,'utf8'));
const sdk=testConfig.PUBLICSDKRoot;
if(typeof sdk!=='string'||!path.isAbsolute(sdk)||path.normalize(sdk)!==sdk||fs.realpathSync(sdk)!==sdk)throw Error('PUBLIC_SDK_ROOT_REQUIRED');
const sdkURL=relative=>pathToFileURL(path.join(sdk,relative)).href;
const {createReceiverFixture}=await import(sdkURL('test/fixtures/task-read-receiver-source.fixture.mjs'));
const {canonical,sha}=await import(sdkURL('native/original-auth-identity-source-verifier.mjs'));
const {projectOriginalTaskReadReceiverRegistrationV1DATA}=await import(sdkURL('native/original-task-read-receiver-source-contract.mjs'));
export function fixture(facts){
 if(facts.PUBLICSDKRoot!==sdk)throw Error('PUBLIC_SDK_ROOT_CHANGED');
 const oldRandom=crypto.randomBytes,oldNow=Date.now,oldWebRandom=globalThis.crypto.getRandomValues;let count=0;
 crypto.randomBytes=n=>{const out=Buffer.alloc(n);for(let i=0;i<n;i+=32)crypto.createHash('sha256').update('PUBLIC-ONLY-RECEIVER-NOT-ROOT/'+count++).digest().copy(out,i,0,Math.min(32,n-i));return out};globalThis.crypto.getRandomValues=out=>{new Uint8Array(out.buffer,out.byteOffset,out.byteLength).set(crypto.randomBytes(out.byteLength));return out};syncBuiltinESMExports();Date.now=()=>facts.at;
 let f;try{f=createReceiverFixture();const raw=Buffer.from(facts.projectionOriginalB64,'base64url'),observed=JSON.parse(raw).Snapshot.ObservedAt;
  Object.assign(f.scope,projectOriginalTaskReadReceiverRegistrationV1DATA(JSON.parse(facts.registrationOriginal)),{sourceProjection:{bytes:raw.length,sha256:sha(raw)}});
  f.taskSource={rootIdentity:{rootId:'PUBLIC-NOT-ROOT',rootOwner:f.owners[0],networkId:f.network},subjectOwner:f.owners[3],authority:f.scope.authority,realm:f.scope.realm,tenant:f.scope.tenant,version:f.scope.sourceVersion,projectionOriginalB64:facts.projectionOriginalB64,observedMS:observed,expiresMS:f.scope.expiresMS};
  // PUBLIC sample assembly only: bind the profile to the same fixed initial
  // Go sample window before signing. Never extend it on a later Current call.
  f.p.expiresAtMs=Number(f.scope.expiresMS);
  const platform=process.platform==='darwin'?'macos':'linux';f.e.platform=platform;f.association.platform=platform;f.p.selection.expectedRequest.platform=platform;f.policy.platform=platform;f.enrollmentRaw=f.ctx.sign('enrollment',0,f.e,f.policy.signatureContract.enrollmentFrame);f.policy.enrollmentDigest=sha(f.enrollmentRaw);f.p.enrollmentDigest=f.policy.enrollmentDigest;
  f.profileRaw=f.ctx.sign('profile',1,f.p,f.policy.signatureContract.profileFrame);
  f.current=nonce=>{const c={version:2,purpose:f.p.purpose,sourceId:f.p.sourceId,enrollmentDigest:f.policy.enrollmentDigest,profileDigest:sha(f.profileRaw),instanceId:f.p.instanceId,generation:1,subjectOwner:f.owners[3],subjectKeyVersion:'1',sequence:1,floor:0,head:sha(canonical(f.scope)),status:facts.status??'active',nonce,issuedAtMs:oldNow()-100,expiresAtMs:Math.min(oldNow()+10000,Number(f.scope.expiresMS))};return f.ctx.sign('current',2,c,f.policy.signatureContract.currentFrame)};
  f.currentRaw=f.current(Buffer.alloc(32,12).toString('base64url'));f.input={...f.input,enrollmentRaw:f.enrollmentRaw,profileRaw:f.profileRaw,headRaw:f.currentRaw};
  return f;
 }catch(e){f?.close();throw e}finally{crypto.randomBytes=oldRandom;globalThis.crypto.getRandomValues=oldWebRandom;syncBuiltinESMExports();Date.now=oldNow}
}
if(process.argv[2]==='generate'){const facts=JSON.parse(fs.readFileSync(process.argv[3],'utf8')),f=fixture(facts);try{process.stdout.write(canonical({rootRaw:f.rootRaw,enrollmentRaw:f.enrollmentRaw,profileRaw:f.profileRaw,headRaw:f.currentRaw,policy:f.policy,rootIdentity:f.taskSource.rootIdentity,subjectOwner:f.owners[3],sourceId:f.scope.sourceId,instanceId:f.scope.instanceId,node:f.input.node}))}finally{f.close()}}

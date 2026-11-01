import test from 'node:test';import assert from 'node:assert/strict';import fs from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{PendingPairOriginalQueryServerKernel}from'../../src/product-pair-pending-query-server-kernel.mjs';
import{inspectOriginalPendingPairQueryN1WithRegisteredSourceDATA,assertOriginalPendingPairQueryServerOwnerV1}from'../../src/product-pair-pending-query-server.mjs';
import{openProductPairSessionV4Store,openProductPairSessionV4CurrentStore,pairV4Digest}from'../../src/product-pair-session-v4-store.js';
// New SERVER orchestration control using existing Core PUBLIC golden, NOT a
// rerun of codec interop. No private key is read/generated/signed in this test.
// Source/custody remain explicit PUBLIC seams, rejected by normal owner guard.
test('Core public signed E13 traverses actual stage→SQLite original→full→UNKNOWN server pipeline',async()=>{
 const file=new URL('../fixtures/pending-query-e13-core-external-c-public.json',import.meta.url),bytes=fs.readFileSync(file);assert.equal(pairV4Digest(bytes),'57f0971dc576678439699ec597b4d412ae6aa71bfb22dbaa4a64de9a6ea66ee3');const g=JSON.parse(bytes),e=g.expected,queryOriginal=Buffer.from(g.queryOriginalBase64,'base64'),registrationOriginal=Buffer.from(g.registrationOriginalBase64,'base64'),post=Buffer.from(g.originalPairPostBase64,'base64'),memberOriginal=Buffer.from(g.memberOriginalBase64,'base64'),query=JSON.parse(queryOriginal),dir=fs.realpathSync(fs.mkdtempSync(join(process.env.RUNNER_TEMP??tmpdir(),'auth-pending-core-server-')));fs.chmodSync(dir,448);const path=join(dir,'original.sqlite'),namespace='PUBLIC-core-server',writer=openProductPairSessionV4Store({path,namespace});let reader,kernel;
 try{
  writer.reserve({actor:e.actorDigest,operation:query.operationId,kind:'PAIR',input:post.toString(),at:e.atMs});reader=openProductPairSessionV4CurrentStore({path,namespace});
  const source={serviceOrigin:e.serviceOrigin,async acquire(){return{owner:{expiresAtMs:e.sourceExpiresAtMs,recheck(){},assertCurrent(){},retire(){},join(){},close(){}},error:null,expected:{networkId:e.networkId,canonicalOwner:e.owner,pkA:e.pkA,pkB:e.pkB,registrationOriginal:registrationOriginal.toString(),serviceOrigin:e.serviceOrigin,sourceIssuedAtMs:e.sourceIssuedAtMs,sourceExpiresAtMs:e.sourceExpiresAtMs}};},captureOriginal(q,actor){return reader.capturePendingPairOriginalQueryDATA({queryOriginal:q,actor});},retire(){},join(){},close(){}};
  kernel=new PendingPairOriginalQueryServerKernel(source,inspectOriginalPendingPairQueryN1WithRegisteredSourceDATA,()=>e.atMs);assert.throws(()=>assertOriginalPendingPairQueryServerOwnerV1(kernel));const before=pairV4Digest(fs.readFileSync(path+'-wal'));
  const result=await kernel.query({queryOriginal,registrationOriginal,memberOriginal,transport:{nonce:e.nonce,issuedAt:e.issuedAt,expiresAt:e.expiresAt,serviceOrigin:e.serviceOrigin}});assert.equal(result.state,'UNKNOWN');assert.equal(result.newSession,false);assert.equal(result.retryAuthorized,false);assert.equal(pairV4Digest(fs.readFileSync(path+'-wal')),before);
 }finally{await kernel?.close();reader?.close();writer.close();fs.rmSync(dir,{recursive:true,force:true});}
});

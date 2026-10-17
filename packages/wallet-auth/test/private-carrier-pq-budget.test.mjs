import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {p256} from '@noble/curves/nist.js';
import {keyGen,destroyKey,batchSign,discardBatch,extract,encodeMember,decodeMember,encodeCertificate} from '@ynx/batch-v01-candidate';
import {canonicalJSON} from '../src/canonical.js';
import {ynxAddressFromEVM} from '../src/crypto.js';
import {createProductSessionRequest,createProductSessionChallenge,signProductSessionChallenge} from '../src/product-session-v2.js';
import {createPQWalletKeyHandle,destroyPQWalletKeyHandle,readPQWalletKeyPublic,signPQWalletProductSessionApproval} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
import {captureProductSessionAccountPolicy} from '../src/product-session-account-policy.js';
import {preparePQProductSessionApproval,verifyPQProductSessionApproval} from '../src/product-session-pq-approval.js';
import {createProductSessionReturnURL} from '../src/product-session-router.js';
import {OriginalWalletServicePrivateClient} from '../src/original-wallet-service-private-client.js';
import {originalPrivateSessionCarrier,ORIGINAL_PRIVATE_PQ_CARRIER} from '../src/original-wallet-service-private-carrier.js';
import {decodeOriginalWalletServicePrivateRequest} from '../src/original-wallet-service-private-dispatch.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
// Actual unique provider and exact client/dispatcher codec. The bridge returns
// an explicit non-grant 503; no fixture can acquire Native custody or a session.
test('version/purpose-scoped N1 private carrier fits full proof while legacy/other lanes and N2 remain refused',async t=>{
 const at=new Date('2026-10-18T00:00:00.000Z'),network={chainId:'71'.repeat(32),owner:'0x'+'11'.repeat(20)},account=ynxAddressFromEVM(network.owner),handle=await createPQWalletKeyHandle(network);let n2;
 const oldWindow=globalThis.window;
 try{
  const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
  const view={version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:network.chainId,canonicalOwner:network.owner,checkpoint:{kind:'trusted-node-committed/v1',height:'100',blockHash:'22'.repeat(32)},policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:{revision:'1',registeredAt:'10',activeFrom:'20',pkA:keys.pkA,pkB:keys.pkB},observedAt:at.toISOString(),expiresAt:'2026-10-18T00:00:30.000Z'};
  const resource={readOriginal:()=>view,assertCurrent(){},async recheck(){},retire(){},async join(){},async close(){}};
  const observation=captureProductSessionAccountPolicy(resource,{networkId:network.chainId,account},at);
  const request=createProductSessionRequest(registry,{productId:'finance',platform:'web',deviceId:'a'.repeat(43),deviceKey:Buffer.from(p256.getPublicKey(Buffer.alloc(32,7),true)).toString('base64url'),scopes:['finance.portfolio.read'],purpose:'Explicit account session',nonce:'b'.repeat(43),state:'c'.repeat(43)},at);
  const approval=signPQWalletProductSessionApproval(handle,preparePQProductSessionApproval(registry,request,{account,expiresAt:request.expiresAt},observation,at),at),body=canonicalJSON({request,approval}),input={requestId:'req_private_pq_carrier_01',operation:'beginYNX',phase:'effect',body,proofHeader:null};
  const carrier=originalPrivateSessionCarrier(input),raw=canonicalJSON(carrier);assert.equal(carrier.carrierVersion,ORIGINAL_PRIVATE_PQ_CARRIER);assert.deepEqual(decodeOriginalWalletServicePrivateRequest(raw),carrier);
  const verified=verifyPQProductSessionApproval(registry,request,approval,observation,at);
  const challenge=createProductSessionChallenge(registry,request,approval,{challenge:'d'.repeat(43)},at,verified.verifiedApproval),completion=signProductSessionChallenge(challenge,Buffer.alloc(32,7).toString('base64url'));
  const completionBody=canonicalJSON({request,approval,completion}),completionRaw=canonicalJSON({...carrier,requestId:'req_private_pq_return_01',operation:'handleReturn',body:completionBody});assert.equal(decodeOriginalWalletServicePrivateRequest(completionRaw).operation,'handleReturn');
  const callback=createProductSessionReturnURL(registry,request,{result:'approved',approval},at,verified.verifiedApproval);
  assert(Buffer.byteLength(body)>49152&&Buffer.byteLength(raw)>65536);assert(Buffer.byteLength(body)<=196608&&Buffer.byteLength(raw)<=262144);
  assert.throws(()=>decodeOriginalWalletServicePrivateRequest(canonicalJSON(input)),{code:'ORIGINAL_PRIVATE_CAPACITY'});
  for(const patch of [{operation:'restore'},{phase:'time'},{carrierVersion:'UNKNOWN/v3'}])assert.throws(()=>decodeOriginalWalletServicePrivateRequest(canonicalJSON({...carrier,...patch})));
  n2=keyGen({provider:'portable'});const original=decodeMember(Buffer.from(approval.walletProof,'base64url'));
  const batch=batchSign(n2.privateKey,{chainId:Buffer.from(network.chainId,'hex'),owner:network.owner,purpose:'PRODUCT-SESSION-APPROVAL'},[original.message,original.message]);
  let n2Wire;try{n2Wire=encodeMember(extract(batch.batch,0));}finally{discardBatch(batch.batch);}
  const n2Body=canonicalJSON({request,approval:{...approval,walletProof:n2Wire.toString('base64url')}});
  assert.throws(()=>decodeOriginalWalletServicePrivateRequest(canonicalJSON({...carrier,body:n2Body})),{code:'ORIGINAL_PRIVATE_PQ_N1_REQUIRED'});
  let calls=0,captured;
  globalThis.window={ynxDesktopWallet:{async originalServiceDispatch(wire){calls++;captured=wire;const decoded=decodeOriginalWalletServicePrivateRequest(wire);return {status:503,headers:{'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-request-id':decoded.requestId},body:canonicalJSON({error:{code:'QA_SOURCE_NOT_SUPPLIED',message:'Explicit non-grant test transport'},ok:false,requestId:decoded.requestId,schemaVersion:2})};}}};
  const client=new OriginalWalletServicePrivateClient({timeoutMs:1000});assert.equal((await client.request('beginYNX','effect',input.requestId,body,null)).status,503);assert.equal(captured,raw);assert.equal(calls,1);
  await assert.rejects(client.request('beginYNX','effect','req_private_legacy_large_1',canonicalJSON({request,approval:{...approval,version:'2'}}),null));assert.equal(calls,1);
  t.diagnostic(JSON.stringify({N1CertificateBytes:encodeCertificate(original.certificate).length,N1MemberBytes:Buffer.from(approval.walletProof,'base64url').length,N1BeginBodyBytes:Buffer.byteLength(body),N1PrivateEnvelopeBytes:Buffer.byteLength(raw),N1CompletionBodyBytes:Buffer.byteLength(completionBody),N1CompletionEnvelopeBytes:Buffer.byteLength(completionRaw),callbackBytes:Buffer.byteLength(callback),N2CertificateBytes:encodeCertificate(decodeMember(n2Wire).certificate).length,N2MemberBytes:n2Wire.length,N2PrivateEnvelopeBytes:Buffer.byteLength(canonicalJSON({...carrier,body:n2Body})),N2AllowedForSession:false,version:ORIGINAL_PRIVATE_PQ_CARRIER,bodyMax:196608,envelopeMax:262144,NativeQualified:false}));
 }finally{globalThis.window=oldWindow;if(n2)destroyKey(n2.privateKey);destroyPQWalletKeyHandle(handle);}
});

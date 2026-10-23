import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {encodePQContractDeploymentTransportData} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from './typed-action-caller.mjs';
import * as reader from './typed-action-transport-reader.mjs';
import {inspectPQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import {preparePQReviewedTypedActionFinalityTarget} from './finality-invocation.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=b=>'0x'+sha(b),copy=v=>JSON.parse(JSON.stringify(v));
const fixtureRaw=gunzipSync(readFileSync(new URL('./fixtures/contract-deployment-fbec-original.json.gz',import.meta.url)),{maxOutputLength:4<<20});
assert.equal(sha(fixtureRaw),'ca39d8b803a118bb468ce2806cf7654ccf120c091c0364f973e859fedeba5982');
const f=JSON.parse(fixtureRaw),rawGo=Buffer.from(f.transport,'base64'),memberGo=Buffer.from(f.nativeWire,'base64');
const material=Object.fromEntries(f.files.filter(r=>r.role!=='source').map(r=>[r.role,Buffer.from(r.bytes,'base64')]));
const b=f.accountBefore,p=b.policy,active=p.records.filter(r=>BigInt(r.activeFrom)<=BigInt(b.executionHeight)).at(-1);
const dto={owner:b.owner,executionHeight:b.executionHeight,ledgerNonce:b.ledgerNonce,algorithmVersion:active.algorithmVersion,enabled:b.enabled,policyVersion:p.version,networkId:p.networkId,enableAt:p.enableAt,activeRevision:active.revision,records:p.records,...(p.revocations?.length?{revocations:p.revocations}:{})};
const network={owner:f.owner,chainId:f.networkId,nativeChainId:f.nativeChainId},snapshot=parsePQAccountAuthorization(dto,network),expected={account:f.owner,networkId:f.networkId,memberHash:hash(memberGo),transportHash:hash(rawGo)};
let handle,review,raw,original,member;
before(async()=>{
 handle=await createPQWalletKeyHandle({owner:f.owner,chainId:f.networkId});const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 const ownDto={owner:f.owner,executionHeight:'20',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:f.networkId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:f.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 const s=parsePQAccountAuthorization(ownDto,network),at=Date.parse('2026-10-23T00:00:00Z');
 review=preparePQTypedActionReview(s,{chainId:f.networkId,nativeChainId:'6423',owner:f.owner,nonce:'2',fee:'10',kind:'contract_deploy',payload:f.payload},{operationId:'controlled-material-reader',account:f.owner,networkId:f.networkId,createdAt:new Date(at).toISOString(),expiresAt:new Date(at+30000).toISOString()});
 member=signPQReviewedTypedAction(review,s,handle,{account:f.owner,networkId:f.networkId},at);
 raw=encodePQContractDeploymentTransportData({member,source:f.source,material});original={reviewSnapshot:s,signingSnapshot:s,selectedBinding:{account:f.owner,networkId:f.networkId},memberHash:hash(member),transportHash:hash(raw)};
});
after(()=>{if(handle)assert.equal(destroyPQWalletKeyHandle(handle),true)});
const inspect=(wire=raw,own=original,r=review)=>inspectPQReviewedTypedTransportOriginal(r,wire,own);
const pqError=e=>typeof e?.code==='string'&&e.code.startsWith('PQ_');
test('reviewed deployment retains complete source and compiler files rather than dropping five-field envelope',()=>{
 const value=inspect();assert.equal(value.action.kind,'contract_deploy');assert.equal(value.memberCount,1);assert.equal(value.memberIndex,0);assert.equal(value.compilerMaterialValidationRequired,true);
 assert.equal(value.source,f.source);assert.deepEqual(Buffer.from(value.material.artifactFile),material.artifactFile);assert.deepEqual(Buffer.from(value.material.buildInfoFile),material.buildInfoFile);assert.deepEqual(Buffer.from(value.body),Buffer.from(raw));assert.equal(value.transportHash,hash(raw));assert.equal(value.memberHash,hash(member));assert.equal(value.signatureVerified,true);
 for(const k of ['nativeAdmission','permissionGranted','submitted','canRetry','clearsOriginal','consensusFinality'])assert.equal(value[k],false);
 const m=value.material;m.artifactFile.fill(0);assert.deepEqual(Buffer.from(value.material.artifactFile),material.artifactFile);
});
test('actual Go deployment original preserves generic N2/index1 and cannot impersonate local reviewed N1',()=>{
 const value=reader.inspectPQContractDeploymentTransportOriginal(snapshot,rawGo,expected);assert.equal(value.memberCount,2);assert.equal(value.memberIndex,1);assert.equal(value.transportHash,'0x'+f.transportSha256);assert.equal(value.source,f.source);assert.equal(value.compilerMaterialValidationRequired,true);
 assert.throws(()=>inspect(rawGo,{reviewSnapshot:snapshot,signingSnapshot:snapshot,selectedBinding:{account:f.owner,networkId:f.networkId},memberHash:expected.memberHash,transportHash:expected.transportHash}),pqError);
});
test('full transport hash binds material and shared finality target echoes all five fields',()=>{
 const changed=encodePQContractDeploymentTransportData({member,source:f.source,material:{...material,artifactFile:Buffer.from('{}')}});
 assert.throws(()=>inspect(changed),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});
 const block={chainId:'controlled',headerHeight:'21',blockHash:'ab'.repeat(32),stateHeight:'20',stateAppHash:'cd'.repeat(32)};
 const target={block,successor:{...block,headerHeight:'22',stateHeight:'21',blockHash:'ef'.repeat(32)},transactionType:'pq_action',envelope:Buffer.from(raw).toString('base64'),nativeWire:Buffer.from(member).toString('base64'),transactionHash:sha(raw),nativeWireHash:sha(member),index:'7'};
 assert.deepEqual(preparePQReviewedTypedActionFinalityTarget(review,raw,original,target),target);
 assert.throws(()=>preparePQReviewedTypedActionFinalityTarget(review,raw,original,{...target,envelope:Buffer.from(changed).toString('base64'),transactionHash:sha(changed)}),{code:'PQ_FINALITY_INVOCATION_ORIGINAL_MISMATCH'});
});
test('review discriminator, bytes and original bindings reject hostile input without invoking getters',()=>{
 let hits=0;const bad=copy(review);Object.defineProperty(bad,'action',{get(){hits++;throw Error('getter')},enumerable:true});assert.throws(()=>inspect(raw,original,bad),pqError);assert.equal(hits,0);
 assert.throws(()=>inspect(raw,{...original,memberHash:original.transportHash}),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});
 assert.throws(()=>inspect(raw,{...original,reviewSnapshot:undefined}),pqError);
 const ordinary=Buffer.from(JSON.stringify({version:1,type:'pq_action',wireHex:Buffer.from(member).toString('hex')}));assert.throws(()=>inspect(ordinary,{...original,transportHash:hash(ordinary)}),pqError);
});
test('ordinary reviewed actions retain their original codec and exact result surface in the SDK333 successor',()=>{
 const at=Date.parse(review.createdAt),s=original.signingSnapshot;
 const ordinaryReview=preparePQTypedActionReview(s,{chainId:f.networkId,nativeChainId:'6423',owner:f.owner,nonce:'2',fee:'0',kind:'stake',payload:{amount:'1'}},{operationId:'controlled-ordinary-successor',account:f.owner,networkId:f.networkId,createdAt:review.createdAt,expiresAt:review.expiresAt});
 const m=signPQReviewedTypedAction(ordinaryReview,s,handle,original.selectedBinding,at),wire=encodePQActionTransportData({member:m,originals:[]});
 const value=inspectPQReviewedTypedTransportOriginal(ordinaryReview,wire,{...original,memberHash:hash(m),transportHash:hash(wire)});
 assert.equal(value.action.kind,'stake');assert.deepEqual(Buffer.from(value.body),Buffer.from(wire));
 for(const k of ['material','source','compilerMaterialValidationRequired'])assert.equal(Object.hasOwn(value,k),false);
 assert.equal(value.memberCount,1);assert.equal(value.memberIndex,0);assert.equal(value.permissionGranted,false);
});

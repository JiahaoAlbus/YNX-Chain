import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from '../src/features/pq-transaction/typed-action-caller.mjs';
import {createPQTypedOriginalFromMember,parsePQTypedOriginalRecord,pqTypedFinalityArguments} from '../src/wallet-pq-typed-original.mjs';
import {decodePQContractDeploymentTransportData} from '@ynx-chain/wallet-auth/pq-contract-deployment-transport';
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
test('Main journal preserves full deployment material across cold original parsing',async()=>{
 const f=JSON.parse(gunzipSync(readFileSync(new URL('../src/features/pq-transaction/fixtures/contract-deployment-fbec-original.json.gz',import.meta.url)),{maxOutputLength:4<<20}));
 const handle=await createPQWalletKeyHandle({owner:f.owner,chainId:f.networkId});
 try{
  const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
  const dto={owner:f.owner,executionHeight:'20',ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:f.networkId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:f.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
  const snapshot=parsePQAccountAuthorization(dto,{owner:f.owner,chainId:f.networkId,nativeChainId:'6423'});
  const review=preparePQTypedActionReview(snapshot,{chainId:f.networkId,nativeChainId:'6423',owner:f.owner,nonce:'2',fee:'10',kind:'contract_deploy',payload:f.payload},{operationId:'main-deploy-original',account:f.owner,networkId:f.networkId,createdAt:'2026-10-23T00:00:00.000Z',expiresAt:'2026-10-23T00:00:30.000Z'});
  const member=signPQReviewedTypedAction(review,snapshot,handle,{account:f.owner,networkId:f.networkId},Date.parse(review.createdAt));
  const material=Object.fromEntries(f.files.filter(x=>x.role!=='source').map(x=>[x.role,Buffer.from(x.bytes,'base64')]));
  const archive={review,reviewSnapshot:snapshot,signingSnapshot:snapshot,deployment:{source:f.source,material}};
  const record=createPQTypedOriginalFromMember(member,archive);
  const restored=parsePQTypedOriginalRecord(JSON.parse(JSON.stringify(record)));
  const raw=Buffer.from(restored.wire,'base64url'),decoded=decodePQContractDeploymentTransportData(raw);
  assert.equal(decoded.source,f.source);assert.deepEqual(Buffer.from(decoded.material.artifactFile),material.artifactFile);assert.deepEqual(Buffer.from(decoded.material.buildInfoFile),material.buildInfoFile);
  assert.equal(record.hash,hash(raw));assert.equal(record.typed.memberHash,hash(member));assert.notEqual(record.hash,record.typed.memberHash);
  assert.deepEqual(Buffer.from(pqTypedFinalityArguments(restored).raw),raw);
  assert.throws(()=>createPQTypedOriginalFromMember(member,{review,reviewSnapshot:snapshot,signingSnapshot:snapshot}),e=>typeof e.code==='string');
  assert.throws(()=>parsePQTypedOriginalRecord({...restored,hash:record.typed.memberHash}),{code:'PQ_TYPED_ORIGINAL_INVALID'});
  material.artifactFile.fill(0);assert.deepEqual(Buffer.from(decodePQContractDeploymentTransportData(Buffer.from(restored.wire,'base64url')).material.artifactFile),Buffer.from(f.files.find(x=>x.role==='artifactFile').bytes,'base64'));
 }finally{assert.equal(destroyPQWalletKeyHandle(handle),true)}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createVerifier, decodeMember} from '@ynx/batch-v01-candidate';
import {parsePQAccountAuthorization, planPQAccountRevocation, assertPQRevocationRequestPolicy,
  preparePQReviewedRevocationTransport, assertPQAuthorizationCurrent} from '../src/pq-wallet-policy.js';
import {createPQWalletKeyHandle, readPQWalletKeyPublic, destroyPQWalletKeyHandle,
  signPQWalletAccountRevocation} from '../src/pq-wallet-key-backup.js';
import {pqPublicBindingToRegistrationKeys, decodePQRevocationRequest, encodePQRevocationRequest,
  encodePQRevocationIntent} from '../src/pq-wallet-authorization.js';
const vector=JSON.parse(await readFile(new URL('../testdata/pq-wallet-wire-r1.json',import.meta.url)));
const network={chainId:vector.transfer.fields.chainId,nativeChainId:'6423',owner:vector.transfer.fields.from};
const row=()=>({algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:vector.registration.fields.pkA,pkB:vector.registration.fields.pkB,
  revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'});
const raw=()=>({owner:network.owner,executionHeight:'25',ledgerNonce:'11',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,
  policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[row()]});
const intent=()=>({chainId:network.chainId,owner:network.owner,algorithmVersion:'YNX-BATCH/v0.1',pkA:row().pkA,pkB:row().pkB,
  authorizingRevision:'1',throughRevision:'1',ledgerNonce:'12',executeAt:'25',revokeAt:'26'});
const snapshot=dto=>parsePQAccountAuthorization(dto,network);
// PUBLIC synthetic ledger snapshots and isolated QA keys. No node, user consent,
// funds, real registration or terminal revocation is exercised here.
test('revocation binds exact execution, next nonce, active full pair and complete pending schedule',()=>{
  const s=snapshot(raw());assert.equal(planPQAccountRevocation(s,intent()).kind,'pq-account-revocation');
  const changes=[{chainId:'ee'.repeat(32)},{owner:'0x'+'ee'.repeat(20)},{pkA:'00'.repeat(2592)},{pkB:'00'.repeat(64)},
    {authorizingRevision:'2',throughRevision:'2'},{throughRevision:'2'},{ledgerNonce:'11'},{ledgerNonce:'13'},
    {executeAt:'24',revokeAt:'25'},{executeAt:'26',revokeAt:'27'}];
  for(const change of changes)assert.throws(()=>planPQAccountRevocation(s,{...intent(),...change}),{code:'PQ_REVOCATION_REVIEW_MISMATCH'});
  const dto=raw();dto.records.push({...row(),revision:'2',registeredAt:'24',activeFrom:'30',ledgerNonce:'2',pkA:'01'.repeat(2592),pkB:'02'.repeat(64)});
  const pending=snapshot(dto);assert.equal(planPQAccountRevocation(pending,{...intent(),throughRevision:'2'}).policy.activeRecord.revision,'1');
  assert.throws(()=>planPQAccountRevocation(pending,intent()),{code:'PQ_REVOCATION_REVIEW_MISMATCH'});
  assert.throws(()=>planPQAccountRevocation(pending,{...intent(),throughRevision:'2',authorizingRevision:'2',pkA:dto.records[1].pkA,pkB:dto.records[1].pkB}),{code:'PQ_REVOCATION_REVIEW_MISMATCH'});
  assert.throws(()=>assertPQAuthorizationCurrent(s,snapshot({...raw(),ledgerNonce:'12'})),{code:'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
  const advanced=snapshot({...raw(),executionHeight:'26'});
  assert.equal(assertPQAuthorizationCurrent(s,advanced),undefined);
  assert.throws(()=>planPQAccountRevocation(advanced,intent()),{code:'PQ_REVOCATION_REVIEW_MISMATCH'});
});
test('legacy, disabled, nonce exhaustion and pending/effective terminal tombstones refuse',()=>{
  const legacy=raw();legacy.algorithmVersion='legacy';legacy.records=[];delete legacy.activeRevision;
  assert.throws(()=>planPQAccountRevocation(snapshot(legacy),intent()),{code:'PQ_ACCOUNT_MIGRATION_REQUIRED'});
  const disabled={owner:network.owner,executionHeight:'25',ledgerNonce:'11',algorithmVersion:'legacy',enabled:false,records:[]};
  assert.throws(()=>planPQAccountRevocation(snapshot(disabled),intent()));
  assert.throws(()=>planPQAccountRevocation(snapshot({...raw(),ledgerNonce:'18446744073709551615'}),intent()),{code:'PQ_LEDGER_NONCE_EXHAUSTED'});
  const tombstone={...raw(),policyVersion:'YNX-ACCOUNT-POLICY/v2',revocations:[{owner:network.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:'25',revokedFrom:'26',ledgerNonce:'11'}]};
  assert.throws(()=>planPQAccountRevocation(snapshot(tombstone),intent()),{code:'PQ_TERMINAL_REVOCATION_PENDING'});
  assert.throws(()=>planPQAccountRevocation(snapshot({...tombstone,executionHeight:'26'}),{...intent(),executeAt:'26',revokeAt:'27'}),{code:'PQ_ACCOUNT_REVOKED'});
});
test('real dual-PQ current key signs only N1 ACCOUNT-REVOCATION and retired/unregistered key refuses',async()=>{
  const current=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner}),foreign=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner});
  try{
    const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(current));
    const dto=raw();Object.assign(dto.records[0],{pkA:pair.pkA,pkB:pair.pkB});
    const s=snapshot(dto),value={...intent(),pkA:pair.pkA,pkB:pair.pkB};
    const request=signPQWalletAccountRevocation(current,value,s),decoded=decodePQRevocationRequest(request.body);
    const member=decodeMember(decoded.currentPQMember);
    assert.equal(member.certificate.purpose,'ACCOUNT-REVOCATION');assert.equal(member.certificate.N,1);assert.equal(member.index,0);
    assert.deepEqual(member.message,encodePQRevocationIntent(value));
    const verifier=createVerifier({provider:'portable',chainId:Buffer.from(network.chainId,'hex'),purpose:'ACCOUNT-REVOCATION',resolveTrustedOwner:()=>({
      algorithmVersion:'YNX-BATCH/v0.1',enabled:true,owner:network.owner,chainId:Buffer.from(network.chainId,'hex'),
      pkA:Buffer.from(pair.pkA,'hex'),pkB:Buffer.from(pair.pkB,'hex'),purpose:'ACCOUNT-REVOCATION',policyRevision:'PUBLIC-only',activeFrom:0,revokedAt:null})});
    assert.equal(verifier.verifyOne(decoded.currentPQMember,{height:0}),true);
    assert.equal(assertPQRevocationRequestPolicy(s,request.body).intent.throughRevision,'1');
    assert.deepEqual(preparePQReviewedRevocationTransport(s,{intent:value,currentPQMember:decoded.currentPQMember}).request.body,request.body);
    const pendingDTO=structuredClone(dto);
    pendingDTO.records.push({...row(),revision:'2',registeredAt:'24',activeFrom:'30',ledgerNonce:'2',pkA:'01'.repeat(2592),pkB:'02'.repeat(64)});
    const pendingRequest=signPQWalletAccountRevocation(current,{...value,throughRevision:'2'},snapshot(pendingDTO));
    assert.equal(decodePQRevocationRequest(pendingRequest.body).intent.throughRevision,'2');
    assert.equal(verifier.verifyOne(decodePQRevocationRequest(pendingRequest.body).currentPQMember,{height:0}),true);
    const retained=request.body;retained.fill(0);
    assert.notDeepEqual(retained,request.body);
    assert.throws(()=>signPQWalletAccountRevocation(foreign,value,s),{code:'PQ_CURRENT_REGISTERED_KEY_MISMATCH'});
    const otherPair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(foreign));
    const otherDTO=raw();Object.assign(otherDTO.records[0],{pkA:otherPair.pkA,pkB:otherPair.pkB});
    const otherValue={...intent(),pkA:otherPair.pkA,pkB:otherPair.pkB};
    const other=decodePQRevocationRequest(signPQWalletAccountRevocation(foreign,otherValue,snapshot(otherDTO)).body);
    assert.throws(()=>assertPQRevocationRequestPolicy(s,encodePQRevocationRequest({intent:value,currentPQMember:other.currentPQMember})));
    destroyPQWalletKeyHandle(current);
    assert.throws(()=>signPQWalletAccountRevocation(current,value,s),{code:'PQ_KEY_HANDLE_UNAVAILABLE'});
  }finally{destroyPQWalletKeyHandle(current);destroyPQWalletKeyHandle(foreign);}
});

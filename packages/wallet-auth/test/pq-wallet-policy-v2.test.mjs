import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as policy from '../src/pq-wallet-policy.js';
const vector=JSON.parse(readFileSync(new URL('../testdata/pq-wallet-wire-r1.json',import.meta.url)));
const network={chainId:vector.transfer.fields.chainId,nativeChainId:'6423',owner:vector.transfer.fields.from};
const first=()=>({algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:vector.registration.fields.pkA,pkB:vector.registration.fields.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'});
const second=()=>({...first(),pkA:'11'.repeat(2592),pkB:'22'.repeat(64),revision:'2',registeredAt:'22',activeFrom:'30',ledgerNonce:'2'});
const revoked=()=>({owner:network.owner,authorizingRevision:'1',throughRevision:'2',registeredAt:'25',revokedFrom:'26',ledgerNonce:'3'});
const raw=()=>({owner:network.owner,executionHeight:'25',ledgerNonce:'3',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v2',networkId:network.chainId,enableAt:'10',records:[first(),second()],activeRevision:'1',revocations:[revoked()]});
// Public complete-policy DATA, no signer, node approval or account grant.
test('R37 pending terminal tombstone keeps final lawful transfer but refuses any further migration',()=>{
 const s=policy.parsePQAccountAuthorization(raw(),network);
 assert.equal(policy.inspectPQWalletActionPolicy(s,'pq-native-transfer').mode,'pq');
 assert.throws(()=>policy.inspectPQWalletActionPolicy(s,'pq-account-migration'),{code:'PQ_TERMINAL_REVOCATION_PENDING'});
 assert.deepEqual(s.revocations,[revoked()]);assert(Object.isFrozen(s.revocations[0]));
});
test('R37 terminal revocation blocks both activated and already pending keys and classic fallback',()=>{
 for(const [height,revision] of [['26','1'],['30','2']]){
  const s=policy.parsePQAccountAuthorization({...raw(),executionHeight:height,activeRevision:revision},network);
  for(const action of ['pq-native-transfer','pq-account-migration','legacy-native-transfer','ethereum','dex','resource','delegation','recovery-authorization'])assert.throws(()=>policy.inspectPQWalletActionPolicy(s,action),{code:'PQ_ACCOUNT_REVOKED'});
 }
});
test('R37 revocation projection validates complete history, exact owner and revision/height/nonce boundaries',()=>{
 const mutations=[{owner:'0x'+(network.owner==='0x'+'1'.repeat(40)?'2':'1').repeat(40)},{authorizingRevision:'2'},{throughRevision:'1'},{throughRevision:'3'},{registeredAt:'19',revokedFrom:'20'},{revokedFrom:'27'},{ledgerNonce:'2'},{ledgerNonce:'4'},{registeredAt:'26',revokedFrom:'27'}];
 for(const mutation of mutations)assert.throws(()=>policy.parsePQAccountAuthorization({...raw(),revocations:[{...revoked(),...mutation}]},network));
 for(const revocations of [[],[revoked(),revoked()]])assert.throws(()=>policy.parsePQAccountAuthorization({...raw(),revocations},network));
 assert.throws(()=>policy.parsePQAccountAuthorization({...raw(),policyVersion:'YNX-ACCOUNT-POLICY/v1'},network));
 assert.throws(()=>policy.parsePQAccountAuthorization({...raw(),records:[first(),{...second(),registeredAt:'26'}]},network));
});
test('R37 revocation activation invalidates same review even when raw keys/revision/nonce stay identical',()=>{
 const a=policy.parsePQAccountAuthorization(raw(),network),b=policy.parsePQAccountAuthorization({...raw(),executionHeight:'26'},network);
 assert.throws(()=>policy.assertPQAuthorizationCurrent(a,b),{code:'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
});
test('R37 read-only migration reconciliation reports terminal status without reviving original or authorizing replay',()=>{
 const intent={...vector.registration.fields,priorRevision:'0',newRevision:'1',ledgerNonce:'1',activateAt:'20'};
 for(const [height,status] of [['25','revocation_pending'],['26','revoked']]){
  const s=policy.parsePQAccountAuthorization({...raw(),executionHeight:height},network),result=policy.classifyPQRegistration(s,intent);
  assert.equal(result.status,status);assert.equal(result.retryAuthorized,false);
 }
});
test('R37 original historical and next view distinguish registration time and revocation effective height',()=>{
 const s=policy.parsePQAccountAuthorization(raw(),network);
 for(const [height,status,signing]of[['0','legacy',false],['15','pending_activation',false],['20','active',true],['24','active',true],['25','revocation_pending',true]]){
  const v=policy.inspectPQAuthorizationView(s,height);assert.equal(v.authorizationStatus,status);assert.equal(v.pqSigningEnabled,signing);
 }
 assert.throws(()=>policy.inspectPQAuthorizationView(s,'26'),{code:'PQ_POLICY_VIEW_HEIGHT_INVALID'});
 const after=policy.parsePQAccountAuthorization({...raw(),executionHeight:'30',activeRevision:'2'},network);
 assert.equal(policy.inspectPQAuthorizationView(after).authorizationStatus,'revoked');assert.equal(policy.inspectPQAuthorizationView(after).pqSigningEnabled,false);
});
test('R37 v1 snapshot remains unchanged and malformed registration history cannot pass either policy version',()=>{
 const old={...raw(),policyVersion:'YNX-ACCOUNT-POLICY/v1'};delete old.revocations;const s=policy.parsePQAccountAuthorization(old,network);assert.deepEqual({...s},old);
 for(const row of [{...second(),ledgerNonce:'1'},{...second(),registeredAt:'19'},{...second(),activeFrom:'20'}])assert.throws(()=>policy.parsePQAccountAuthorization({...old,records:[first(),row]},network));
});
test('R37 v2 original Source projection preserves version across SDK parse and App reparse',()=>{
 const original=policy.parsePQAccountAuthorization(raw(),network);assert.equal(original.policyVersion,'YNX-ACCOUNT-POLICY/v2');
 const reparsed=policy.parsePQAccountAuthorization(JSON.parse(JSON.stringify(original)),network);assert.equal(reparsed.policyVersion,original.policyVersion);assert.deepEqual(reparsed.revocations,original.revocations);
 assert.equal(policy.inspectPQAuthorizationView(reparsed).authorizationStatus,'revocation_pending');
});
test('R37 tombstone heights and nonces stay exact beyond Number safe range and reject overflow',()=>{
 const b=9007199254740992n,record={...first(),registeredAt:b.toString(),activeFrom:(b+1n).toString(),ledgerNonce:(b+1n).toString()};
 const tomb={owner:network.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:(b+2n).toString(),revokedFrom:(b+3n).toString(),ledgerNonce:(b+2n).toString()};
 const before={...raw(),records:[record],executionHeight:(b+2n).toString(),ledgerNonce:(b+2n).toString(),revocations:[tomb]};
 const s=policy.parsePQAccountAuthorization(before,network);assert.equal(s.revocations[0].revokedFrom,'9007199254740995');assert.equal(policy.inspectPQAuthorizationView(s).pqSigningEnabled,true);
 const after=policy.parsePQAccountAuthorization({...before,executionHeight:(b+3n).toString()},network);assert.equal(policy.inspectPQAuthorizationView(after).pqSigningEnabled,false);assert.throws(()=>policy.assertPQAuthorizationCurrent(s,after),{code:'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
 assert.throws(()=>policy.parsePQAccountAuthorization({...before,executionHeight:'18446744073709551615',revocations:[{...tomb,registeredAt:'18446744073709551615',revokedFrom:'0'}]},network),{code:'PQ_POLICY_REVOCATION_INVALID'});
});
test('R37 tombstone getters and nondecimal values fail without invocation or policy downgrade',()=>{
 let invoked=false;const tomb={...revoked(),get revokedFrom(){invoked=true;return '26';}};
 assert.throws(()=>policy.parsePQAccountAuthorization({...raw(),revocations:[tomb]},network),{code:'PQ_POLICY_REVOCATION_INVALID'});assert.equal(invoked,false);
 for(const wrong of [26,'026','-1','18446744073709551616'])assert.throws(()=>policy.parsePQAccountAuthorization({...raw(),revocations:[{...revoked(),revokedFrom:wrong}]},network),{code:'PQ_POLICY_REVOCATION_INVALID'});
});

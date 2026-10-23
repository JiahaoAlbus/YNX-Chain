import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectOperatorProjection} from '../src/original-policy-supplier/operator-projection.mjs';
import {captureCometPolicyObservation,isCometPolicyObservation} from '../src/original-policy-supplier/comet-projection.mjs';
import {encodeOperatorPolicyPacket,operatorProjectionCheckpoint} from '../src/original-policy-supplier/operator-packet.mjs';
import {TransactionPolicyResourceKernel,isOriginalWalletTransactionPolicy} from '../src/original-policy-supplier/transaction-resource.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/comet-account-fbec-public.json',import.meta.url))),raw=fixture.accountBefore;
test('actual Go committed Comet account projection preserves complete policy and observed AppHash without inventing native checkpoints',()=>{
 const view=inspectOperatorProjection(raw,raw.owner);
 assert.equal(view.authorization.executionHeight,'3');assert.equal(view.authorization.ledgerNonce,'1');
 assert.equal(view.authorization.records.length,1);assert.deepEqual(view.authorization.records,raw.policy.records);
 assert.equal(view.nextView.authorizationStatus,'active');assert.equal(view.committedView.authorizationStatus,'pending_activation');
 assert.equal(view.committedHeight,raw.committedHeight);assert.equal(view.committedAppHash,raw.committedAppHash);
 assert.equal(view.observation.source,'comet-rpc');assert.equal(view.observation.recordsView,'committed');
 assert.equal(view.observation.independentFinality,false);assert.equal(Object.hasOwn(view,'committedBlockHash'),false);assert.equal(Object.hasOwn(view,'checkpointIntegrity'),false);
 assert.equal(Object.isFrozen(view.observation),true);assert.equal(fixture.sourceFixture.syntheticOnly,true);
});
test('Comet nil policy is explicit disabled DATA and owner without records stays legacy under an existing global policy',()=>{
 const disabled=structuredClone(raw);disabled.enabled=false;disabled.policy=null;delete disabled.globalPolicyVersion;
 disabled.authorizationStatus=disabled.committedAuthorizationStatus='legacy';disabled.pqSigningEnabled=disabled.committedPQSigningEnabled=false;
 assert.equal(inspectOperatorProjection(disabled,raw.owner).authorization.enabled,false);
 assert.throws(()=>inspectOperatorProjection({...disabled,globalPolicyVersion:''},raw.owner));
 const empty=structuredClone(raw);empty.policy.records=[];empty.authorizationStatus=empty.committedAuthorizationStatus='legacy';empty.pqSigningEnabled=empty.committedPQSigningEnabled=false;
 const view=inspectOperatorProjection(empty,raw.owner);assert.equal(view.authorization.records.length,0);assert.equal(view.authorization.enabled,true);
 const v2=structuredClone(raw);v2.globalPolicyVersion='YNX-ACCOUNT-POLICY/v2';assert.equal(inspectOperatorProjection(v2,raw.owner).authorization.policyVersion,'YNX-ACCOUNT-POLICY/v1');
});
test('complete nested terminal tombstone is preserved and both committed/next statuses are recalculated',()=>{
 const revoked=structuredClone(raw);revoked.committedHeight='3';revoked.executionHeight='4';revoked.ledgerNonce='2';
 revoked.globalPolicyVersion=revoked.policy.version='YNX-ACCOUNT-POLICY/v2';
 revoked.policy.revocations=[{owner:raw.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:'3',revokedFrom:'4',ledgerNonce:'2'}];
 revoked.authorizationStatus='revoked';revoked.pqSigningEnabled=false;revoked.committedAuthorizationStatus='revocation_pending';revoked.committedPQSigningEnabled=true;
 const view=inspectOperatorProjection(revoked,raw.owner);assert.deepEqual(view.authorization.revocations,revoked.policy.revocations);
 assert.equal(view.nextView.pqSigningEnabled,false);assert.equal(view.committedView.authorizationStatus,'revocation_pending');
 const stripped=structuredClone(revoked);delete stripped.policy.revocations;assert.throws(()=>inspectOperatorProjection(stripped,raw.owner));
 assert.throws(()=>inspectOperatorProjection({...revoked,pqSigningEnabled:true},raw.owner));
});
test('wrong owner/network/shape, uncommitted history, wrong status, noncanonical keys and impossible height fail closed',()=>{
 for(const [k,v] of [['owner','0x'+'1'.repeat(40)],['networkId','0'.repeat(64)],['nativeChainId','6424'],['recordsView','includes_pending'],['recordsComplete',false],['committedAppHash','0x'+'a'.repeat(64)],['authorizationStatus','legacy'],['executionHeight','4'],['checkpointIntegrity','a'.repeat(64)],['revocations',[]]])assert.throws(()=>inspectOperatorProjection({...raw,[k]:v},raw.owner),undefined,k);
 const future=structuredClone(raw);future.policy.records[0].registeredAt='3';assert.throws(()=>inspectOperatorProjection(future,raw.owner),{code:'AUTH_POLICY_COMET_RECORD_NOT_COMMITTED'});
 const upper=structuredClone(raw);upper.policy.records[0].pkA=upper.policy.records[0].pkA.toUpperCase();assert.throws(()=>inspectOperatorProjection(upper,raw.owner));
 assert.throws(()=>inspectOperatorProjection({...raw,committedHeight:'9223372036854775807',executionHeight:'9223372036854775808'},raw.owner),{code:'AUTH_POLICY_QUERY_HEIGHT'});
 const getter=structuredClone(raw);Object.defineProperty(getter.policy.records[0],'activeFrom',{enumerable:true,get(){throw Error('getter must not run')}});assert.throws(()=>inspectOperatorProjection(getter,raw.owner),{code:'AUTH_POLICY_COMET_SCHEMA'});
});
const now=Date.parse('2026-10-23T14:00:00.000Z'),request={networkId:raw.networkId,nativeChainId:'6423',owner:raw.owner,operation:'typed-action',at:new Date(now).toISOString()};
const packet=()=>encodeOperatorPolicyPacket('transaction',request,inspectOperatorProjection(raw,raw.owner),now,now+30000);
const source=read=>({readOriginal:read,recheck:read,retire(){},async join(){},async close(){}});
test('normal transaction packet v2 and cold resource preserve the branded observation, not a fabricated native checkpoint',async()=>{
 const encoded=packet(),value=JSON.parse(encoded);assert.equal(value.version,'YNX-WALLET-TRANSACTION-POLICY/v2');assert.equal(value.observation.committedAppHash,raw.committedAppHash);
 const resource=new TransactionPolicyResourceKernel(request,source(async()=>encoded),()=>now);await resource.initialize();
 const original=resource.readOriginal();assert.equal(original.authorization.executionHeight,'3');assert.equal(isCometPolicyObservation(original.observation),true);
 assert.equal(isOriginalWalletTransactionPolicy(resource),false);assert.equal(Object.hasOwn(original,'checkpointIntegrity'),false);
 await resource.close();
});
test('old session and registered-binding contracts explicitly refuse Comet AppHash instead of relabeling it',()=>{
 const view=inspectOperatorProjection(raw,raw.owner);
 for(const mode of ['session','registered-binding'])assert.throws(()=>encodeOperatorPolicyPacket(mode,request,view,now,now+30000),{code:'AUTH_POLICY_COMET_CHECKPOINT_UNAVAILABLE'});
 assert.throws(()=>operatorProjectionCheckpoint({...view,observation:{...view.observation}},'transaction'),{code:'AUTH_POLICY_COMET_OBSERVATION_INVALID'});
 assert.throws(()=>captureCometPolicyObservation({...view.observation,independentFinality:true},view.authorization));
});
test('same-height Comet AppHash change is rejected on resource recheck and both exact raw packets remain retained',async()=>{
 const encoded=packet(),changed=JSON.parse(encoded);changed.observation.committedAppHash='a'.repeat(64);let reads=0;
 const later=JSON.stringify(changed),resource=new TransactionPolicyResourceKernel(request,source(async()=>++reads===1?encoded:later),()=>now);await resource.initialize();
 await assert.rejects(resource.recheck(),{code:'AUTH_TX_POLICY_COMET_STATE_CHANGED'});
 assert.equal(resource.outcome().capturedRaw,encoded);assert.equal(resource.outcome().lastRecheckRaw,later);assert.equal(resource.outcome().unknown,true);await resource.close();
});
test('legacy native projection and v1 transaction packet retain the original checkpoint semantics',()=>{
 const native={...inspectOperatorProjection(raw,raw.owner).authorization,policyView:'next_execution',recordsView:'includes_pending',source:'authoritative_producer',committedHeight:raw.committedHeight,committedBlockHash:'a'.repeat(64),committedAlgorithmVersion:'legacy',checkpointStatus:'durable',checkpointIntegrity:'b'.repeat(64),recordsComplete:true,authorizationStatus:raw.authorizationStatus,pqSigningEnabled:raw.pqSigningEnabled,committedAuthorizationStatus:raw.committedAuthorizationStatus,committedPQSigningEnabled:raw.committedPQSigningEnabled,globalPolicyVersion:raw.globalPolicyVersion,revocations:[]};
 const view=inspectOperatorProjection(native,raw.owner),encoded=JSON.parse(encodeOperatorPolicyPacket('transaction',request,view,now,now+30000));
 assert.equal(encoded.version,'YNX-WALLET-TRANSACTION-POLICY/v1');assert.equal(Object.hasOwn(encoded,'observation'),false);
 assert.equal(operatorProjectionCheckpoint(view,'transaction').blockHash,native.committedBlockHash);
});

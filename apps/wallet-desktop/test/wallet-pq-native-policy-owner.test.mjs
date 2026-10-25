import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectOperatorProjection} from '../src/original-policy-supplier/operator-projection.mjs';
import {encodeOperatorPolicyPacket} from '../src/original-policy-supplier/operator-packet.mjs';
import {TransactionPolicyResourceKernel,isOriginalWalletTransactionPolicy} from '../src/original-policy-supplier/transaction-resource.mjs';
import {retainPQPolicyResource} from '../src/wallet-pq-policy-owner.mjs';
const raw=JSON.parse(readFileSync(new URL('./fixtures/comet-account-fbec-public.json',import.meta.url))).accountBefore;
const at=Date.parse('2026-10-25T15:00:00.000Z'),request={networkId:raw.networkId,nativeChainId:'6423',owner:raw.owner,operation:'transfer',at:new Date(at).toISOString()};
async function fixture(policyText){
 const packet=encodeOperatorPolicyPacket('transaction',request,inspectOperatorProjection(raw,raw.owner),at,at+30000,policyText),source={readOriginal:async()=>packet,recheck:async()=>packet,retire(){},async join(){},async close(){}};
 const resource=new TransactionPolicyResourceKernel(request,source,()=>at);await resource.initialize();const owner=retainPQPolicyResource(resource,{networkId:raw.networkId,account:raw.owner,now:()=>new Date(at)});return{resource,owner};
}
// Real Main wrapper + original Auth resource kernel/SDK42. PUBLIC controlled
// source only: its real factory brand remains false; no sign/Root is acquired.
test('Main explicit v3 wrapper keeps raw policy and Comet nonfinality separate from authorization',async()=>{
 const original=JSON.stringify(raw.policy).replace('{','{ '),{resource,owner}=await fixture(original);assert.equal(isOriginalWalletTransactionPolicy(resource),false);const view=owner.read();assert.equal(view.snapshot.executionHeight,raw.executionHeight);assert.equal(resource.readOriginal().observation.independentFinality,false);
 const first=owner.copyOriginalPolicyBytes();assert.equal(first.toString(),original);first.fill(0);assert.equal(owner.copyOriginalPolicyBytes().toString(),original);await owner.recheck();assert.equal(owner.copyOriginalPolicyBytes().toString(),original);await owner.close();assert.throws(()=>owner.copyOriginalPolicyBytes());
});
test('Main legacy/v2 view remains readable but never reconstructs a missing Native operand',async()=>{
 const {owner}=await fixture(null);assert.equal(owner.read().snapshot.owner,raw.owner);assert.throws(()=>owner.copyOriginalPolicyBytes(),{code:'PQ_NATIVE_POLICY_ORIGINAL_NOT_SUPPLIED'});assert.equal(owner.read().snapshot.owner,raw.owner);await owner.close();
});
test('Main refuses a raw getter that substitutes bytes behind an unchanged reviewed metadata view',async()=>{
 const {resource,owner}=await fixture(JSON.stringify(raw.policy));owner.read();resource.copyOriginalPolicyBytes=()=>Buffer.from('{}');assert.throws(()=>owner.copyOriginalPolicyBytes(),{code:'PQ_POLICY_ORIGINAL_CHANGED'});await owner.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {inspectOperatorProjection} from '../src/original-policy-supplier/operator-projection.mjs';
import {encodeOperatorPolicyPacket} from '../src/original-policy-supplier/operator-packet.mjs';
import {TransactionPolicyResourceKernel,isOriginalWalletTransactionPolicy} from '../src/original-policy-supplier/transaction-resource.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/comet-account-fbec-public.json', import.meta.url))).accountBefore;
const now=Date.parse('2026-10-25T15:00:00.000Z');
const request={networkId:fixture.networkId,nativeChainId:'6423',owner:fixture.owner,operation:'typed-action',at:new Date(now).toISOString()};
const original=JSON.stringify(fixture.policy,null,1);
const make=()=>JSON.parse(encodeOperatorPolicyPacket('transaction',request,inspectOperatorProjection(fixture,fixture.owner),now,now+30_000,original));
function kernel(mutate){
 const packet=make(), policy=JSON.parse(original);
 mutate?.(policy);
 const bytes=Buffer.from(mutate?JSON.stringify(policy):original);
 packet.originalPolicy.utf8=bytes.toString('base64url');
 packet.originalPolicy.sha256=createHash('sha256').update(bytes).digest('hex');
 const raw=JSON.stringify(packet);
 return {bytes,raw,resource:new TransactionPolicyResourceKernel(request,{readOriginal:async()=>raw,recheck:async()=>raw,retire(){},async join(){},async close(){}},()=>now)};
}
test('matches and retains original bytes including whitespace; does not supply authority',async()=>{
 const {resource,bytes}=kernel();await resource.initialize();
 assert.deepEqual(Buffer.from(resource.copyOriginalPolicyBytes()),bytes);
 assert.equal(isOriginalWalletTransactionPolicy(resource),false);
 await resource.recheck();await resource.close();
});
test('retains a v2 tombstone; stripping it while rehashing is denied',async()=>{
 const body=structuredClone(fixture);
 body.committedHeight='3';body.executionHeight='4';body.ledgerNonce='2';
 body.globalPolicyVersion=body.policy.version='YNX-ACCOUNT-POLICY/v2';
 body.policy.revocations=[{owner:body.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:'3',revokedFrom:'4',ledgerNonce:'2'}];
 body.authorizationStatus='revoked';body.pqSigningEnabled=false;
 body.committedAuthorizationStatus='revocation_pending';body.committedPQSigningEnabled=true;
 const packet=JSON.parse(encodeOperatorPolicyPacket('transaction',request,inspectOperatorProjection(body,body.owner),now,now+30_000,JSON.stringify(body.policy)));
 let raw=JSON.stringify(packet);
 const resource=new TransactionPolicyResourceKernel(request,{readOriginal:async()=>raw,recheck:async()=>raw,retire(){},async join(){},async close(){}},()=>now);
 await resource.initialize();
 assert.deepEqual(resource.readOriginal().authorization.revocations,body.policy.revocations);
 delete body.policy.revocations;
 const bytes=Buffer.from(JSON.stringify(body.policy));
 packet.originalPolicy.utf8=bytes.toString('base64url');
 packet.originalPolicy.sha256=createHash('sha256').update(bytes).digest('hex');
 raw=JSON.stringify(packet);
 await assert.rejects(resource.recheck(),{code:'AUTH_POLICY_ORIGINAL_JSON'});
 assert.equal(resource.outcome().lastRecheckRaw,raw);
 await resource.close();
});
for(const [name,mutate] of [
 ['substituted public key',p=>{const key=p.records[0].pkA;p.records[0].pkA=(key[0]==='a'?'b':'a')+key.slice(1);}],
 ['wrong network',p=>p.networkId='0'.repeat(64)],
 ['omitted policy record',p=>p.records=[]],
 ['extra authority flag',p=>p.granted=true],
]){
 test(name+' is denied even with its recomputed hash and unchanged outer metadata',async()=>{
  const {resource,raw}=kernel(mutate);
  await assert.rejects(resource.initialize(),{code:'AUTH_POLICY_ORIGINAL_JSON'});
  assert.equal(resource.outcome().capturedRaw,raw);
  assert.equal(resource.outcome().unknown,true);
  await resource.close();
 });
}

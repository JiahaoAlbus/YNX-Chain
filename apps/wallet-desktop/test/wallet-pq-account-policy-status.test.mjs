import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {DesktopWalletAuthority} from '../src/desktop-wallet-authority.mjs';import {parsePQAccountAuthorization,inspectPQAuthorizationView} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {inspectOperatorProjection} from '../src/original-policy-supplier/operator-projection.mjs';import {encodeOperatorPolicyPacket} from '../src/original-policy-supplier/operator-packet.mjs';import {TransactionPolicyResourceKernel} from '../src/original-policy-supplier/transaction-resource.mjs';
const original=JSON.parse(await fs.readFile(new URL('./fixtures/comet-account-fbec-public.json',import.meta.url),'utf8')).accountBefore,at=Date.parse('2026-10-25T15:00:00.000Z');
function publicBody(kind){
 const raw=structuredClone(original);raw.committedHeight='20';raw.executionHeight='21';
 if(kind==='legacy'){raw.policy.records=[];raw.ledgerNonce='0';}
 if(kind==='pending_activation')raw.policy.records[0].activeFrom='30';
 if(kind==='revoked'){raw.policy.version='YNX-ACCOUNT-POLICY/v2';raw.globalPolicyVersion='YNX-ACCOUNT-POLICY/v2';raw.policy.revocations=[{owner:raw.owner,authorizingRevision:'1',throughRevision:'1',registeredAt:'19',revokedFrom:'20',ledgerNonce:'2'}];raw.ledgerNonce='2';}
 const active=raw.policy.records.find(r=>BigInt(r.activeFrom)<=BigInt(raw.executionHeight)),snapshot=parsePQAccountAuthorization({owner:raw.owner,executionHeight:raw.executionHeight,ledgerNonce:raw.ledgerNonce,enabled:raw.enabled,algorithmVersion:active?'YNX-BATCH/v0.1':'legacy',policyVersion:raw.policy.version,networkId:raw.networkId,enableAt:raw.policy.enableAt,records:raw.policy.records,...(active?{activeRevision:active.revision}:{}),...(raw.policy.revocations?{revocations:raw.policy.revocations}:{})},{chainId:raw.networkId,nativeChainId:'6423',owner:raw.owner});
 const next=inspectPQAuthorizationView(snapshot),committed=inspectPQAuthorizationView(snapshot,raw.committedHeight);Object.assign(raw,{authorizationStatus:next.authorizationStatus,pqSigningEnabled:next.pqSigningEnabled,committedAuthorizationStatus:committed.authorizationStatus,committedPQSigningEnabled:committed.pqSigningEnabled});return raw;
}
function fixture({kind='active',sourceFails=false,lateLock=false,closeFails=false,hold}={}){
 const raw=publicBody(kind),recognized=new WeakSet(),counts={source:0,close:0,keys:0,journal:0};let live=true;
 const guard={account:raw.owner,assert(){if(!live)throw Error('PUBLIC_LOCK');}},vault={authorization:{current:()=>guard},async status(){return {initialized:true,account:raw.owner};},withPQKeys(){counts.keys++;throw Error('KEY_ACCESS_FORBIDDEN');},withPQNativeTransaction(){counts.keys++;throw Error('KEY_ACCESS_FORBIDDEN');}};
 const authority=new DesktopWalletAuthority({vault,permissions:{},transactionSender:new Proxy({}, {get(){counts.journal++;throw Error('JOURNAL_ACCESS_FORBIDDEN');}}),clock:()=>new Date(at),pqNetworkId:raw.networkId,pqPolicyRecognized:r=>recognized.has(r),pqPolicySource:async request=>{
  counts.source++;assert.equal(request.owner,raw.owner);assert.equal(request.operation,'transfer');if(sourceFails)throw Object.assign(Error('PUBLIC_SOURCE_UNAVAILABLE'),{code:'PUBLIC_SOURCE_UNAVAILABLE'});if(hold)await hold;
  const packet=encodeOperatorPolicyPacket('transaction',request,inspectOperatorProjection(raw,raw.owner),at,at+30000,JSON.stringify(raw.policy)),resource=new TransactionPolicyResourceKernel(request,{readOriginal:async()=>packet,async recheck(){if(lateLock)live=false;return packet;},retire(){},async join(){},async close(){counts.close++;if(closeFails)throw false;}},()=>at);await resource.initialize();recognized.add(resource);return resource;
 }});return {authority,counts,raw};
}
for(const kind of ['active','pending_activation','legacy','revoked'])test(`same-response selected account ${kind} is read-only and never a signing grant`,async()=>{
 const f=fixture({kind}),value=await f.authority.readPQAccountAuthorization();assert.equal(value.account,f.raw.owner);assert.equal(value.authorizationStatus,kind);assert.equal(value.committedHeight,'20');assert.equal(value.executionHeight,'21');assert.equal(value.ledgerNonce,f.raw.ledgerNonce);assert.equal(value.readOnly,true);assert.equal(value.signingAuthorized,false);assert.equal(value.SourceAdmission,false);assert.deepEqual(value.policy.records,f.raw.policy.records);assert.equal(f.counts.keys,0);assert.equal(f.counts.journal,0);assert.equal(f.counts.close,1);assert.equal(f.authority.pendingRequests().length,0);
});
test('missing or failed Source remains unavailable, never synthesized legacy or zero nonce',async()=>{
 const missing=new DesktopWalletAuthority({});await assert.rejects(missing.readPQAccountAuthorization(),e=>e.data?.code==='PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED');const f=fixture({sourceFails:true});await assert.rejects(f.authority.readPQAccountAuthorization(),{code:'PUBLIC_SOURCE_UNAVAILABLE'});assert.equal(f.counts.keys,0);assert.equal(f.counts.journal,0);
});
test('late lock refuses result after original query cleanup',async()=>{
 const f=fixture({lateLock:true});await assert.rejects(f.authority.readPQAccountAuthorization(),/PUBLIC_LOCK/);assert.equal(f.counts.close,1);assert.equal(f.counts.keys,0);
});
test('falsy cleanup failure blocks result and preserves resource debt without another acquisition',async()=>{
 const f=fixture({closeFails:true});await assert.rejects(f.authority.readPQAccountAuthorization(),e=>e===false);await assert.rejects(f.authority.readPQAccountAuthorization(),e=>e.data?.code==='PQ_POLICY_RESOURCE_UNRESOLVED');assert.equal(f.counts.source,1);assert.equal(f.counts.close,1);
});
test('read-only query shares existing Source acquisition serialization',async()=>{
 let release;const hold=new Promise(r=>release=r),f=fixture({hold});const first=f.authority.readPQAccountAuthorization();await new Promise(r=>setImmediate(r));await assert.rejects(f.authority.readPQAccountAuthorization(),e=>e.data?.code==='PQ_POLICY_RESOURCE_UNRESOLVED');release();await first;assert.equal(f.counts.source,1);
});
test('actual normal Main read-only IPC rejects caller owner fields and public-key proposal uses same authority Vault',async()=>{
 const source=await fs.readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),start=source.indexOf("handleWalletIPC('wallet:pq-account-authorization'"),end=source.indexOf("handleWalletIPC('wallet:pq-keys-recover'",start),handlers=new Map(),vault={PUBLIC:true};let reads=0,proposal;
 vm.compileFunction(source.slice(start,end),[],{contextExtensions:[{handleWalletIPC:(name,fn)=>handlers.set(name,fn),sensitiveIPC:fn=>Promise.resolve().then(fn),walletAuthority:{vault,readPQAccountAuthorization(){reads++;return {readOnly:true};}},keyAccess:{current:()=>({PUBLIC:true})},PQ_CANONICAL_NETWORK_ID:'ab'.repeat(32),readPQPublicProposal:input=>{proposal=input;return {};}}]})();
 await assert.rejects(handlers.get('wallet:pq-account-authorization')({},'attacker-owner'),{code:'PQ_ACCOUNT_POLICY_ARGUMENTS_FORBIDDEN'});assert.equal(reads,0);await handlers.get('wallet:pq-account-authorization')({});assert.equal(reads,1);await handlers.get('wallet:pq-public-proposal')({});assert.equal(proposal.vault,vault);
});

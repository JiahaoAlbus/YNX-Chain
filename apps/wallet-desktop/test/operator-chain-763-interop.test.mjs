// PUBLIC synthetic Chain gateway responses; these do not establish a trusted Source.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operatorReadResponseProblem,CANONICAL_NETWORK_ID} from '../src/original-policy-supplier/operator-query.mjs';
import {captureAuthorizationHTTPOriginal} from '../src/original-policy-supplier/operator-policy-original.mjs';
import {inspectOperatorProjection} from '../src/original-policy-supplier/operator-projection.mjs';
import {encodeOperatorPolicyPacket} from '../src/original-policy-supplier/operator-packet.mjs';
import {TransactionPolicyResourceKernel,isOriginalWalletTransactionPolicy} from '../src/original-policy-supplier/transaction-resource.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/chain-763-authorization-public.json',import.meta.url),'utf8'));
const expected=[
 ['authorization-before-migration','466a98058d85f1128af70d88ace9c5df71a3f243f9694b4f2345fa71244cfd54','legacy','legacy'],
 ['authorization-first-activation-boundary','c73dd74ea30f540be6e0094d8bd73df8b4f27c1458095679c158932788942ec8','active','pending_activation'],
 ['authorization-pending-rotation','0b053e709f9f22737bd24262dcccd0b0994ed43d9d8887fe1c26f8de10a97079','active','active'],
 ['authorization-after-rotation','b08704564b9ba4a062aebcf721687d183a4a89d2b283ee2665c1453594a62ecf','active','active'],
 ['authorization-revocation-boundary','963da0412c4984f413b7172b0cc00e4c71322eaa7985fff6d52f01c5d1312912','revoked','revocation_pending'],
 ['authorization-revoked-after-restart','ef748797d752b08f2c685aa57a5fc355165d9e0bc9f3f79b19a235caafa78a39','revoked','revoked'],
];
function decode(row){return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(row.bodyWire,'base64'));}
function controlled(encoded,counts){return {async readOriginal(){counts.read++;return encoded;},async recheck(){counts.recheck++;return encoded;},retire(){counts.retire++;},async join(){counts.join++;},async close(){counts.close++;}};}
test('Chain 763 synthetic HTTP original bytes survive wallet policy and lifecycle',async()=>{
 assert.equal(fixture.chainCommit,'763b7f8f422f38f39e747a4f7f6cfb6405a0b96d');
 assert.equal(fixture.originalFixtureSha256,'cacf921e7648dfefcdc4d6c478e275d2febe01526241b990b15da84317e0c821');
 assert.equal(fixture.goTestOverlay,true);assert.equal(fixture.overlaySha256,'c7d3c1ba11804e269b94a2d96548ad36616c5eea51dfb0afae956edcb66c75a1');
 assert.equal(fixture.syntheticOnly,true);assert.equal(fixture.actualCometNode,false);assert.equal(fixture.independentFinality,false);assert.equal(fixture.deployedSourceQualification,false);assert.equal(fixture.networkId,CANONICAL_NETWORK_ID);
 assert.equal(fixture.rows.length,expected.length);
 for(const [i,row] of fixture.rows.entries()){
  const [name,hash,next,committed]=expected[i],bytes=Buffer.from(row.bodyWire,'base64');
  assert.equal(row.name,name);assert.equal(row.method,'GET');assert.equal(row.path,`/accounts/${fixture.owner}/authorization`);
  assert.equal(bytes.toString('base64'),row.bodyWire);assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);assert.equal(row.bodySha256,hash);
  assert.equal(operatorReadResponseProblem(row.path,row.statusCode,{'content-type':row.contentType,'cache-control':row.cacheControl}),null);
  const captured=captureAuthorizationHTTPOriginal(decode(row)),view=inspectOperatorProjection(captured.body,fixture.owner);
  assert.equal(view.nextView.authorizationStatus,next);assert.equal(view.committedView.authorizationStatus,committed);
  const now=Date.now(),request={networkId:fixture.networkId,nativeChainId:'6423',owner:fixture.owner,operation:'transfer',at:new Date(now).toISOString()};
  const encoded=encodeOperatorPolicyPacket('transaction',request,view,now,now+30000,captured.policyText),counts={read:0,recheck:0,retire:0,join:0,close:0};
  const resource=new TransactionPolicyResourceKernel(request,controlled(encoded,counts),()=>now);
  await resource.initialize();assert.equal(resource.readOriginal().authorization.owner,fixture.owner);assert.equal(isOriginalWalletTransactionPolicy(resource),false);
  if(captured.policyText!==null)assert.deepEqual(Buffer.from(resource.copyOriginalPolicyBytes()),Buffer.from(captured.policyText));
  await resource.recheck();await resource.close();await resource.close();
  assert.deepEqual(counts,{read:1,recheck:1,retire:1,join:1,close:1});assert.throws(()=>resource.readOriginal());
 }
});
test('real transfer entry rejects synthetic unbranded policy before signer or journal reservation',async()=>{
 const {registerHooks}=await import('node:module');
 const hook=registerHooks({resolve(specifier,context,next){return next(specifier==='electron'?new URL('./public-transaction-electron-fixture.mjs',import.meta.url).href:specifier,context);}});
 const {DesktopWalletAuthority,MemoryPermissionStore}=await import('../src/desktop-wallet-authority.mjs');
 const {DesktopKeyLifecycle}=await import('../src/key-lifecycle.mjs');
 const {FileTransactionIntentStore}=await import('../src/transaction-intent-store.mjs');
 hook.deregister();
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const dir=await mkdtemp(path.join(tmpdir(),'wallet-763-public-'));
 try{
  const row=fixture.rows[1],original=captureAuthorizationHTTPOriginal(decode(row)),view=inspectOperatorProjection(original.body,fixture.owner);
  const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>({account:fixture.owner}),method:'PUBLIC-controlled'}});lifecycle.setFocused(true);await lifecycle.unlock();
  let reads=0,keyBorrows=0;const store=new FileTransactionIntentStore({filePath:path.join(dir,'journal.json')});
  const vault={authorization:lifecycle,status:async()=>({initialized:true,account:fixture.owner}),withPQNativeTransaction:async()=>{keyBorrows++;throw Error('unexpected native call');}};
  const make=async req=>{reads++;const n=Date.now(),wire=encodeOperatorPolicyPacket('transaction',req,view,n,n+30000,original.policyText),counts={read:0,recheck:0,retire:0,join:0,close:0};const resource=new TransactionPolicyResourceKernel(req,controlled(wire,counts),()=>n);await resource.initialize();return resource;};
  const authority=new DesktopWalletAuthority({vault,permissions:new MemoryPermissionStore(),transactionSender:{submissions:{intentStore:store}},pqPolicySource:make,pqPolicyRecognized:isOriginalWalletTransactionPolicy,pqNetworkId:fixture.networkId});
  await assert.rejects(()=>lifecycle.run(()=>authority.requestPQTransfer({to:fixture.recipient,amount:'1'})),e=>e.data?.code==='PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED');
  assert.equal(reads,1);assert.equal(keyBorrows,0);assert.equal(await store.unresolvedPreparation(fixture.owner),null);lifecycle.lock();
 }finally{await rm(dir,{recursive:true,force:true});}
});

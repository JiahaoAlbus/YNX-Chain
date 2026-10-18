import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from './typed-action-caller.mjs';
import {NORMAL_OPERATOR,CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';
import {PQTransactionNodeTransportKernel} from './node-transport.mjs';
import {createPQTypedActionNodeReader} from './typed-action-query-node.mjs';
import {PQ_TYPED_QUERY_MAX_BYTES} from './typed-action-query.mjs';
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const health={chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:NORMAL_OPERATOR.reportedCommit,release:NORMAL_OPERATOR.reportedRelease}};
let handle,review,raw,original;
before(async()=>{
 const row=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows.find(r=>r.kind==='stake');
 const input={...row,chainId:CANONICAL_NETWORK_ID},network={owner:input.owner,chainId:input.chainId,nativeChainId:'6423'},selectedBinding={account:input.owner,networkId:input.chainId};
 handle=await createPQWalletKeyHandle({chainId:input.chainId,owner:input.owner});const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 const dto={owner:input.owner,executionHeight:'9007199254740994',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:input.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:input.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 const snapshot=parsePQAccountAuthorization(dto,network),at=Date.parse('2026-10-19T00:00:00Z');
 review=preparePQTypedActionReview(snapshot,input,{...selectedBinding,operationId:'controlled-typed-GET',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60_000).toISOString()});
 const member=signPQReviewedTypedAction(review,snapshot,handle,selectedBinding,at);raw=encodePQActionTransportData({member,originals:[]});
 original={reviewSnapshot:snapshot,signingSnapshot:snapshot,selectedBinding,memberHash:hash(member),transportHash:hash(raw)};
});
after(()=>assert.equal(destroyPQWalletKeyHandle(handle),true));

// Controlled I/O on the original transport kernel, never live TLS/Node evidence.
function fixture({phase=2,status=200,headers={},bytes=Buffer.from(' {"exact":"raw DATA"}\r\n'),events,postHealth=health,clock=()=>0}={}){
 const calls=[];
 const request=(url,options,receive)=>{
  const req=new EventEmitter(),call={url,options,requestDestroyed:0,responseDestroyed:0};
  req.destroy=()=>{call.requestDestroyed++;req.emit('error',Error('cleanup only'));};
  req.end=body=>{call.body=body;const index=calls.length;calls.push(call);queueMicrotask(()=>{
   const res=new EventEmitter();res.statusCode=index===phase?status:200;res.headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store',...(index===phase?headers:{})};
   res.destroy=()=>{call.responseDestroyed++;res.emit('error',Error('cleanup only'));res.emit('close');};receive(res);
   if(index===phase&&events){events(res,req,call);return;}
   const payload=index===0?Buffer.from(JSON.stringify(health)):index===1?Buffer.from(JSON.stringify({height:0,hash:CANONICAL_NETWORK_ID})):index===3?Buffer.from(JSON.stringify(postHealth)):bytes;
   res.emit('data',payload);res.emit('end');res.emit('close');
  });};return req;
 };
 return{calls,kernel:new PQTransactionNodeTransportKernel(request,clock)};
}
const read=(f,guard=()=>{})=>f.kernel.readTypedActionOriginal(review,raw,original,guard);

test('original Main capture receives complete typed GET before late lock or failed post-health',async()=>{
 for(const mode of ['lock','health']){
  const bytes=Buffer.from(' {"retained":"original"}\n'),f=fixture({bytes,...(mode==='health'?{postHealth:{...health,persistence:false}}:{})});let held;
  const guard=()=>{if(mode==='lock'&&f.calls.length===3)throw Object.assign(Error('locked'),{code:'CONTROLLED_LATE_LOCK'});};
  await assert.rejects(f.kernel.readTypedActionOriginal(review,raw,original,guard,async response=>{held={...response,body:Buffer.from(response.body)};}),{code:mode==='lock'?'CONTROLLED_LATE_LOCK':'PQ_TRANSACTION_NODE_VERSION_OR_HEALTH'});
  assert.ok(held,'Main must receive the complete response before later refusal');assert.deepEqual(held.body,bytes);assert.equal(held.method,'GET');assert.equal(held.requestPath,'/transactions/pq/actions/'+original.transportHash);assert.equal(f.calls.length,mode==='lock'?3:4);
 }
});
test('capture failure retains original cause without post-health or retry; capture cannot mutate returned bytes',async()=>{
 const f=fixture();let captures=0;
 await assert.rejects(f.kernel.readTypedActionOriginal(review,raw,original,()=>{},async()=>{captures++;throw false;}),error=>error===false);
 assert.equal(captures,1);assert.equal(f.calls.length,3);
 const bytes=Buffer.from(' {"source":"exact"}\n'),g=fixture({bytes});
 const response=await g.kernel.readTypedActionOriginal(review,raw,original,()=>{},async captured=>{captured.body.fill(0);return {stored:true};});
 assert.deepEqual(Buffer.from(response.body),bytes);assert.equal(g.calls.length,4);
 const bad=fixture();await assert.rejects(bad.kernel.readTypedActionOriginal(review,raw,original,()=>{},false),{code:'PQ_TRANSACTION_NODE_CAPTURE_REQUIRED'});assert.equal(bad.calls.length,0);
});

test('typed readonly factory exposes only original GET; kernel reuses fixed pins and pre/post source gates',async()=>{
 assert.deepEqual(Object.keys(createPQTypedActionNodeReader()),['readOriginal']);
 const bytes=Buffer.from(' {"notYetDecoded":true}\n'),f=fixture({status:202,bytes}),out=await read(f);
 assert.deepEqual(f.calls.map(c=>[c.options.method,c.url.pathname]),[['GET','/status'],['GET','/blocks/0'],['GET','/transactions/pq/actions/'+original.transportHash],['GET','/status']]);
 for(const c of f.calls){assert.equal(c.url.origin,NORMAL_OPERATOR.origin);assert.equal(c.options.agent,false);assert.equal(c.options.rejectUnauthorized,true);assert.equal(typeof c.options.checkServerIdentity,'function');assert.equal(c.body,undefined);}
 assert.deepEqual(Object.keys(out),['method','requestPath','status','contentType','cacheControl','body']);assert.equal(out.status,202);assert.deepEqual(Buffer.from(out.body),bytes);bytes.fill(0);assert.equal(Buffer.from(out.body).toString(),' {"notYetDecoded":true}\n');assert.ok(Object.isFrozen(out));
 assert.equal(f.calls[2].options.headers['accept-encoding'],'identity');
});
test('wrong original bytes, hashes, network and missing guard refuse before any I/O',async()=>{
 const f=fixture();await assert.rejects(f.kernel.readTypedActionOriginal(review,raw,original),{code:'PQ_TRANSACTION_NODE_CURRENT_REQUIRED'});
 await assert.rejects(f.kernel.readTypedActionOriginal(review,Buffer.from('wrong'),original,()=>{}),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});
 await assert.rejects(f.kernel.readTypedActionOriginal(review,raw,{...original,memberHash:original.transportHash},()=>{}),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});
 await assert.rejects(f.kernel.readTypedActionOriginal(review,raw,{...original,selectedBinding:{...original.selectedBinding,networkId:'00'.repeat(32)}},()=>{}));assert.equal(f.calls.length,0);
});
test('late lock after any received stage suppresses further reads and return without touching originals',async()=>{
 for(const phase of [1,2,3,4]){const f=fixture();await assert.rejects(read(f,()=>{if(f.calls.length>=phase)throw Object.assign(Error('locked'),{code:'CONTROLLED_LATE_LOCK'});}),{code:'CONTROLLED_LATE_LOCK'});assert.equal(f.calls.length,phase);assert.equal(hash(raw),original.transportHash);}
});
test('actual shared stream abort/close cleanup is reused for all four typed GET stages',async()=>{
 for(const phase of [0,1,2,3])for(const event of ['aborted','close']){const f=fixture({phase,events:res=>{res.emit(event);res.emit('data',Buffer.from('{}'));res.emit('end');}});await assert.rejects(read(f),{code:'PQ_TRANSACTION_NODE_RESPONSE_ABORTED'});assert.equal(f.calls.length,phase+1);assert.equal(f.calls[phase].requestDestroyed,1);assert.equal(f.calls[phase].responseDestroyed,1);}
});
test('redirect/error/cache/encoding/8 MiB gates refuse without another request or fallback',async()=>{
 for(const [options,code]of [[{status:301},'PQ_TRANSACTION_NODE_RESPONSE'],[{status:404},'PQ_TRANSACTION_NODE_RESPONSE'],[{status:422},'PQ_TRANSACTION_NODE_RESPONSE'],[{status:503},'PQ_TRANSACTION_NODE_RESPONSE'],[{headers:{'cache-control':'public'}},'PQ_TRANSACTION_NODE_CACHE_POLICY'],[{headers:{'content-type':'text/html'}},'PQ_TRANSACTION_NODE_RESPONSE'],[{headers:{'content-encoding':'gzip'}},'PQ_TRANSACTION_NODE_RESPONSE'],[{bytes:Buffer.alloc(PQ_TYPED_QUERY_MAX_BYTES+1)},'PQ_TRANSACTION_NODE_RESPONSE_SIZE']]){const f=fixture(options);await assert.rejects(read(f),{code});assert.equal(f.calls.length,3);assert.equal(hash(raw),original.transportHash);}
});
test('post-response version change and original lifetime timeout discard observation',async()=>{
 const f=fixture({postHealth:{...health,build:{...health.build,commit:'changed'}}});await assert.rejects(read(f),{code:'PQ_TRANSACTION_NODE_VERSION_OR_HEALTH'});assert.equal(f.calls.length,4);
 let reads=0;const expiring=fixture({clock:()=>++reads>3?NORMAL_OPERATOR.lifetimeMs:0});await assert.rejects(read(expiring),{code:'PQ_TRANSACTION_NODE_TIMEOUT'});assert.equal(expiring.calls.length,2);
});

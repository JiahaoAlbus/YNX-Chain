import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {encodePQRegistrationIntent} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {NORMAL_OPERATOR,CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';
import {PQ_PROGRESS_RESPONSE_BYTES} from '../../wallet-pq-progress.mjs';
import {PQTransactionNodeTransportKernel} from './node-transport.mjs';
// Resolve the fixture primitive from the selected SDK's own dependency closure,
// just as the SDK does. Main is not required to expose a second top-level copy.
const fixtureRequire=createRequire(import.meta.resolve('@ynx-chain/wallet-auth/pq-wallet-authorization'));
const {keyGen,batchSign,extract,encodeMember,discardBatch,destroyKey}=await import(pathToFileURL(fixtureRequire.resolve('@ynx/batch-v01-candidate')).href);
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const health={chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:NORMAL_OPERATOR.reportedCommit,release:NORMAL_OPERATOR.reportedRelease}};
let member,expected,abciHash,foreignMember,foreignExpected;
before(()=>{
 // Ephemeral PUBLIC test keys only; no original Native custody or real account.
 const key=keyGen({provider:'portable'});let batch;
 try{
  expected={chainId:CANONICAL_NETWORK_ID,owner:'0x'+'12'.repeat(20),pkA:key.publicKey.pkA.toString('hex'),pkB:key.publicKey.pkB.toString('hex'),executionHeight:'9007199254740993'};
  const intent={chainId:expected.chainId,owner:expected.owner,algorithmVersion:'YNX-BATCH/v0.1',pkA:expected.pkA,pkB:expected.pkB,priorRevision:'0',newRevision:'1',ledgerNonce:'1',activateAt:'9007199254740994'};
  batch=batchSign(key.privateKey,{chainId:Buffer.from(expected.chainId,'hex'),owner:expected.owner,purpose:'TX-BATCH'},[encodePQRegistrationIntent(intent)]);
  member=encodeMember(extract(batch.batch,0));
  // Independent oracle from Protocol fa55 EncodePQTransaction's exact E3 JSON.
  abciHash=hash(Buffer.from(JSON.stringify({version:1,type:'account_initial',wireHex:member.toString('hex')})));
  foreignExpected={...expected,chainId:'ab'.repeat(32)};
  const foreign=batchSign(key.privateKey,{chainId:Buffer.from(foreignExpected.chainId,'hex'),owner:expected.owner,purpose:'TX-BATCH'},[encodePQRegistrationIntent({...intent,chainId:foreignExpected.chainId})]);
  try{foreignMember=encodeMember(extract(foreign.batch,0));}finally{discardBatch(foreign.batch);}
 }finally{if(batch)discardBatch(batch.batch);destroyKey(key.privateKey);}
});
function fixture({status=202,headers={},bytes=Buffer.from('{"status":"unknown"}'),network=CANONICAL_NETWORK_ID,metadata=health,event,onFirst,onEffect,clock=()=>0}={}){
 const calls=[];
 const request=(url,options,receive)=>{
  const req=new EventEmitter();req.destroy=()=>{req.emit('error',Error('cleanup only'));};
  req.end=body=>{const i=calls.length,call={url,options,body};calls.push(call);queueMicrotask(()=>{
   const res=new EventEmitter();res.destroy=()=>{res.emit('error',Error('cleanup only'));};res.statusCode=i<2?200:status;res.headers={'content-type':'application/json','cache-control':'no-store',...(i===2?headers:{})};receive(res);
   if(i===0)onFirst?.();if(i===2)onEffect?.();if(i===2&&event){res.emit(event,false);return;}
   res.emit('data',i===0?Buffer.from(JSON.stringify(metadata)):i===1?Buffer.from(JSON.stringify({height:0,hash:network})):bytes);res.emit('end');res.emit('close');
  });};return req;
 };
 return{calls,kernel:new PQTransactionNodeTransportKernel(request,clock)};
}
const submit=(f,wire=member,context=expected,guard=()=>{})=>f.kernel.submitAccountInitial(wire,context,guard);
test('birth posts the detached original Member once to its canonical owner route and returns raw DATA',async()=>{
 const wire=Buffer.from(member),original=Buffer.from(member),bytes=Buffer.from(' {"exact":"unknown raw"}\n');
 const f=fixture({bytes,onFirst:()=>wire.fill(0)}),out=await submit(f,wire);
 assert.deepEqual(f.calls.map(c=>[c.options.method,c.url.pathname]),[['GET','/status'],['GET','/blocks/0'],['POST','/accounts/'+expected.owner+'/authorization/register']]);
 assert.deepEqual(Buffer.from(f.calls[2].body),original);assert.equal(f.calls[2].options.headers['content-type'],'application/octet-stream');assert.equal(f.calls[2].options.headers['content-length'],String(original.length));
 assert.deepEqual(Object.keys(out),['method','requestPath','status','contentType','cacheControl','body']);assert.equal(out.status,202);assert.deepEqual(Buffer.from(out.body),bytes);bytes.fill(0);assert.equal(Buffer.from(out.body).toString(),' {"exact":"unknown raw"}\n');
 assert.equal(out.method,'POST');assert.equal(out.requestPath,f.calls[2].url.pathname);assert(Object.isFrozen(out));
 for(const c of f.calls){assert.equal(c.url.origin,NORMAL_OPERATOR.origin);assert.equal(c.options.rejectUnauthorized,true);assert.equal(c.options.agent,false);assert.equal(typeof c.options.checkServerIdentity,'function');}
});
test('birth response is returned for original capture before any late lock or post-health check',async()=>{
 let current=true;const f=fixture({status:200,onEffect:()=>{current=false;}}),out=await submit(f,member,expected,()=>{if(!current)throw Error('LATE_LOCK');});
 assert.equal(out.status,200);assert.equal(current,false);assert.equal(f.calls.length,3);
});
test('birth wrong binding, signature or absent current guard refuse before any I/O',async()=>{
 const f=fixture();await assert.rejects(f.kernel.submitAccountInitial(member,expected),{code:'PQ_TRANSACTION_NODE_CURRENT_REQUIRED'});
 for(const context of [{...expected,owner:'0x'+'34'.repeat(20)},{...expected,chainId:'ab'.repeat(32)},{...expected,executionHeight:'9007199254740994'},{...expected,pkB:'00'.repeat(64)},{...expected,activePolicy:true}])await assert.rejects(submit(f,member,context));
 const bad=Buffer.from(member);bad[bad.length-1]^=1;await assert.rejects(submit(f,bad));assert.equal(f.calls.length,0);
});
test('birth preflight network, health and late current refusal suppress the POST',async()=>{
 for(const extra of [{network:'ab'.repeat(32)},{metadata:{...health,persistence:false}}]){const f=fixture(extra);await assert.rejects(submit(f));assert(f.calls.every(c=>c.options.method==='GET'));}
 const f=fixture();await assert.rejects(submit(f,member,expected,()=>{if(f.calls.length>=2)throw false;}),e=>e===false);assert.equal(f.calls.length,2);
});
test('birth keeps exact accepted and rejected HTTP DATA without a second submission',async()=>{
 for(const status of [200,202,400,413,415,422]){const f=fixture({status,bytes:Buffer.from('{"error":"original rejection"}')});const out=await submit(f);assert.equal(out.status,status);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(f.calls.length,3);}
});
test('birth stream abort, incomplete close and response gates fail without a retry or redirect',async()=>{
 for(const event of ['aborted','close']){const f=fixture({event});await assert.rejects(submit(f),{code:'PQ_TRANSACTION_NODE_RESPONSE_ABORTED'});assert.equal(f.calls.length,3);}
 for(const extra of [{status:302},{status:404},{status:500},{headers:{'cache-control':'public'}},{headers:{'content-encoding':'gzip'}},{headers:{'content-type':'text/html'}},{bytes:Buffer.alloc(PQ_PROGRESS_RESPONSE_BYTES+1)}]){const f=fixture(extra);await assert.rejects(submit(f));assert.equal(f.calls.length,3);}
});
test('birth proof lookup uses only its canonical-envelope ABCI hash and returns unverified bytes',async()=>{
 const bytes=Buffer.from('{"proof":"unverified DATA"}'),f=fixture({status:502,bytes});const out=await f.kernel.readAccountInitialFinalityProof(member,expected,()=>{});
 assert.notEqual(hash(member),abciHash);assert.deepEqual(f.calls.map(c=>[c.options.method,c.url.pathname]),[['GET','/status'],['GET','/blocks/0'],['GET','/txs/'+abciHash+'/pq-finality-proof']]);
 assert.deepEqual(Object.keys(out),['status','rawBytes']);assert.equal(out.status,502);assert.deepEqual(out.rawBytes,bytes);assert.equal(f.calls.some(c=>c.options.method==='POST'),false);
});

test('shared original reader retains a falsy stream failure as the first cause',async()=>{
 const f=fixture({event:'error'});
 await assert.rejects(f.kernel.readOriginal(hash(member)),error=>error===false);
 assert.equal(f.calls.length,3);assert(f.calls.every(c=>c.options.method==='GET'));
});

test('birth refuses an otherwise valid foreign-network Member before any I/O',async()=>{
 const f=fixture();await assert.rejects(submit(f,foreignMember,foreignExpected),{code:'PQ_TRANSACTION_NODE_NETWORK'});assert.equal(f.calls.length,0);
});

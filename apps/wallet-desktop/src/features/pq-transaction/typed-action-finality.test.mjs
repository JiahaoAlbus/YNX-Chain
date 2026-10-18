import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from './typed-action-caller.mjs';
import {planPQReviewedTypedActionFinalityCollector,inspectPQReviewedTypedActionFinalityCollector} from './typed-action-finality.mjs';
import {createPQTypedActionFinalityNodeReader} from './typed-action-finality-node.mjs';
import {decodePQFinalityCollectorData,PQ_FINALITY_COLLECTOR_LIMITS as limits} from './finality-collector.mjs';
import {PQTransactionNodeTransportKernel} from './node-transport.mjs';
import {NORMAL_OPERATOR,CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';
import {PQ_PROGRESS_RESPONSE_BYTES} from '../../wallet-pq-progress.mjs';
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value)),copy=value=>JSON.parse(JSON.stringify(value));
const b64=value=>Buffer.from(value).toString('base64');
let handle,review,raw,original;
before(async()=>{
 const row=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows.find(r=>r.kind==='stake_unbond');
 const old=JSON.parse(readFileSync(new URL('./fixtures/staking-originals-fd8-readonly.json',import.meta.url)));
 const input={...row,chainId:CANONICAL_NETWORK_ID},network={owner:input.owner,chainId:input.chainId,nativeChainId:'6423'},selectedBinding={account:input.owner,networkId:input.chainId};
 handle=await createPQWalletKeyHandle({chainId:input.chainId,owner:input.owner});const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 const dto={owner:input.owner,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:input.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:input.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 const reviewSnapshot=parsePQAccountAuthorization(dto,network),signingSnapshot=parsePQAccountAuthorization({...dto,executionHeight:'9007199254740994'},network),at=Date.parse('2026-10-19T00:00:00Z');
 review=preparePQTypedActionReview(reviewSnapshot,input,{...selectedBinding,operationId:'controlled-typed-proof',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60_000).toISOString()});
 const member=signPQReviewedTypedAction(review,signingSnapshot,handle,selectedBinding,at);raw=encodePQActionTransportData({member,originals:[Buffer.from(old.classicOriginalRaw,'base64')]});
 original={reviewSnapshot,signingSnapshot,selectedBinding,memberHash:hash(member),transportHash:hash(raw)};
});
after(()=>assert.equal(destroyPQWalletKeyHandle(handle),true));

// CONTROLLED collector/proof grammar only. These are not original Gateway HTTP
// output, Comet cryptographic proofs or independently trusted Host inputs.
const proof=()=>({version:'YNX-PQ-TRANSACTION-PROOF/v1',block:{version:'YNX-PQ-LIGHT-PROOF/v1',commitResult:b64('controlled H commit'),validatorsResult:b64('controlled H validators')},successor:{version:'YNX-PQ-LIGHT-PROOF/v1',commitResult:b64('controlled H+1 commit'),validatorsResult:b64('controlled H+1 validators')},transactionProof:b64('controlled full transport inclusion'),executionResult:b64('controlled ABCI result'),executionProof:b64('controlled result proof')});
const full=(status='collected',outcome='committed')=>({version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'configured-comet-rpc',status,observedExecutionStatus:outcome,nativeTransactionHash:original.memberHash,abciTransactionHash:original.transportHash,executionHeight:'9007199254740995',cometIndex:17,independentFinality:false,proofVerification:'not-performed',...(status==='collected'?{proof:proof()}:{}),...(status==='unavailable'?{error:'controlled private producer failure'}:{})});
const early=()=>({version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'configured-comet-rpc',status:'unavailable',nativeTransactionHash:'',abciTransactionHash:original.transportHash,executionHeight:'0',independentFinality:false,proofVerification:'not-performed',error:'controlled early failure'});
const path=()=>'/txs/'+original.transportHash+'/pq-action-finality-proof';
const response=(body=full(),status=200)=>({method:'GET',requestPath:path(),status,contentType:'application/json; charset=utf-8',cacheControl:'no-store',body:bytes(body)});
const inspect=(body=full(),status=200)=>inspectPQReviewedTypedActionFinalityCollector(copy(review),raw,original,response(body,status));
const expected=()=>({nativeTransactionHash:original.memberHash,abciTransactionHash:original.transportHash});
const pqError=error=>/^PQ_/.test(error.code);

test('controlled typed proof uses exact original route, complete identity and existing Main-only proof DATA',()=>{
 assert.deepEqual(planPQReviewedTypedActionFinalityCollector(review,raw,original),{method:'GET',path:path()});
 const http=response(),result=inspectPQReviewedTypedActionFinalityCollector(copy(review),raw,original,http),o=result.observation;
 assert.deepEqual(Object.keys(result),['observation','proof','rawSha256','byteLength']);assert.equal(result.rawSha256,hash(http.body).slice(2));assert.equal(result.byteLength,http.body.length);
 assert.equal(o.kind,'pq-typed-action');assert.equal(o.transactionType,'pq_action');assert.equal(o.memberHash,original.memberHash);assert.equal(o.transportHash,original.transportHash);assert.notEqual(o.memberHash,o.transportHash);assert.equal(o.requestDigest,review.requestDigest);
 assert.equal(o.reviewExecutionHeight,'9007199254740993');assert.equal(o.signingExecutionHeight,'9007199254740994');assert.equal(o.observedExecutionHeight,'9007199254740995');assert.equal(o.memberIndex,0);assert.equal(o.cometIndex,17);assert.equal(o.classicWitnessValidationRequired,true);
 for(const k of ['independentFinality','nativeAdmission','permissionGranted','submitted','canRetry','clearsOriginal','consensusFinality'])assert.equal(o[k],false);
 for(const k of ['proof','error','body','raw','wire','expected','lightTrust','finalized','executionSuccessful','networkQueryPerformed'])assert.equal(Object.hasOwn(o,k),false);
 const before=JSON.stringify(result);http.body.fill(0);assert.equal(JSON.stringify(result),before);
 for(const v of [result,o,result.proof,result.proof.block,result.proof.successor])assert.ok(Object.isFrozen(v));
});
test('rejected and pending preserve their observations, independent H and full uint32 Comet index',()=>{
 for(const outcome of ['committed','rejected']){const collected=full('collected',outcome);collected.executionHeight='1';collected.cometIndex=0xffffffff;const r=inspect(collected);assert.equal(r.observation.observedExecutionStatus,outcome);assert.equal(r.observation.cometIndex,0xffffffff);assert.equal(r.observation.observedExecutionHeight,'1');assert.equal(r.observation.consensusFinality,false);
  const pending=inspect(full('pending',outcome),202);assert.equal(pending.proof,null);assert.equal(pending.observation.status,'pending');assert.equal(pending.observation.canRetry,false);}
});
test('early and late 502 preserve observed identity absence without filling it from local originals',()=>{
 const e=inspect(early(),502),l=inspect(full('unavailable','rejected'),502);
 assert.equal(e.observation.observedNativeTransactionHash,'');assert.equal(e.observation.memberHash,original.memberHash);assert.equal(e.observation.observedABCITransactionHash,original.transportHash);assert.equal(e.observation.observedExecutionHeight,'0');assert.equal(e.observation.observedExecutionStatus,null);assert.equal(e.observation.cometIndex,null);
 assert.equal(l.observation.observedNativeTransactionHash,original.memberHash);assert.equal(l.observation.observedExecutionStatus,'rejected');assert.equal(e.proof,null);assert.equal(l.proof,null);
 assert.equal(Object.hasOwn(l.observation,'error'),false);assert.equal(hash(raw),original.transportHash);
});
test('path and both hashes bind before any proof can be returned; original failure precedes response access',()=>{
 for(const k of ['nativeTransactionHash','abciTransactionHash'])assert.throws(()=>inspect({...full(),[k]:'0x'+'aa'.repeat(32)}),{code:'PQ_FINALITY_ORIGINAL_MISMATCH'});
 assert.throws(()=>inspectPQReviewedTypedActionFinalityCollector(review,raw,original,{...response(),requestPath:path().replace(original.transportHash,original.memberHash)}),{code:'PQ_FINALITY_ORIGINAL_MISMATCH'});
 let hits=0;const http=response();Object.defineProperty(http,'body',{get(){hits++;throw Error('not reached')},enumerable:true});
 assert.throws(()=>inspectPQReviewedTypedActionFinalityCollector(review,Buffer.from('wrong original'),original,http),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});assert.equal(hits,0);
 assert.throws(()=>inspectPQReviewedTypedActionFinalityCollector(review,raw,{...original,reviewSnapshot:undefined},response()),pqError);
});
test('collector status/source/proof/trust injection and coordinate disagreement fail closed',()=>{
 for(const [k,v]of [['source','comet-rpc'],['independentFinality',true],['proofVerification','verified'],['status','committed'],['executionHeight','9223372036854775807'],['cometIndex',4294967296],['lightTrust',{}],['expected',{}],['durable',true]])assert.throws(()=>inspect({...full(),[k]:v}),pqError);
 for(const [body,status]of [[full(),202],[full(),502],[full('pending'),200],[{...full('pending'),proof:proof()},202],[{...early(),cometIndex:0},502],[{...early(),observedExecutionStatus:'committed'},502],[{...early(),nativeTransactionHash:original.memberHash},502]])assert.throws(()=>inspect(body,status),pqError);
});
test('same shared grammar rejects duplicate aliases, invalid UTF-8/base64 and numeric strings without a second parser',()=>{
 for(const text of [JSON.stringify(full()).replace('"status":','"status":"collected","st\\u0061tus":'),JSON.stringify(full()).replace('"commitResult":','"commitResult":"YQ==","commitResult":'),JSON.stringify(full()).replace('"executionHeight":"9007199254740995"','"executionHeight":9007199254740995'),JSON.stringify(full()).replace('"cometIndex":17','"cometIndex":1e1'),'\ufeff'+JSON.stringify(full())])assert.throws(()=>inspectPQReviewedTypedActionFinalityCollector(review,raw,original,{...response(),body:Buffer.from(text)}),pqError);
 const bad=full();bad.proof.executionProof='YQ=_';assert.throws(()=>inspect(bad),{code:'PQ_FINALITY_PROOF_DATA_INVALID'});
 assert.throws(()=>inspectPQReviewedTypedActionFinalityCollector(review,raw,original,{...response(),body:Buffer.from([0xc3,0x28])}),{code:'PQ_FINALITY_COLLECTOR_INVALID'});
 const shared=decodePQFinalityCollectorData(expected(),200,bytes(full()));for(const v of [shared,shared.view,shared.view.proof,shared.view.proof.block])assert.ok(Object.isFrozen(v));
});
test('exact HTTP metadata and intrinsic byte views reject getters/proxies/shared/resizable/detached inputs',()=>{
 for(const patch of [{method:'POST'},{requestPath:path()+'?x=1'},{requestPath:'/transactions/pq/actions/'+original.transportHash+'/pq-finality-proof'},{requestPath:'/transactions/pq/actions/originals/'+original.memberHash+'/pq-finality-proof'},{status:404},{cacheControl:'public'},{contentType:'text/html'},{body:bytes(full()).toString()},{extra:true},{body:new Uint8Array(new SharedArrayBuffer(1))},{body:new Uint8Array(new ArrayBuffer(1,{maxByteLength:4}))}])assert.throws(()=>inspectPQReviewedTypedActionFinalityCollector(review,raw,original,{...response(),...patch}),pqError);
 const detached=new Uint8Array(4);structuredClone(detached,{transfer:[detached.buffer]});assert.throws(()=>inspectPQReviewedTypedActionFinalityCollector(review,raw,original,{...response(),body:detached}),pqError);
 let hits=0;const getter=response();Object.defineProperty(getter,'status',{enumerable:true,get(){hits++;return 200}});assert.throws(()=>inspectPQReviewedTypedActionFinalityCollector(review,raw,original,getter),pqError);
 assert.throws(()=>inspectPQReviewedTypedActionFinalityCollector(review,raw,original,new Proxy(response(),{ownKeys(){hits++;return []}})),pqError);
 const http=response(),rawCopy=Buffer.from(http.body);for(const name of ['buffer','byteLength','byteOffset'])Object.defineProperty(http.body,name,{get(){hits++;throw Error('must ignore')}});
 assert.equal(inspectPQReviewedTypedActionFinalityCollector(review,raw,original,http).rawSha256,hash(rawCopy).slice(2));assert.equal(hits,0);
});
test('existing local envelope budget rejects large untrusted errors and retains source bytes',()=>{
 const oversized={...early(),error:'x'.repeat(limits.envelopeBytes)};assert.throws(()=>inspect(oversized,502),{code:'PQ_FINALITY_COLLECTOR_INVALID'});assert.equal(hash(raw),original.transportHash);
});

const health={chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:NORMAL_OPERATOR.reportedCommit,release:NORMAL_OPERATOR.reportedRelease}};
function networkFixture({phase=2,status=200,headers={},payload=bytes(full()),events,postHealth=health,clock=()=>0}={}){
 const calls=[];const request=(url,options,receive)=>{
  const req=new EventEmitter(),call={url,options,requestDestroyed:0,responseDestroyed:0};req.destroy=()=>{call.requestDestroyed++;req.emit('error',Error('cleanup'))};
  req.end=body=>{call.body=body;const index=calls.length;calls.push(call);queueMicrotask(()=>{
   const res=new EventEmitter();res.statusCode=index===phase?status:200;res.headers={'content-type':'application/json','cache-control':'no-store',...(index===phase?headers:{})};res.destroy=()=>{call.responseDestroyed++;res.emit('error',Error('cleanup'));res.emit('close')};receive(res);
   if(index===phase&&events){events(res,req,call);return}const b=index===0?bytes(health):index===1?bytes({height:0,hash:CANONICAL_NETWORK_ID}):index===3?bytes(postHealth):payload;res.emit('data',b);res.emit('end');res.emit('close');
  })};return req;
 };return{calls,kernel:new PQTransactionNodeTransportKernel(request,clock)};
}
const read=(f,guard=()=>{})=>f.kernel.readTypedActionFinalityProof(review,raw,original,guard);
test('proof raw capture precedes late lock after the complete HTTP response',async()=>{
 let locked=false;const payload=bytes(full()),f=networkFixture({events:res=>{res.emit('data',payload);locked=true;res.emit('end');res.emit('close')}});
 const http=await read(f,()=>{if(locked)throw Object.assign(Error('capture must precede lock'),{code:'CONTROLLED_LOCK'})});
 assert.deepEqual(Buffer.from(http.body),payload);assert.equal(http.status,200);assert.equal(f.calls.length,3);
 assert.equal(locked,true);assert.equal(hash(raw),original.transportHash);
});
test('readonly proof factory and actual shared kernel preserve exact 200/202/502 bytes and fixed pins',async()=>{
 assert.deepEqual(Object.keys(createPQTypedActionFinalityNodeReader()),['readOriginalProof']);
 for(const status of [200,202,502]){const payload=bytes(status===200?full():status===202?full('pending'):early()),f=networkFixture({status,payload}),http=await read(f);assert.equal(http.status,status);assert.deepEqual(Buffer.from(http.body),payload);assert.deepEqual(f.calls.map(c=>c.url.pathname),['/status','/blocks/0',path()]);
  for(const c of f.calls){assert.equal(c.options.method,'GET');assert.equal(c.url.origin,NORMAL_OPERATOR.origin);assert.equal(c.options.rejectUnauthorized,true);assert.equal(typeof c.options.checkServerIdentity,'function');assert.equal(c.body,undefined)}assert.equal(f.calls[2].options.headers['accept-encoding'],'identity');
  const decoded=inspectPQReviewedTypedActionFinalityCollector(review,raw,original,http);assert.equal(decoded.observation.httpStatus,status);assert.equal(decoded.observation.independentFinality,false);}
});
test('proof read original binding and guard refuse before I/O; late guard suppresses each later stage',async()=>{
 const f=networkFixture();await assert.rejects(f.kernel.readTypedActionFinalityProof(review,raw,original),{code:'PQ_TRANSACTION_NODE_CURRENT_REQUIRED'});await assert.rejects(f.kernel.readTypedActionFinalityProof(review,Buffer.from('wrong'),original,()=>{}),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});assert.equal(f.calls.length,0);
 for(const phase of [1,2]){const current=networkFixture();await assert.rejects(read(current,()=>{if(current.calls.length>=phase)throw Object.assign(Error('lock'),{code:'CONTROLLED_LOCK'})}),{code:'CONTROLLED_LOCK'});assert.equal(current.calls.length,phase)}
});
test('proof read preserves stream abort/close first cause and deadline without a pre-capture post-read',async()=>{
 for(const phase of [0,1,2])for(const event of ['close','aborted']){const f=networkFixture({phase,events:res=>{res.emit(event);res.emit('data',Buffer.from('{}'));res.emit('end')}});await assert.rejects(read(f),{code:'PQ_TRANSACTION_NODE_RESPONSE_ABORTED'});assert.equal(f.calls.length,phase+1);assert.equal(f.calls[phase].requestDestroyed,1);assert.equal(f.calls[phase].responseDestroyed,1)}
 const f=networkFixture({postHealth:{...health,catchingUp:true}});await read(f);assert.equal(f.calls.length,3);
 let ticks=0;const deadline=networkFixture({clock:()=>++ticks>3?NORMAL_OPERATOR.lifetimeMs:0});await assert.rejects(read(deadline),{code:'PQ_TRANSACTION_NODE_TIMEOUT'});assert.equal(deadline.calls.length,2);
});
test('proof cap is independent of status cap while metadata retains its original small bound',async()=>{
 const f=networkFixture({payload:Buffer.alloc((8<<20)+1)});assert.equal((await read(f)).body.length,(8<<20)+1);
 const over=networkFixture({events:res=>{const chunk=Buffer.alloc(1<<20);for(let n=0;n<81;n++)res.emit('data',chunk);res.emit('end')}});await assert.rejects(read(over),{code:'PQ_TRANSACTION_NODE_RESPONSE_SIZE'});assert.equal(over.calls.length,3);
 const metadata=networkFixture({phase:0,events:res=>{res.emit('data',Buffer.alloc(PQ_PROGRESS_RESPONSE_BYTES+1));res.emit('end')}});await assert.rejects(read(metadata),{code:'PQ_TRANSACTION_NODE_RESPONSE_SIZE'});assert.equal(metadata.calls.length,1);
});
test('proof redirects/unexpected status/cache/content encoding refuse with no fallback or retry',async()=>{
 for(const [options,code]of [[{status:301},'PQ_TRANSACTION_NODE_RESPONSE'],[{status:404},'PQ_TRANSACTION_NODE_RESPONSE'],[{status:503},'PQ_TRANSACTION_NODE_RESPONSE'],[{headers:{'cache-control':'public'}},'PQ_TRANSACTION_NODE_CACHE_POLICY'],[{headers:{'content-encoding':'gzip'}},'PQ_TRANSACTION_NODE_RESPONSE'],[{headers:{'content-type':'text/html'}},'PQ_TRANSACTION_NODE_RESPONSE']]){const f=networkFixture(options);await assert.rejects(read(f),{code});assert.equal(f.calls.length,3);assert.equal(hash(raw),original.transportHash)}
});

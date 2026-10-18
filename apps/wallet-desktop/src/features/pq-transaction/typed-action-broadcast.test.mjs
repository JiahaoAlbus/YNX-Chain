import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from './typed-action-caller.mjs';
import {decodePQTypedActionBroadcastResponse,PQ_TYPED_QUERY_MAX_BYTES} from './typed-action-query.mjs';
import {preparePQReviewedTypedActionBroadcast,inspectPQReviewedTypedActionBroadcast,PQ_TYPED_ACTION_BROADCAST_RPC_BYTES as rpcLimit} from './typed-action-broadcast.mjs';
import {PQTransactionNodeTransportKernel,createPQTransactionNodeTransport} from './node-transport.mjs';
import {NORMAL_OPERATOR,CANONICAL_NETWORK_ID} from '../../original-policy-supplier/operator-query.mjs';
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex'),b64=b=>Buffer.from(b).toString('base64'),bytes=v=>Buffer.from(JSON.stringify(v));
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/typed-action-broadcast-fd8-http.json.gz',import.meta.url)),{maxOutputLength:8<<20}));
const rows=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows;
const path='/transactions/pq/actions/broadcast',pqError=e=>/^PQ_/.test(e.code);
let handle,review,raw,member,original,snapshot,at;
before(async()=>{
 const input={...rows.find(r=>r.kind==='stake_unbond'),chainId:CANONICAL_NETWORK_ID},network={owner:input.owner,chainId:input.chainId,nativeChainId:'6423'},selectedBinding={account:input.owner,networkId:input.chainId};
 handle=await createPQWalletKeyHandle({chainId:input.chainId,owner:input.owner});const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 const dto={owner:input.owner,executionHeight:'9007199254740994',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:input.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:input.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 snapshot=parsePQAccountAuthorization(dto,network);at=Date.parse('2026-10-19T00:00:00Z');
 review=preparePQTypedActionReview(snapshot,input,{...selectedBinding,operationId:'controlled-typed-POST',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString()});
 member=signPQReviewedTypedAction(review,snapshot,handle,selectedBinding,at);raw=encodePQActionTransportData({member,originals:[]});
 original={reviewSnapshot:snapshot,signingSnapshot:snapshot,selectedBinding,memberHash:hash(member),transportHash:hash(raw)};
});
after(()=>assert.equal(destroyPQWalletKeyHandle(handle),true));
// Controlled N1 HTTP projections only; separate fd8 fixture is actual producer
// output from ABCI execution and mock Comet, not live network/BFT or permission.
function view(status='committed',indexed=true){return{type:review.action.kind,status,committed:status==='committed',source:'comet-rpc',nativeTransactionHash:original.memberHash,abciTransactionHash:original.transportHash,wire:b64(member),transport:b64(raw),executionHeight:indexed?'9007199254740995':'0',...(indexed?{cometIndex:23}:{}),from:original.selectedBinding.account,...(status==='committed'?{to:review.action.payload.delegationId}:{}),amount:status==='committed'?review.action.payload.amountYNXT:'0',fee:review.action.fee,nonce:review.action.nonce,...(status==='committed'?{effects:{controlled:true}}:{error:'controlled outcome'}),readbackUrl:'/transactions/pq/actions/originals/'+original.memberHash,abciReadbackUrl:'/transactions/pq/actions/'+original.transportHash}}
const response=(v=view(),status=200)=>({method:'POST',requestPath:path,status,contentType:'application/json',cacheControl:'no-store',body:bytes(v)});
const inspect=(v=view(),status=200)=>inspectPQReviewedTypedActionBroadcast(review,raw,original,response(v,status));
test('exact fd8 POST request/response bytes decode as generic N2 DATA without local signer permission',()=>{
 const h=fixture.http,http={method:h.method,requestPath:h.path,status:Number(h.statusCode),contentType:h.responseContentType,cacheControl:h.cacheControl,body:Buffer.from(h.responseBody,'base64')},r=decodePQTypedActionBroadcastResponse(http);
 assert.equal(fixture.syntheticOnly,true);assert.equal(fixture.actualNetwork,false);assert.equal(r.view.status,'committed');assert.equal(r.view.executionHeight,'4');assert.equal(r.view.cometIndex,0);assert.equal(r.errorOnly,false);
 const request=Buffer.from(h.requestBody,'base64');assert.equal(request.length,116764);assert.equal(hash(request),'0xf369ab6394cdfa2a7a96ab1b9a98e0adb83ff52ea7ab91a6d12ee413c9e6c8ae');assert.deepEqual(Buffer.from(r.view.transport,'base64'),request);assert.equal(r.independentFinality,false);
 assert.deepEqual(JSON.parse(JSON.stringify(r.view)),JSON.parse(http.body));
});
test('normal original POST plan copies exact body and keeps Member and transport identities separate',()=>{
 const p=preparePQReviewedTypedActionBroadcast(review,raw,original);assert.equal(p.method,'POST');assert.equal(p.path,path);assert.equal(p.contentType,'application/json');assert.equal(p.memberHash,original.memberHash);assert.equal(p.transportHash,original.transportHash);assert.notEqual(p.memberHash,p.transportHash);assert.equal(p.admissionIsFinality,false);
 const body=p.body;assert.deepEqual(body,raw);body.fill(0);assert.deepEqual(p.body,raw);assert.ok(Object.isFrozen(p));assert.ok(4*Math.ceil(raw.length/3)+74<=rpcLimit);
 const o=inspect();assert.equal(o.outcome,'inclusion-observed');assert.equal(o.memberIndex,0);assert.equal(o.cometIndex,23);assert.equal(o.bodyIdentityObserved,true);assert.equal(o.observedExecutionHeight,'9007199254740995');
 for(const k of ['nativeAdmission','permissionGranted','submitted','canRetry','clearsOriginal','consensusFinality','independentFinality','effectsVerified'])assert.equal(o[k],false);
 for(const k of ['effects','wire','transport','body','error','to','amount'])assert.equal(Object.hasOwn(o,k),false);
});
test('POST422 distinguishes CheckTx and indexed rejection;413 profile rejection never grants retry',()=>{
 for(const indexed of [false,true]){const o=inspect(view('rejected',indexed),422);assert.equal(o.outcome,'rejection-observed');assert.equal(o.observedExecutionHeight,indexed?'9007199254740995':'0');assert.equal(o.cometIndex,indexed?23:null);assert.equal(o.canRetry,false)}
 assert.equal(inspect(view('rejected',false),413).outcome,'rejection-observed');assert.equal(inspect(view('unknown',false),202).outcome,'outcome-unknown');
});
test('error-only400/413/415 responses supply no execution identity and preserve unknown original',()=>{
 for(const status of [400,413,415]){const o=inspect({error:'controlled ingress error'},status);assert.equal(o.outcome,'outcome-unknown');assert.equal(o.observedStatus,null);assert.equal(o.observedExecutionHeight,null);assert.equal(o.cometIndex,null);assert.equal(o.bodyIdentityObserved,false);assert.equal(o.memberHash,original.memberHash);assert.equal(o.transportHash,original.transportHash);assert.equal(o.canRetry,false);assert.equal(o.clearsOriginal,false)}
 assert.equal(hash(raw),original.transportHash);
});
test('POST202 carries only initial identity, never executed amount or destination',()=>{
 for(const patch of [{amount:'1'},{to:'controlled-unexecuted-destination'}])assert.throws(()=>inspect({...view('unknown',false),...patch},202),{code:'PQ_TYPED_QUERY_RESPONSE_INVALID'});
});
test('actual POST status/view relationships reject fabricated successes and misplaced index or effects',()=>{
 for(const [v,status]of [[view('rejected'),200],[view(),202],[view('unknown',false),422],[view('rejected'),413],[view(),400],[view(),415],[{error:'x'},422],[{error:'x'},200],[{...view('rejected',false),cometIndex:0},422],[{...view('rejected',true),executionHeight:'0'},422],[{...view('rejected',false),effects:{}},422]])assert.throws(()=>inspect(v,status),pqError);
 for(const status of [201,204,301,500])assert.throws(()=>inspect(view(),status),{code:'PQ_TYPED_QUERY_HTTP_STATUS'});
});
test('original full bytes, both hashes, action and canonical decimal identity bind independently',()=>{
 for(const [key,value]of [['nativeTransactionHash','0x'+'ab'.repeat(32)],['abciTransactionHash','0x'+'cd'.repeat(32)],['type','stake'],['from','0x'+'12'.repeat(20)],['fee','2'],['nonce','9007199254740995']])assert.throws(()=>inspect({...view(),[key]:value}),pqError);
 let calls=0;const http=response();Object.defineProperty(http,'body',{enumerable:true,get(){calls++;throw Error('not reached')}});assert.throws(()=>inspectPQReviewedTypedActionBroadcast(review,Buffer.from('changed original'),original,http),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});assert.equal(calls,0);
 const other=encodePQActionTransportData({member,originals:[Buffer.alloc(128,1)]}),v={...view(),transport:b64(other),abciTransactionHash:hash(other),abciReadbackUrl:'/transactions/pq/actions/'+hash(other)};assert.equal(decodePQTypedActionBroadcastResponse(response(v)).view.abciTransactionHash,hash(other));assert.throws(()=>inspect(v),{code:'PQ_TYPED_QUERY_BINDING_MISMATCH'});
});
test('same strict HTTP grammar rejects duplicate error aliases, POST redirects and bad metadata',()=>{
 const http=response({error:'a'},400);http.body=Buffer.from('{"error":"a","er\\u0072or":"b"}');assert.throws(()=>decodePQTypedActionBroadcastResponse(http),pqError);
 for(const patch of [{method:'GET'},{requestPath:path+'?x=1'},{cacheControl:'public'},{contentType:'text/html'},{extra:true},{body:new Uint8Array(new SharedArrayBuffer(1))}])assert.throws(()=>decodePQTypedActionBroadcastResponse({...response(),...patch}),pqError);
 assert.throws(()=>decodePQTypedActionBroadcastResponse({...response(),body:Buffer.from([255])}),pqError);
});
test('complete transport over original RPC profile is refused instead of stripping original material',()=>{
 const oversized=encodePQActionTransportData({member,originals:Array.from({length:40},()=>Buffer.alloc(16000,1))}),originalWithMaterial={...original,transportHash:hash(oversized)};
 assert.ok(4*Math.ceil(oversized.length/3)+74>rpcLimit);assert.throws(()=>preparePQReviewedTypedActionBroadcast(review,oversized,originalWithMaterial),{code:'PQ_TYPED_ACTION_RPC_PROFILE_EXCEEDED'});assert.equal(hash(raw),original.transportHash);
});
test('SDK332 contract_deploy without complete Go source/material is fenced in retained plan',()=>{
 const input={...rows.find(r=>r.kind==='contract_deploy'),chainId:CANONICAL_NETWORK_ID};
 const r=preparePQTypedActionReview(snapshot,input,{...original.selectedBinding,operationId:'controlled-deploy-fence',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString()});
 const m=signPQReviewedTypedAction(r,snapshot,handle,original.selectedBinding,at),b=encodePQActionTransportData({member:m,originals:[]});
 // The original SDK already rejects absent compiler material before this
 // consumer's additional retained-plan fence. Preserve that first cause.
 assert.throws(()=>preparePQReviewedTypedActionBroadcast(r,b,{...original,memberHash:hash(m),transportHash:hash(b)}),{code:'PQ_ACTION_COMPILER_MATERIAL_REQUIRED'});
});

const health={chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:NORMAL_OPERATOR.reportedCommit,release:NORMAL_OPERATOR.reportedRelease}};
function networkFixture({status=200,headers={},payload=bytes(view()),events,onStage,clock=()=>0}={}){
 const calls=[];const request=(url,options,receive)=>{
  const req=new EventEmitter(),call={url,options,requestDestroyed:0,responseDestroyed:0};req.destroy=()=>{call.requestDestroyed++;req.emit('error',Error('cleanup'))};req.end=body=>{call.body=body;const index=calls.length;calls.push(call);onStage?.(index);queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=index===2?status:200;res.headers={'content-type':'application/json','cache-control':'no-store',...(index===2?headers:{})};res.destroy=()=>{call.responseDestroyed++;res.emit('error',Error('cleanup'));res.emit('close')};receive(res);if(index===2&&events){events(res,req,call);return}res.emit('data',index===0?bytes(health):index===1?bytes({height:0,hash:CANONICAL_NETWORK_ID}):payload);res.emit('end');res.emit('close')})};return req;
 };return{calls,kernel:new PQTransactionNodeTransportKernel(request,clock)};
}
const submit=(f,guard=()=>{},inputRaw=raw)=>f.kernel.submitTypedAction(review,inputRaw,original,guard);
test('existing transport factory adds typed POST with exact JSON body, preflight pins and no followup request',async()=>{
 assert.deepEqual(Object.keys(createPQTransactionNodeTransport()),['submitTransfer','readOriginal','readFinalityProof','submitTypedAction']);
 const f=networkFixture(),r=await submit(f);assert.deepEqual(f.calls.map(c=>[c.options.method,c.url.pathname]),[['GET','/status'],['GET','/blocks/0'],['POST',path]]);
 for(const c of f.calls){assert.equal(c.url.origin,NORMAL_OPERATOR.origin);assert.equal(c.options.rejectUnauthorized,true);assert.equal(typeof c.options.checkServerIdentity,'function')}
 const post=f.calls[2];assert.equal(post.options.headers['content-type'],'application/json');assert.equal(post.options.headers['content-length'],String(raw.length));assert.deepEqual(post.body,raw);assert.equal(r.method,'POST');assert.equal(r.requestPath,path);assert.equal(inspectPQReviewedTypedActionBroadcast(review,raw,original,r).outcome,'inclusion-observed');
});
test('raw response survives late effect lock and malformed UTF8 for original Main capture before parsing',async()=>{
 let locked=false;const payload=Buffer.from([255,0]),f=networkFixture({events:res=>{res.emit('data',payload);locked=true;res.emit('end');res.emit('close')}});
 const r=await submit(f,()=>{if(locked)throw Object.assign(Error('locked'),{code:'CONTROLLED_EFFECT_LOCK'})});assert.deepEqual(Buffer.from(r.body),payload);assert.equal(f.calls.length,3);assert.throws(()=>inspectPQReviewedTypedActionBroadcast(review,raw,original,r),pqError);
});
test('original POST bytes are detached before awaits; missing guard, changed hash or early lock refuses',async()=>{
 const input=Buffer.from(raw),f=networkFixture({onStage:index=>{if(index===0)input.fill(0)}});await submit(f,()=>{},input);assert.deepEqual(f.calls[2].body,raw);
 const none=networkFixture();await assert.rejects(none.kernel.submitTypedAction(review,raw,original),{code:'PQ_TRANSACTION_NODE_CURRENT_REQUIRED'});await assert.rejects(submit(none,()=>{},Buffer.from('changed')),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});assert.equal(none.calls.length,0);
 for(const phase of [1,2]){const blocked=networkFixture();await assert.rejects(submit(blocked,()=>{if(blocked.calls.length>=phase)throw Object.assign(Error('lock'),{code:'CONTROLLED_EFFECT_LOCK'})}),{code:'CONTROLLED_EFFECT_LOCK'});assert.equal(blocked.calls.length,phase);assert.equal(blocked.calls.some(c=>c.options.method==='POST'),false)}
});
test('all actual error statuses retain bytes while abort/redirect/cap failures preserve cause without another POST',async()=>{
 for(const status of [200,202,400,413,415,422]){const payload=Buffer.from(' exact original '+status),f=networkFixture({status,payload}),r=await submit(f);assert.equal(r.status,status);assert.deepEqual(Buffer.from(r.body),payload);assert.equal(f.calls.length,3)}
 for(const [options,code]of [[{status:302},'PQ_TRANSACTION_NODE_RESPONSE'],[{headers:{'content-encoding':'gzip'}},'PQ_TRANSACTION_NODE_RESPONSE'],[{payload:Buffer.alloc(PQ_TYPED_QUERY_MAX_BYTES+1)},'PQ_TRANSACTION_NODE_RESPONSE_SIZE'],[{events:res=>{res.emit('aborted');res.emit('end')}},'PQ_TRANSACTION_NODE_RESPONSE_ABORTED']]){const f=networkFixture(options);await assert.rejects(submit(f),{code});assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(f.calls[2].requestDestroyed,1);assert.equal(f.calls[2].responseDestroyed,1)}
});

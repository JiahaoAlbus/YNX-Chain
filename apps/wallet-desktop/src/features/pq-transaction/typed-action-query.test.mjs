import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {preparePQTypedActionReview,signPQReviewedTypedAction,pqTypedActionInvocationData} from './typed-action-caller.mjs';
import {inspectPQTypedActionTransportOriginal} from './typed-action-transport-reader.mjs';
import {decodePQTypedActionQueryResponse,inspectPQReviewedTypedActionQuery,PQ_TYPED_QUERY_MAX_BYTES} from './typed-action-query.mjs';
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/typed-action-query-fd8-http.json.gz',import.meta.url)),{maxOutputLength:8<<20}));
const old=JSON.parse(readFileSync(new URL('./fixtures/staking-originals-fd8-readonly.json',import.meta.url)));
const inputs=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows;
const sha=x=>'0x'+createHash('sha256').update(x).digest('hex'),copy=x=>JSON.parse(JSON.stringify(x));
const b64=x=>Buffer.from(x).toString('base64');
const response=(view,path,status=200)=>({method:'GET',requestPath:path,status,contentType:'application/json; charset=utf-8',cacheControl:'no-store',body:Buffer.from(JSON.stringify(view))});
const captured=row=>({method:row.method,requestPath:row.path,status:Number(row.statusCode),contentType:row.responseContentType,cacheControl:row.cacheControl,body:Buffer.from(row.responseBody,'base64')});
const invalid={code:'PQ_TYPED_QUERY_RESPONSE_INVALID'},mismatch={code:'PQ_TYPED_QUERY_BINDING_MISMATCH'};
let handle,review,raw,member,original,base,reviewDTO,signingDTO,network;
before(async()=>{
 const input=inputs.find(r=>r.kind==='stake_unbond');network={owner:input.owner,chainId:input.chainId,nativeChainId:'6423'};
 handle=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner});
 const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 reviewDTO={owner:network.owner,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 signingDTO={...reviewDTO,executionHeight:'9007199254740994'};
 const reviewSnapshot=parsePQAccountAuthorization(reviewDTO,network),signingSnapshot=parsePQAccountAuthorization(signingDTO,network),selectedBinding={account:network.owner,networkId:network.chainId},at=Date.parse('2026-10-19T00:00:00Z');
 review=preparePQTypedActionReview(reviewSnapshot,input,{...selectedBinding,operationId:'controlled-node-observer-1',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60_000).toISOString()});
 member=signPQReviewedTypedAction(review,signingSnapshot,handle,selectedBinding,at);raw=encodePQActionTransportData({member,originals:[Buffer.from(old.classicOriginalRaw,'base64')]});
 original={reviewSnapshot,signingSnapshot,selectedBinding,memberHash:sha(member),transportHash:sha(raw)};
 // Controlled N1 response grammar, NOT a Gateway/live response. The separate
 // fd8 fixture below retains the actual producer HTTP bytes unchanged.
 base={type:review.action.kind,status:'committed',committed:true,source:'comet-rpc',nativeTransactionHash:original.memberHash,abciTransactionHash:original.transportHash,wire:b64(member),transport:b64(raw),executionHeight:'9007199254740995',cometIndex:17,from:network.owner,to:review.action.payload.delegationId,amount:review.action.payload.amountYNXT,fee:review.action.fee,nonce:review.action.nonce,effects:{controlled:true,amount:'9007199254740995'},readbackUrl:'/transactions/pq/actions/originals/'+original.memberHash,abciReadbackUrl:'/transactions/pq/actions/'+original.transportHash};
});
after(()=>{if(handle)assert.equal(destroyPQWalletKeyHandle(handle),true);});
const inspect=(view=base,path=base.abciReadbackUrl,status=200)=>inspectPQReviewedTypedActionQuery(copy(review),raw,original,response(view,path,status));
function early(native){return{type:'',status:'unknown',committed:false,source:'comet-rpc',nativeTransactionHash:native?original.memberHash:'',...(native?{}:{abciTransactionHash:original.transportHash,abciReadbackUrl:base.abciReadbackUrl}),executionHeight:'0',amount:'0',fee:'0',nonce:'0',readbackUrl:native?base.readbackUrl:'',error:'original not found'};}

test('four exact fd8 Gateway GET response byte records decode as observations, not finality',()=>{
 assert.equal(fixture.syntheticOnly,true);assert.equal(fixture.actualCometNode,false);assert.equal(fixture.independentFinality,false);
 assert.equal(fixture.memberCount,'2');assert.equal(fixture.memberIndex,'1');assert.equal(fixture.cometIndex,'0');
 for(const row of fixture.http){const r=decodePQTypedActionQueryResponse(captured(row)),v=r.view;
  assert.deepEqual(JSON.parse(JSON.stringify(v)),JSON.parse(Buffer.from(row.responseBody,'base64')));assert.equal(v.status,'committed');assert.equal(v.cometIndex,0);assert.equal(v.executionHeight,'4');assert.equal(v.fee,'1');assert.equal(v.nonce,'3');assert.equal(r.independentFinality,false);assert.equal(r.proofVerification,'not-performed');
 }
});
test('controlled N1 original observer separates wide heights, Member index and Comet index without exposing effects or raw',()=>{
 const r=inspect();assert.equal(r.observedStatus,'committed');assert.equal(r.memberIndex,0);assert.equal(r.cometIndex,17);assert.equal(r.nonce,'9007199254740994');assert.equal(r.reviewExecutionHeight,'9007199254740993');assert.equal(r.signingExecutionHeight,'9007199254740994');assert.equal(r.observedExecutionHeight,'9007199254740995');assert.equal(r.requestDigest,review.requestDigest);assert.equal(r.classicWitnessValidationRequired,true);
 for(const k of ['effectsVerified','nativeAdmission','permissionGranted','submitted','canRetry','clearsOriginal','consensusFinality','independentFinality'])assert.equal(r[k],false);
 for(const k of ['effects','wire','transport','body','member','error','amount','to','networkQueryPerformed'])assert.equal(Object.hasOwn(r,k),false);
 assert.equal(r.originalBytesObserved,true);assert.ok(Object.isFrozen(r));
});
test('observed rejection and both early unknown response shapes keep the original and never grant retry',()=>{
 const rejected={...base,status:'rejected',committed:false,amount:'0',error:'nonce consumed'};delete rejected.effects;delete rejected.to;
 const r=inspect(rejected);assert.equal(r.observedStatus,'rejected');assert.equal(r.consensusFinality,false);
 for(const native of [false,true]){const v=early(native),r=inspect(v,native?base.readbackUrl:base.abciReadbackUrl,202);assert.equal(r.observedStatus,'unknown');assert.equal(r.originalBytesObserved,false);assert.equal(r.memberHash,original.memberHash);assert.equal(r.transportHash,original.transportHash);assert.equal(r.cometIndex,null);assert.equal(r.canRetry,false);assert.equal(r.clearsOriginal,false);}
 const known={...base,status:'unknown',committed:false,executionHeight:'0',error:'index temporarily unavailable'};delete known.effects;delete known.cometIndex;
 assert.equal(inspect(known,base.abciReadbackUrl,202).originalBytesObserved,true);
 assert.equal(sha(raw),original.transportHash);assert.equal(pqTypedActionInvocationData(review).signerEntered,true);
});
test('both retained hashes, exact raw and original action/owner/fee/nonce/path bind independently',()=>{
 for(const [k,v]of [['nativeTransactionHash','0x'+'a'.repeat(64)],['abciTransactionHash','0x'+'b'.repeat(64)],['type','stake'],['from','0x'+'ab'.repeat(20)],['fee','2'],['nonce','9007199254740995'],['executionHeight','2']])assert.throws(()=>inspect({...base,[k]:v}));
 assert.throws(()=>inspect(base,'/transactions/pq/actions/'+'0x'+'c'.repeat(64)),mismatch);
 const otherRaw=encodePQActionTransportData({member,originals:[]}),otherHash=sha(otherRaw);
 const swapped={...base,transport:b64(otherRaw),abciTransactionHash:otherHash,abciReadbackUrl:'/transactions/pq/actions/'+otherHash};
 assert.equal(decodePQTypedActionQueryResponse(response(swapped,swapped.abciReadbackUrl)).view.abciTransactionHash,otherHash);
 assert.throws(()=>inspect(swapped,swapped.abciReadbackUrl),mismatch);
 assert.throws(()=>inspect(early(false),'/transactions/pq/actions/'+'0x'+'c'.repeat(64),202),mismatch);
});
test('status/HTTP contradictions and injected proof, permission, durable or finality fields refuse',()=>{
 const mutations=[v=>v.status='durable',v=>v.status='finalized',v=>v.committed=false,v=>delete v.effects,v=>v.error='not success',v=>v.independentFinality=true,v=>v.proof={},v=>v.permissionGranted=true,v=>v.memberIndex=0,v=>v.executionHeight='0',v=>delete v.cometIndex];
 for(const mutate of mutations){const v=copy(base);mutate(v);assert.throws(()=>decodePQTypedActionQueryResponse(response(v,base.abciReadbackUrl)),invalid);}
 assert.throws(()=>decodePQTypedActionQueryResponse(response(base,base.abciReadbackUrl,202)),invalid);
 assert.throws(()=>decodePQTypedActionQueryResponse(response(early(false),base.abciReadbackUrl,200)),invalid);
 for(const status of [204,301,400,404,422,500,503])assert.throws(()=>decodePQTypedActionQueryResponse(response({error:'unavailable'},base.abciReadbackUrl,status)),{code:'PQ_TYPED_QUERY_HTTP_STATUS'});
});
test('native original route cannot claim an indexed rejection reserved for the ABCI route',()=>{
 const rejected={...base,status:'rejected',committed:false,amount:'0',error:'nonce consumed'};delete rejected.effects;delete rejected.to;
 assert.throws(()=>decodePQTypedActionQueryResponse(response(rejected,base.readbackUrl)),invalid);
 assert.equal(decodePQTypedActionQueryResponse(response(rejected,base.abciReadbackUrl)).view.status,'rejected');
});
test('duplicate escaped fields, nested duplicates, unsafe numeric tokens and oversized integers refuse',()=>{
 const good=response(base,base.abciReadbackUrl),text=Buffer.from(good.body).toString();
 for(const broken of [text.replace('"status":"committed"','"status":"rejected","sta\\u0074us":"committed"'),text.replace('"controlled":true','"controlled":false,"controlled":true'),text.replace('"controlled":true','"amount":9007199254740993'),text.replace('"cometIndex":17','"cometIndex":17e0'),text.replace('"cometIndex":17','"cometIndex":-0'),text.replace('"cometIndex":17','"cometIndex":4294967296'),text.replace('"controlled":true','"__proto__":{}')])assert.throws(()=>decodePQTypedActionQueryResponse({...good,body:Buffer.from(broken)}),invalid);
 for(const v of [{...base,fee:1},{...base,nonce:'18446744073709551616'},{...base,amount:'9223372036854775808'},{...base,executionHeight:'01'},{...base,effects:{bad:1}}])assert.throws(()=>decodePQTypedActionQueryResponse(response(v,base.abciReadbackUrl)),invalid);
});
test('canonical standard base64, fatal UTF-8, fixed GET path, bounded body and no-store are required',()=>{
 const good=response(base,base.abciReadbackUrl);
 for(const changed of [{method:'POST'},{requestPath:base.abciReadbackUrl+'?retry=1'},{requestPath:'https://node.invalid'+base.abciReadbackUrl},{cacheControl:'public'},{contentType:'text/html'},{body:Buffer.from([0xff])},{body:Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),good.body])},{body:new Uint8Array(PQ_TYPED_QUERY_MAX_BYTES+1)}])assert.throws(()=>decodePQTypedActionQueryResponse({...good,...changed}),invalid);
 for(const wire of [base.wire+' ',Buffer.from(member).toString('base64url'),base.wire.slice(0,-1)])assert.throws(()=>decodePQTypedActionQueryResponse(response({...base,wire},base.abciReadbackUrl)),invalid);
});
test('untrusted response objects and buffer shadow accessors are never executed; shared/resizable bytes refuse',()=>{
 const good=response(base,base.abciReadbackUrl);let reads=0;
 const getter={...good};Object.defineProperty(getter,'body',{enumerable:true,get(){reads++;throw Error('getter');}});
 for(const bad of [getter,{...good,final:true},new Proxy(good,{getPrototypeOf(){reads++;throw Error('proxy');}})])assert.throws(()=>decodePQTypedActionQueryResponse(bad),invalid);
 const bytes=Uint8Array.from(good.body);for(const key of ['buffer','length','byteLength','byteOffset'])Object.defineProperty(bytes,key,{get(){reads++;throw Error('shadow');}});
 decodePQTypedActionQueryResponse({...good,body:bytes});assert.equal(reads,0);
 const ab=new ArrayBuffer(32,{maxByteLength:64});Object.defineProperty(ab,'resizable',{get(){reads++;return false;}});
 for(const body of [new Uint8Array(ab),new Uint8Array(new SharedArrayBuffer(32))])assert.throws(()=>decodePQTypedActionQueryResponse({...good,body}),invalid);
 assert.equal(reads,0);
});
test('input byte mutation cannot change decoded frozen DATA and failed binding does not inspect response',()=>{
 const good=response(base,base.abciReadbackUrl),d=decodePQTypedActionQueryResponse(good);good.body.fill(0);assert.equal(d.view.nonce,'9007199254740994');assert.ok(Object.isFrozen(d.view.effects));
 let reads=0;const bad=new Proxy({}, {getPrototypeOf(){reads++;throw Error('response inspected');}});
 assert.throws(()=>inspectPQReviewedTypedActionQuery(copy(review),Buffer.from('unrelated'),original,bad),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});assert.equal(reads,0);assert.equal(sha(raw),original.transportHash);
});
test('actual N2 HTTP fixture is never accepted by the local N1 reviewed observer',()=>{
 const {description,...dto}=old.controlledTestSnapshot;assert.match(description,/not an authenticated/);
 const snapshot=parsePQAccountAuthorization(dto,{owner:old.owner,chainId:old.networkId,nativeChainId:'6423'}),selectedBinding={account:old.owner,networkId:old.networkId};
 const action=inspectPQTypedActionTransportOriginal(snapshot,Buffer.from(old.pqAction.transport,'base64'),{...selectedBinding,memberHash:old.pqAction.nativeTransactionHash,transportHash:old.pqAction.abciTransactionHash}).action;
 const r=preparePQTypedActionReview(snapshot,action,{...selectedBinding,operationId:'controlled-n2',createdAt:review.createdAt,expiresAt:review.expiresAt});
 assert.throws(()=>inspectPQReviewedTypedActionQuery(copy(r),Buffer.from(old.pqAction.transport,'base64'),{reviewSnapshot:snapshot,signingSnapshot:snapshot,selectedBinding,memberHash:old.pqAction.nativeTransactionHash,transportHash:old.pqAction.abciTransactionHash},captured(fixture.http[0])),{code:'PQ_TYPED_ACTION_MEMBER_COORDINATES_INVALID'});
});
test('real cold child re-parses retained DTOs and observes HTTP DATA without creating live review state',()=>{
 const p={review:copy(review),raw:b64(raw),reviewDTO,signingDTO,network,selectedBinding:original.selectedBinding,memberHash:original.memberHash,transportHash:original.transportHash,response:{...response(base,base.abciReadbackUrl),body:b64(response(base,base.abciReadbackUrl).body)}};
 const script=`import{readFileSync}from'node:fs';import{parsePQAccountAuthorization}from'@ynx-chain/wallet-auth/pq-wallet-policy';import{inspectPQReviewedTypedActionQuery}from'./typed-action-query.mjs';import{pqTypedActionInvocationData}from'./typed-action-caller.mjs';const p=JSON.parse(readFileSync(0,'utf8'));const original={reviewSnapshot:parsePQAccountAuthorization(p.reviewDTO,p.network),signingSnapshot:parsePQAccountAuthorization(p.signingDTO,p.network),selectedBinding:p.selectedBinding,memberHash:p.memberHash,transportHash:p.transportHash};const result=inspectPQReviewedTypedActionQuery(p.review,Buffer.from(p.raw,'base64'),original,{...p.response,body:Buffer.from(p.response.body,'base64')});let code;try{pqTypedActionInvocationData(p.review)}catch(e){code=e.code}process.stdout.write(JSON.stringify({result,code}));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('.',import.meta.url),input:JSON.stringify(p),encoding:'utf8',timeout:30_000,maxBuffer:128<<10});assert.equal(child.status,0,child.stderr||String(child.error));const data=JSON.parse(child.stdout);assert.equal(data.result.observedStatus,'committed');assert.equal(data.result.consensusFinality,false);assert.equal(data.code,'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED');
});

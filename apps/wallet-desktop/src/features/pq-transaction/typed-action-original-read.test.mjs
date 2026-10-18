import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {preparePQTypedActionReview,recheckPQTypedActionReview,signPQReviewedTypedAction,pqTypedActionInvocationData,inspectPQTypedActionMember} from './typed-action-caller.mjs';

// One disposable SDK key and signed public Member. No Wallet account, Native,
// Source, private journal or transport; subprocess receives public DATA only.
const input=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows[0];
const network={chainId:input.chainId,nativeChainId:'6423',owner:input.owner};
const selectedBinding={account:input.owner,networkId:input.chainId};
const at=Date.parse('2026-10-19T00:00:00.000Z');
const copy=value=>JSON.parse(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
let handle,review,wire,reviewDTO,signingDTO,reviewSnapshot,signingSnapshot,options;
before(async()=>{
 handle=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner});
 const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 reviewDTO={owner:network.owner,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 signingDTO={...reviewDTO,executionHeight:'9007199254740994'};
 reviewSnapshot=parsePQAccountAuthorization(reviewDTO,network);
 signingSnapshot=parsePQAccountAuthorization(signingDTO,network);
 options={reviewSnapshot,signingSnapshot,selectedBinding};
 review=preparePQTypedActionReview(reviewSnapshot,input,{...selectedBinding,operationId:'original-read-1',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60_000).toISOString()});
 wire=signPQReviewedTypedAction(review,signingSnapshot,handle,selectedBinding,at);
});
after(()=>{if(handle)assert.equal(destroyPQWalletKeyHandle(handle),true);});

test('JSON original survives an actual fresh process with exact public snapshots and full U64 height/nonce',()=>{
 const script=`import {readFileSync} from 'node:fs';
 import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
 import {inspectPQTypedActionMember,pqTypedActionInvocationData} from './typed-action-caller.mjs';
 const p=JSON.parse(readFileSync(0,'utf8'));
 const result=inspectPQTypedActionMember(p.review,Buffer.from(p.wire,'base64'),{reviewSnapshot:parsePQAccountAuthorization(p.reviewDTO,p.network),signingSnapshot:parsePQAccountAuthorization(p.signingDTO,p.network),selectedBinding:p.selectedBinding});
 let grant;try{pqTypedActionInvocationData(p.review);grant='unexpected';}catch(e){grant=e.code;}
 process.stdout.write(JSON.stringify({result,grant}));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('.',import.meta.url),input:JSON.stringify({review,wire:Buffer.from(wire).toString('base64'),reviewDTO,signingDTO,network,selectedBinding}),encoding:'utf8',timeout:30_000,maxBuffer:512*1024});
 assert.equal(child.status,0,child.stderr||String(child.error));
 const {result,grant}=JSON.parse(child.stdout);
 assert.equal(grant,'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED');
 assert.equal(result.executionHeight,'9007199254740994');
 assert.equal(result.action.nonce,'9007199254740994');
 assert.equal(result.action.payload.amount,input.payload.amount);
 assert.equal(result.memberHash,'0x'+sha(wire));
 assert.equal(result.signatureVerified,true);
 for(const k of ['nativeAdmission','submitted','canRetry','clearsOriginal','consensusFinality'])assert.equal(result[k],false);
});
test('expired and reordered archived DATA stays readable without a signing grant',()=>{
 const archived=copy(review);archived.createdAt='2020-01-01T00:00:00.000Z';archived.expiresAt='2020-01-01T00:01:00.000Z';
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
 const data=inspectPQTypedActionMember(reorder(archived),wire,options);
 assert.equal(data.memberHash,'0x'+sha(wire));assert.equal(data.requestDigest,review.requestDigest);
 assert.ok(Object.isFrozen(data));assert.ok(Object.isFrozen(data.action.payload));assert.ok(Object.isFrozen(data.pair));
});
test('archived inspection cannot recreate a live review or clear its original entered fence',()=>{
 const archived=copy(review);
 inspectPQTypedActionMember(archived,wire,options);
 assert.throws(()=>pqTypedActionInvocationData(archived),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
 assert.throws(()=>recheckPQTypedActionReview(archived,signingSnapshot,selectedBinding,at),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
 assert.throws(()=>signPQReviewedTypedAction(archived,signingSnapshot,handle,selectedBinding,at),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
 assert.throws(()=>inspectPQTypedActionMember(archived,wire),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
 assert.equal(pqTypedActionInvocationData(review).signerEntered,true);
 assert.throws(()=>signPQReviewedTypedAction(review,signingSnapshot,handle,selectedBinding,at),{code:'PQ_TYPED_ACTION_SIGNER_ALREADY_ENTERED'});
 assert.equal(inspectPQTypedActionMember(review,wire).memberHash,'0x'+sha(wire));
});
test('original review exact binding, pair, digest, height and closed metadata reject mutations',()=>{
 const mutations=[r=>r.account='0x'+'77'.repeat(20),r=>r.networkId='77'.repeat(32),r=>r.pair.pkA='11'.repeat(2592),r=>r.pair.pkB='22'.repeat(64),r=>r.policyRevision='2',r=>r.executionHeight='9007199254740992',r=>r.executionHeight='9007199254740994',r=>r.requestDigest='00'.repeat(32),r=>r.action.payload.amount='2',r=>r.origin='other',r=>r.dataOnly=false,r=>r.permissionGranted=true,r=>r.extra=true,r=>r.pair.extra=true,r=>r.action.payload.extra=true,r=>r.operationId='',r=>r.createdAt=r.expiresAt];
 for(const mutate of mutations){const r=copy(review);mutate(r);assert.throws(()=>inspectPQTypedActionMember(r,wire,options));}
 const changed=copy(review);changed.action.payload.amount='2';changed.requestDigest=sha(encodePQNativeAction(changed.action));
 assert.throws(()=>inspectPQTypedActionMember(changed,wire,options),{code:'PQ_REGISTERED_MEMBER_BINDING_MISMATCH'});
});
test('requires both original branded snapshots and exact selected account/network; no latest nonce substitution',()=>{
 const archived=copy(review);
 for(const o of [null,{}, {...options,reviewSnapshot:copy(reviewDTO)}, {...options,signingSnapshot:copy(signingDTO)}, {...options,selectedBinding:{...selectedBinding,account:'0x'+'77'.repeat(20)}}, {...options,selectedBinding:{...selectedBinding,networkId:'77'.repeat(32)}}, {...options,extra:true}])assert.throws(()=>inspectPQTypedActionMember(archived,wire,o));
 const changed=[{...signingDTO,ledgerNonce:'9007199254740994'},{...signingDTO,executionHeight:'9007199254740992'},{...signingDTO,records:[{...signingDTO.records[0],pkB:'22'.repeat(64)}]}];
 for(const dto of changed)assert.throws(()=>inspectPQTypedActionMember(archived,wire,{...options,signingSnapshot:parsePQAccountAuthorization(dto,network)}),{code:'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
});
test('serialized review rejects getters and proxies without running them',()=>{
 let calls=0;
 const getter=(object,key)=>Object.defineProperty(object,key,{enumerable:true,get(){calls++;throw Error('getter ran');}});
 const values=[getter(copy(review),'action'),(()=>{const r=copy(review);getter(r.action.payload,'amount');return r;})(),(()=>{const r=copy(review);getter(r.pair,'pkA');return r;})(),new Proxy(copy(review),{getPrototypeOf(){calls++;throw Error('proxy ran');}}),(()=>{const r=copy(review);r.action=new Proxy(r.action,{ownKeys(){calls++;throw Error('proxy ran');}});return r;})()];
 for(const value of values)assert.throws(()=>inspectPQTypedActionMember(value,wire,options));
 assert.throws(()=>inspectPQTypedActionMember(copy(review),wire,getter({...options},'signingSnapshot')));
 assert.equal(calls,0);
});
test('archived canonical decimal and timestamp types cannot be normalized into another stored shape',()=>{
 for(const [key,value] of [['executionHeight',9007199254740992],['executionHeight','09007199254740993'],['executionHeight','18446744073709551616'],['createdAt','2026-10-19'],['expiresAt','invalid']]){const r=copy(review);r[key]=value;assert.throws(()=>inspectPQTypedActionMember(r,wire,options));}
 for(const value of [9007199254740994,9007199254740994n,'09007199254740994']){const r=copy(review);r.action.nonce=value;assert.throws(()=>inspectPQTypedActionMember(r,wire,options));}
 const r=copy(review);r.action.payload.amount=BigInt(r.action.payload.amount);assert.throws(()=>inspectPQTypedActionMember(r,wire,options));
});
test('invalid Member checks preserve original bytes and never open retry',()=>{
 const before=sha(wire),corrupt=Buffer.from(wire);corrupt[corrupt.length-1]^=1;
 for(const value of [corrupt,new Uint8Array(),{},new Proxy(wire,{})])assert.throws(()=>inspectPQTypedActionMember(copy(review),value,options));
 assert.equal(sha(wire),before);const result=inspectPQTypedActionMember(copy(review),wire,options);
 assert.equal(result.canRetry,false);assert.equal(result.clearsOriginal,false);assert.equal(pqTypedActionInvocationData(review).signerEntered,true);
});
test('Member copy rejects hostile byte getters, shared and resizable storage without effects',()=>{
 let reads=0;const hostile=Buffer.from(wire);
 Object.defineProperty(hostile,'byteLength',{get(){reads++;return wire.byteLength;}});
 assert.throws(()=>inspectPQTypedActionMember(review,hostile));assert.equal(reads,0);
 const shared=new Uint8Array(new SharedArrayBuffer(wire.byteLength));shared.set(wire);
 const resizable=new Uint8Array(new ArrayBuffer(wire.byteLength,{maxByteLength:wire.byteLength+1}));resizable.set(wire);
 const detached=new Uint8Array(Buffer.from(wire));structuredClone(detached.buffer,{transfer:[detached.buffer]});
 for(const value of [shared,resizable,detached])assert.throws(()=>inspectPQTypedActionMember(copy(review),value,options),{code:'PQ_TYPED_ACTION_MEMBER_INVALID'});
 const buffer=new ArrayBuffer(wire.byteLength),original=new Uint8Array(buffer);original.set(wire);
 for(const key of ['resizable','detached'])Object.defineProperty(buffer,key,{get(){reads++;return false;}});
 assert.equal(inspectPQTypedActionMember(copy(review),original,options).memberHash,'0x'+sha(wire));assert.equal(reads,0);
});
test('archived contract constructor array retains canonical U64 values and refuses accessors',()=>{
 const rows=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows;
 const action=copy(rows.find(r=>r.kind==='contract_deploy'));action.payload.constructorArgs=['18446744073709551615'];
 const r=copy(preparePQTypedActionReview(reviewSnapshot,action,{...selectedBinding,operationId:'array-shape-only',createdAt:review.createdAt,expiresAt:review.expiresAt}));
 // This differently bound unsigned public review must reach Member binding
 // rejection; no second signature or grant is created by archived validation.
 assert.throws(()=>inspectPQTypedActionMember(r,wire,options),{code:'PQ_REGISTERED_MEMBER_BINDING_MISMATCH'});
 const nonJSON=copy(r);nonJSON.action.payload.constructorArgs=[18446744073709551615n];
 assert.throws(()=>inspectPQTypedActionMember(nonJSON,wire,options),{code:'PQ_TYPED_ACTION_BINDING_MISMATCH'});
 let reads=0;Object.defineProperty(r.action.payload.constructorArgs,'0',{get(){reads++;return '1';}});
 assert.throws(()=>inspectPQTypedActionMember(r,wire,options));assert.equal(reads,0);
});

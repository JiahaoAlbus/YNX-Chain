import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {preparePQTypedActionReview,signPQReviewedTypedAction,recheckPQTypedActionReview,pqTypedActionInvocationData} from './typed-action-caller.mjs';
import {inspectPQTypedActionTransportOriginal} from './typed-action-transport-reader.mjs';
import {inspectPQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';

const rows=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/staking-originals-fd8-readonly.json',import.meta.url)));
const input=rows.find(row=>row.kind==='stake_unbond');
const network={owner:input.owner,chainId:input.chainId,nativeChainId:'6423'};
const selectedBinding={account:input.owner,networkId:input.chainId};
const at=Date.parse('2026-10-19T00:00:00.000Z'),copy=x=>JSON.parse(JSON.stringify(x));
const sha=x=>createHash('sha256').update(x).digest('hex'),hash=x=>'0x'+sha(x);
const classic=Uint8Array.from(Buffer.from(fixture.classicOriginalRaw,'base64'));
const req=createRequire(import.meta.resolve('@ynx-chain/wallet-auth/pq-action-transport-node'));
const {decodeMember,encodeMember}=await import(pathToFileURL(req.resolve('@ynx/batch-v01-candidate')).href);
let handle,review,member,raw,reviewDTO,signingDTO,reviewSnapshot,signingSnapshot,original;
before(async()=>{
 // One ephemeral synthetic SDK signer, never actual Wallet custody/approval.
 // The classic bytes are opaque public test input; Go history/signature checks
 // remain outstanding and must remain flagged even after PQ math succeeds.
 handle=await createPQWalletKeyHandle({chainId:network.chainId,owner:network.owner});
 const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 reviewDTO={owner:network.owner,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:network.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 signingDTO={...reviewDTO,executionHeight:'9007199254740994'};
 reviewSnapshot=parsePQAccountAuthorization(reviewDTO,network);signingSnapshot=parsePQAccountAuthorization(signingDTO,network);
 review=preparePQTypedActionReview(reviewSnapshot,input,{...selectedBinding,operationId:'controlled-cold-transport-1',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60_000).toISOString()});
 member=signPQReviewedTypedAction(review,signingSnapshot,handle,selectedBinding,at);
 raw=encodePQActionTransportData({member,originals:[classic]});
 original={reviewSnapshot,signingSnapshot,selectedBinding,memberHash:hash(member),transportHash:hash(raw)};
});
after(()=>{if(handle)assert.equal(destroyPQWalletKeyHandle(handle),true);});

test('actual cold child restores JSON review and both original snapshots into the composed normal reader',()=>{
 const script=`import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
 import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
 import {inspectPQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
 import {pqTypedActionInvocationData,recheckPQTypedActionReview,signPQReviewedTypedAction} from './typed-action-caller.mjs';
 const p=JSON.parse(readFileSync(0,'utf8')),reviewSnapshot=parsePQAccountAuthorization(p.reviewDTO,p.network),signingSnapshot=parsePQAccountAuthorization(p.signingDTO,p.network);
 const original={reviewSnapshot,signingSnapshot,selectedBinding:p.selectedBinding,memberHash:p.memberHash,transportHash:p.transportHash};
 const result=inspectPQReviewedTypedTransportOriginal(p.review,Buffer.from(p.raw,'base64'),original);
 const failures=[];for(const run of [()=>pqTypedActionInvocationData(p.review),()=>recheckPQTypedActionReview(p.review,signingSnapshot,p.selectedBinding,p.at),()=>signPQReviewedTypedAction(p.review,signingSnapshot,{},p.selectedBinding,p.at)]){try{run();failures.push('unexpected-grant');}catch(e){failures.push(e.code);}}
 const sha=x=>'0x'+createHash('sha256').update(x).digest('hex');
 process.stdout.write(JSON.stringify({result:{...result,body:undefined,member:undefined,originals:undefined},bodyHash:sha(result.body),memberHash:sha(result.member),classic:Buffer.from(result.originals[0]).toString('base64'),failures}));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('.',import.meta.url),encoding:'utf8',input:JSON.stringify({review,reviewDTO,signingDTO,network,selectedBinding,at,memberHash:original.memberHash,transportHash:original.transportHash,raw:Buffer.from(raw).toString('base64')}),timeout:30_000,maxBuffer:512*1024});
 assert.equal(child.status,0,child.stderr||String(child.error));const observed=JSON.parse(child.stdout),r=observed.result;
 assert.equal(r.operationId,review.operationId);assert.equal(r.requestDigest,review.requestDigest);assert.deepEqual(r.action,review.action);assert.deepEqual(r.pair,review.pair);
 assert.equal(r.reviewExecutionHeight,'9007199254740993');assert.equal(r.executionHeight,'9007199254740994');assert.equal(r.action.nonce,'9007199254740994');
 assert.equal(r.memberCount,1);assert.equal(r.memberIndex,0);assert.equal(r.classicWitnessValidationRequired,true);
 assert.equal(observed.bodyHash,original.transportHash);assert.equal(observed.memberHash,original.memberHash);assert.equal(observed.classic,fixture.classicOriginalRaw);
 assert.deepEqual(observed.failures,Array(3).fill('PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'));
 for(const k of ['nativeAdmission','permissionGranted','submitted','canRetry','clearsOriginal','consensusFinality'])assert.equal(r[k],false);
});
test('composed result retains detached originals and does not reset entered or create a live review',()=>{
 const archived=copy(review),bytes=Uint8Array.from(raw),r=inspectPQReviewedTypedTransportOriginal(archived,bytes,original);
 bytes.fill(0);r.body.fill(0);r.member.fill(0);r.originals[0].fill(0);
 assert.equal(hash(r.body),original.transportHash);assert.equal(hash(r.member),original.memberHash);assert.deepEqual(r.originals[0],classic);
 assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.action.payload));assert.ok(Object.isFrozen(r.pair));
 assert.throws(()=>pqTypedActionInvocationData(archived),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
 assert.throws(()=>recheckPQTypedActionReview(archived,signingSnapshot,selectedBinding,at),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
 assert.throws(()=>signPQReviewedTypedAction(archived,signingSnapshot,handle,selectedBinding,at),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
 assert.equal(pqTypedActionInvocationData(review).signerEntered,true);
 assert.throws(()=>signPQReviewedTypedAction(review,signingSnapshot,handle,selectedBinding,at),{code:'PQ_TYPED_ACTION_SIGNER_ALREADY_ENTERED'});
});
test('real retained review mismatch refuses action, digest, pair, owner, network, H and nonce',()=>{
 const mutations=[r=>r.requestDigest='00'.repeat(32),r=>r.pair.pkA='11'.repeat(2592),r=>r.pair.pkB='22'.repeat(64),r=>r.policyRevision='2',r=>r.account='0x'+'77'.repeat(20),r=>r.networkId='77'.repeat(32),r=>r.executionHeight='9007199254740994',r=>r.action.nonce='9007199254740995',r=>r.operationId='',r=>r.permissionGranted=true,r=>r.extra=true];
 for(const mutate of mutations){const r=copy(review);mutate(r);assert.throws(()=>inspectPQReviewedTypedTransportOriginal(r,raw,original));}
 const changed=copy(review);changed.action.payload.amountYNXT='2';changed.requestDigest=sha(encodePQNativeAction(changed.action));
 assert.throws(()=>inspectPQReviewedTypedTransportOriginal(changed,raw,original),{code:'PQ_REGISTERED_MEMBER_BINDING_MISMATCH'});
 assert.equal(hash(raw),original.transportHash);
});
test('transport identity is checked before archived review access, and member identity cannot be swapped',()=>{
 let reads=0;const badReview={get operationId(){reads++;throw Error('not DATA');}};
 const unrelated=new TextEncoder().encode('{wrong-original');
 assert.throws(()=>inspectPQReviewedTypedTransportOriginal(badReview,unrelated,original),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});assert.equal(reads,0);
 assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),raw,{...original,memberHash:original.transportHash}),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});
 const wrong=encodePQActionTransportData({member,originals:[]});
 assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),wrong,original),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});
 const changedHash={...original,transportHash:hash(wrong)};
 const r=inspectPQReviewedTypedTransportOriginal(copy(review),wrong,changedHash);assert.equal(r.originalsCount,0);assert.equal(r.classicWitnessValidationRequired,false);assert.equal(r.permissionGranted,false);
});
test('both original snapshots are mandatory; latest consumed nonce and changed review policy cannot substitute',()=>{
 const parse=dto=>parsePQAccountAuthorization(dto,network);
 const consumed=parse({...signingDTO,ledgerNonce:'9007199254740994'});
 assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),raw,{...original,signingSnapshot:consumed}),{code:'PQ_ACTION_REVIEW_MISMATCH'});
 const changedReview=parse({...reviewDTO,records:[{...reviewDTO.records[0],pkB:'00'.repeat(64)}]});
 assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),raw,{...original,reviewSnapshot:changedReview}),{code:'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
 const futureReview=parse({...reviewDTO,executionHeight:'9007199254740995'});
 assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),raw,{...original,reviewSnapshot:futureReview}),{code:'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
 for(const key of ['reviewSnapshot','signingSnapshot'])assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),raw,{...original,[key]:copy(key==='reviewSnapshot'?reviewDTO:signingDTO)}));
 for(const selected of [{...selectedBinding,account:'0x'+'77'.repeat(20)},{...selectedBinding,networkId:'77'.repeat(32)}])assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),raw,{...original,selectedBinding:selected}),{code:'PQ_TYPED_TRANSPORT_BINDING_MISMATCH'});
});
test('original is exactly five fields and selected binding exactly two; no getter or proxy runs',()=>{
 let reads=0;const getter=(o,k)=>Object.defineProperty(o,k,{enumerable:true,get(){reads++;throw Error('getter ran');}});
 const missing={...original};delete missing.reviewSnapshot;
 for(const o of [null,missing,{...original,approved:true},getter({...original},'signingSnapshot'),{...original,selectedBinding:getter({...selectedBinding},'account')},{...original,selectedBinding:{...selectedBinding,extra:true}},new Proxy(original,{getPrototypeOf(){reads++;throw Error('proxy ran');}})])assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),raw,o),{code:'PQ_REVIEWED_TRANSPORT_ORIGINAL_INVALID'});
 assert.equal(reads,0);
 const invalid=copy(review);getter(invalid,'operationId');assert.throws(()=>inspectPQReviewedTypedTransportOriginal(invalid,raw,original));assert.equal(reads,0);
});
test('generic N2 transport remains DATA interop but the composed normal review reader refuses it',()=>{
 const {description,...dto}=fixture.controlledTestSnapshot;
 assert.match(description,/not an authenticated/);
 const s=parsePQAccountAuthorization(dto,{owner:fixture.owner,chainId:fixture.networkId,nativeChainId:'6423'});
 const bytes=Uint8Array.from(Buffer.from(fixture.pqAction.transport,'base64'));
 const expected={account:fixture.owner,networkId:fixture.networkId,memberHash:fixture.pqAction.nativeTransactionHash,transportHash:fixture.pqAction.abciTransactionHash};
 const observed=inspectPQTypedActionTransportOriginal(s,bytes,expected);assert.equal(observed.memberCount,2);assert.equal(observed.memberIndex,1);
 const r=preparePQTypedActionReview(s,observed.action,{account:expected.account,networkId:expected.networkId,operationId:'controlled-n2-not-local',createdAt:review.createdAt,expiresAt:review.expiresAt});
 assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(r),bytes,{reviewSnapshot:s,signingSnapshot:s,selectedBinding:{account:expected.account,networkId:expected.networkId},memberHash:expected.memberHash,transportHash:expected.transportHash}),{code:'PQ_TYPED_ACTION_MEMBER_COORDINATES_INVALID'});
 assert.equal(pqTypedActionInvocationData(r).signerEntered,false);
});
test('malformed N1 proof rejects in the original codec even when both changed hashes are supplied',()=>{
 const corrupt=Uint8Array.from(member);corrupt[corrupt.length-1]^=1;
 const bytes=encodePQActionTransportData({member:corrupt,originals:[classic]});
 assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),bytes,{...original,memberHash:hash(corrupt),transportHash:hash(bytes)}),{code:'ERR_YNX_BATCH',message:'field count'});
 assert.equal(hash(member),original.memberHash);assert.equal(hash(raw),original.transportHash);
});
test('individually corrupting either full signature rejects actual dual-AND math after valid decoding',()=>{
 for(const signature of ['sigmaA','sigmaB']){
  const parsed=decodeMember(Buffer.from(member));parsed.certificate[signature][0]^=1;
  const corrupt=encodeMember(parsed),bytes=encodePQActionTransportData({member:corrupt,originals:[classic]});
  assert.throws(()=>inspectPQReviewedTypedTransportOriginal(copy(review),bytes,{...original,memberHash:hash(corrupt),transportHash:hash(bytes)}),{code:'PQ_REGISTERED_MEMBER_SIGNATURE_INVALID'});
 }
 assert.equal(hash(member),original.memberHash);assert.equal(hash(raw),original.transportHash);
});

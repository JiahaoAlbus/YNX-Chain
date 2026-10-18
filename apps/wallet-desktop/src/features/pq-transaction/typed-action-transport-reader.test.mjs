import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {encodePQActionTransportData,decodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {decodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {inspectPQTypedActionTransportOriginal} from './typed-action-transport-reader.mjs';
import {preparePQTypedActionReview,inspectPQTypedActionMember,pqTypedActionInvocationData} from './typed-action-caller.mjs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Protocol's exact public bytes. No signer/keys/Native/HTTP/Source operation.
// The H4/nonce2 snapshot below is explicitly controlled test DATA. Actual
// supplied authorization is post-execution H5/nonce3 and must reject planning.
const f=JSON.parse(readFileSync(new URL('./fixtures/staking-originals-fd8-readonly.json',import.meta.url)));
const body=Uint8Array.from(Buffer.from(f.pqAction.transport,'base64'));
const member=Uint8Array.from(Buffer.from(f.pqAction.memberWire,'base64'));
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const expected={account:f.owner,networkId:f.networkId,memberHash:f.pqAction.nativeTransactionHash,transportHash:f.pqAction.abciTransactionHash};
const network={owner:f.owner,chainId:f.networkId,nativeChainId:'6423'};
const {description,...controlledDTO}=f.controlledTestSnapshot;
const snapshot=(patch={})=>parsePQAccountAuthorization({...controlledDTO,...patch},network);
const req=createRequire(import.meta.resolve('@ynx-chain/wallet-auth/pq-action-transport-node'));
const {decodeMember}=await import(pathToFileURL(req.resolve('@ynx/batch-v01-candidate')).href);

test('fixed originals transport reader binds both hashes, full Member math and exact classic bytes',()=>{
 assert.match(description,/not an authenticated/);
 const result=inspectPQTypedActionTransportOriginal(snapshot(),body,expected);
 assert.equal(result.memberCount,2);assert.equal(result.memberIndex,1);
 assert.equal(result.action.kind,'stake_unbond');assert.equal(result.action.nonce,'3');assert.equal(result.executionHeight,'4');
 assert.equal(result.memberHash,hash(member));assert.equal(result.transportHash,hash(body));
 assert.deepEqual(result.body,body);assert.deepEqual(result.member,member);
 assert.deepEqual(Buffer.from(result.originals[0]),Buffer.from(f.classicOriginalRaw,'base64'));
 assert.equal(result.originalsCount,1);assert.equal(result.signatureVerified,true);assert.equal(result.classicWitnessValidationRequired,true);
 for(const k of ['nativeAdmission','permissionGranted','submitted','canRetry','clearsOriginal','consensusFinality'])assert.equal(result[k],false);
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.action.payload));
});
test('normal local signer inspection still refuses N2/index1; generic transport observation is not a grant',()=>{
 const s=snapshot(),action=decodePQNativeAction(decodeMember(Buffer.from(member)).message);
 const review=preparePQTypedActionReview(s,action,{account:f.owner,networkId:f.networkId,operationId:'readonly-interop',createdAt:'2026-10-19T00:00:00.000Z',expiresAt:'2026-10-19T00:01:00.000Z'});
 assert.throws(()=>inspectPQTypedActionMember(review,member),{code:'PQ_TYPED_ACTION_MEMBER_COORDINATES_INVALID'});
 const original=inspectPQTypedActionTransportOriginal(s,body,expected);
 assert.equal(original.permissionGranted,false);assert.equal(pqTypedActionInvocationData(review).signerEntered,false);
 assert.throws(()=>pqTypedActionInvocationData(original),{code:'PQ_TYPED_ACTION_ORIGINAL_REVIEW_REQUIRED'});
});
test('expected selected account, network and both original hashes are required without swapping identities',()=>{
 const s=snapshot();
 for(const binding of [{...expected,memberHash:expected.transportHash},{...expected,transportHash:expected.memberHash}])assert.throws(()=>inspectPQTypedActionTransportOriginal(s,body,binding),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});
 for(const binding of [{...expected,account:'0x'+'77'.repeat(20)},{...expected,networkId:'77'.repeat(32)}])assert.throws(()=>inspectPQTypedActionTransportOriginal(s,body,binding),{code:'PQ_TYPED_TRANSPORT_BINDING_MISMATCH'});
 for(const binding of [{...expected,extra:true},{...expected,memberHash:expected.memberHash.toUpperCase()},{account:expected.account,networkId:expected.networkId,memberHash:expected.memberHash}])assert.throws(()=>inspectPQTypedActionTransportOriginal(s,body,binding),{code:'PQ_TYPED_TRANSPORT_BINDING_INVALID'});
});
test('known transport hash mismatch refuses before decoding an unrelated stored envelope',()=>{
 const unrelated=new TextEncoder().encode('{unrelated-invalid-envelope');
 assert.throws(()=>inspectPQTypedActionTransportOriginal(snapshot(),unrelated,expected),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});
 assert.throws(()=>inspectPQTypedActionTransportOriginal(snapshot(),unrelated,{...expected,transportHash:hash(unrelated)}),{code:'PQ_ACTION_TRANSPORT_INVALID'});
});
test('post-execution nonce and unbranded snapshots refuse; no earlier snapshot is manufactured',()=>{
 assert.equal(f.postExecutionAuthorization.executionHeight,'5');assert.equal(f.postExecutionAuthorization.ledgerNonce,'3');
 assert.throws(()=>inspectPQTypedActionTransportOriginal(snapshot({executionHeight:'5',ledgerNonce:'3'}),body,expected),{code:'PQ_ACTION_REVIEW_MISMATCH'});
 assert.throws(()=>inspectPQTypedActionTransportOriginal(controlledDTO,body,expected));
 const changed=controlledDTO.records.map(r=>({...r,pkB:'00'.repeat(64)}));
 assert.throws(()=>inspectPQTypedActionTransportOriginal(snapshot({records:changed}),body,expected));
 assert.equal(hash(body),expected.transportHash);
});
test('returned originals, Member and transport are detached copies and witness validation remains required',()=>{
 const input=Uint8Array.from(body),result=inspectPQTypedActionTransportOriginal(snapshot(),input,expected);
 input.fill(0);result.body.fill(0);result.member.fill(0);result.originals[0].fill(0);
 assert.equal(hash(result.body),expected.transportHash);assert.equal(hash(result.member),expected.memberHash);
 assert.deepEqual(Buffer.from(result.originals[0]),Buffer.from(f.classicOriginalRaw,'base64'));
 // Above the repaired SDK's conservative 128-byte witness floor; still
 // deliberately not a Go-validated transaction, so the requirement stays true.
 const opaqueClassic=Uint8Array.from(new TextEncoder().encode('{"nonce":9007199254740993,"signature":"not-validated","padding":"'+'x'.repeat(160)+'"}'));
 const modified=encodePQActionTransportData({member,originals:[opaqueClassic]});
 assert.throws(()=>inspectPQTypedActionTransportOriginal(snapshot(),modified,expected),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});
 const observed=inspectPQTypedActionTransportOriginal(snapshot(),modified,{...expected,transportHash:hash(modified)});
 assert.deepEqual(observed.originals[0],opaqueClassic);assert.equal(observed.classicWitnessValidationRequired,true);assert.equal(observed.nativeAdmission,false);
});
test('empty witnesses retain the SDK three-field grammar; malformed stored envelopes cannot be normalized',()=>{
 const empty=encodePQActionTransportData({member,originals:[]});
 const result=inspectPQTypedActionTransportOriginal(snapshot(),empty,{...expected,transportHash:hash(empty)});
 assert.equal(result.originalsCount,0);assert.equal(result.classicWitnessValidationRequired,false);assert.equal(result.nativeAdmission,false);
 assert.deepEqual(Object.keys(JSON.parse(Buffer.from(result.body))),['version','type','wireHex']);
 const parsed=JSON.parse(Buffer.from(body));
 for(const bad of [JSON.stringify({...parsed,originals:[]}),JSON.stringify({...parsed,originals:null}),Buffer.from(body).toString()+'\n'])assert.throws(()=>inspectPQTypedActionTransportOriginal(snapshot(),new TextEncoder().encode(bad),{...expected,transportHash:hash(bad)}),{code:'PQ_ACTION_TRANSPORT_INVALID'});
});
test('reader copies through intrinsic getters before SDK and rejects shared/resizable/proxy inputs',()=>{
 let reads=0;const input=Uint8Array.from(body);
 Object.defineProperty(input,'byteLength',{get(){reads++;return body.byteLength;}});
 for(const key of ['resizable','detached'])Object.defineProperty(input.buffer,key,{get(){reads++;return false;}});
 assert.equal(inspectPQTypedActionTransportOriginal(snapshot(),input,expected).transportHash,expected.transportHash);assert.equal(reads,0);
 const malicious={...expected};Object.defineProperty(malicious,'account',{get(){reads++;return expected.account;}});
 assert.throws(()=>inspectPQTypedActionTransportOriginal(snapshot(),body,malicious),{code:'PQ_TYPED_TRANSPORT_BINDING_INVALID'});assert.equal(reads,0);
 const shared=new Uint8Array(new SharedArrayBuffer(body.length));shared.set(body);
 const resizable=new Uint8Array(new ArrayBuffer(body.length,{maxByteLength:body.length+1}));resizable.set(body);
 for(const raw of [shared,resizable,new Proxy(body,{}),new Uint8Array()])assert.throws(()=>inspectPQTypedActionTransportOriginal(snapshot(),raw,expected),{code:'PQ_TYPED_TRANSPORT_BYTES_INVALID'});
});
test('corrupted Member fails actual SDK math even if the enclosing original hashes are supplied',()=>{
 const decoded=decodePQActionTransportData(body),corrupt=decoded.member;corrupt[corrupt.length-1]^=1;
 const changed=encodePQActionTransportData({member:corrupt,originals:decoded.originals});
 assert.throws(()=>inspectPQTypedActionTransportOriginal(snapshot(),changed,{...expected,memberHash:hash(corrupt),transportHash:hash(changed)}),{code:'PQ_REGISTERED_MEMBER_SIGNATURE_INVALID'});
 assert.equal(hash(body),expected.transportHash);
});

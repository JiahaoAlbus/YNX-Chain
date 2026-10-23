import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys,decodePQTransferRequest,preparePQTransferTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {encodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {preparePQTypedActionReview,signPQReviewedTypedAction} from './typed-action-caller.mjs';
import {parsePQTypedOriginalRecord} from '../../wallet-pq-typed-original.mjs';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {inspectPQReviewedTypedActionFinalityCollector} from './typed-action-finality.mjs';
import * as invocation from './finality-invocation.mjs';
import * as saved from './finality-saved-invocation.mjs';
import * as verifier from './finality-verifier-result.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex'),bytes=v=>Buffer.from(JSON.stringify(v)),copy=v=>JSON.parse(JSON.stringify(v));
const pqError=e=>typeof e?.code==='string'&&e.code.startsWith('PQ_');
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/finality-c3-public.json.gz',import.meta.url))));
const transferCase=fixture.cases.find(r=>r.name==='succeeded-transfer');
let handle,review,raw,member,original,record;
before(async()=>{
 const input=JSON.parse(readFileSync(new URL('./fixtures/typed-action-public-inputs.json',import.meta.url))).rows.find(r=>r.kind==='stake_unbond');
 const classic=JSON.parse(readFileSync(new URL('./fixtures/staking-originals-fd8-readonly.json',import.meta.url)));
 handle=await createPQWalletKeyHandle({chainId:input.chainId,owner:input.owner});
 const pair=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(handle));
 const dto={owner:input.owner,executionHeight:'9007199254740993',ledgerNonce:'9007199254740993',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:input.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:'YNX-BATCH/v0.1',owner:input.owner,pkA:pair.pkA,pkB:pair.pkB,revision:'1',registeredAt:'10',activeFrom:'11',ledgerNonce:'1'}]};
 const network={owner:input.owner,chainId:input.chainId,nativeChainId:'6423'},selectedBinding={account:input.owner,networkId:input.chainId};
 const reviewSnapshot=parsePQAccountAuthorization(dto,network),signingDTO={...dto,executionHeight:'9007199254740994'},signingSnapshot=parsePQAccountAuthorization(signingDTO,network),at=Date.parse('2026-10-23T00:00:00Z');
 review=preparePQTypedActionReview(reviewSnapshot,input,{...selectedBinding,operationId:'controlled-typed-finality-pipeline',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+60_000).toISOString()});
 member=signPQReviewedTypedAction(review,signingSnapshot,handle,selectedBinding,at);
 raw=encodePQActionTransportData({member,originals:[Buffer.from(classic.classicOriginalRaw,'base64')]});
 original={reviewSnapshot,signingSnapshot,selectedBinding,memberHash:'0x'+sha(member),transportHash:'0x'+sha(raw)};
 // Exact current Main private record, using the retained original DTOs. This
 // is ephemeral synthetic signing, not a Main approval or a network effect.
 record=parsePQTypedOriginalRecord({version:2,account:input.owner,kind:'pq-typed-action',operationId:review.operationId,hash:original.transportHash,wire:Buffer.from(raw).toString('base64url'),status:'signed-unsubmitted',typed:{networkId:input.chainId,memberHash:original.memberHash,review,reviewSnapshot:dto,signingSnapshot:signingDTO}});
});
after(()=>{if(handle)assert.equal(destroyPQWalletKeyHandle(handle),true)});

// Everything below involving Host/proof/stdout is controlled DATA syntax,
// deliberately not an actual Go typed producer fixture or qualified Host.
function target(){
 const block={chainId:'controlled-comet-chain',headerHeight:'9007199254740995',blockHash:'ab'.repeat(32),stateHeight:'9007199254740994',stateAppHash:'cd'.repeat(32)};
 return {block,successor:{...block,headerHeight:'9007199254740996',blockHash:'ef'.repeat(32),stateHeight:block.headerHeight,stateAppHash:'12'.repeat(32)},transactionType:'pq_action',envelope:Buffer.from(raw).toString('base64'),nativeWire:Buffer.from(member).toString('base64'),transactionHash:sha(raw),nativeWireHash:sha(member),index:'17'};
}
const proof=()=>({version:'YNX-PQ-TRANSACTION-PROOF/v1',block:{version:'YNX-PQ-LIGHT-PROOF/v1',commitResult:'e30=',validatorsResult:'e30='},successor:{version:'YNX-PQ-LIGHT-PROOF/v1',commitResult:'e30=',validatorsResult:'e30='},transactionProof:'e30=',executionResult:'CAA=',executionProof:'e30='});
function context(expected=target(),networkId=original.selectedBinding.networkId){
 return {version:'YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1',expectedTransaction:expected,lightTrust:{version:'YNX-CONSENSUS-PROOF-TRUST/v1',chainId:expected.block.chainId,migrationFile:'/CONTROLLED-NOT-A-HOST/migration.json',genesisFile:'/CONTROLLED-NOT-A-HOST/genesis.json',stateFile:'/CONTROLLED-NOT-A-HOST/state.json',scheduleFile:'/CONTROLLED-NOT-A-HOST/schedule.json',scheduleHash:'11'.repeat(32),consensusGenesisSHA256:'12'.repeat(32),originalGenesisHash:networkId,migrationStateHash:'13'.repeat(32),runtimePlanFile:'',runtimePlanHash:'',engineHeight:'8',engineAppHash:'14'.repeat(32),expectedHeaderHeight:expected.block.headerHeight,expectedBlockHash:expected.block.blockHash,expectedStateHeight:expected.block.stateHeight,expectedStateAppHash:expected.block.stateAppHash,trustedLightBlockFile:'/CONTROLLED-NOT-A-HOST/trusted.json',trustedLightBlockSHA256:'15'.repeat(32),trustingPeriodNanoseconds:'1',maxClockDriftNanoseconds:'0',trustLevelNumerator:'1',trustLevelDenominator:'3'}};
}
const prepare=(t=target(),p=proof())=>invocation.preparePQReviewedTypedActionFinalityInvocation(review,raw,original,t,p);
const bind=(c,i)=>saved.bindSavedPQReviewedTypedActionFinalityInvocation(review,raw,original,c,i);
function output(t=target(),rejected=false){
 const v=copy(transferCase.expectedResponse),r=v.result;
 v.code=rejected?'VERIFIED_TRANSACTION_REJECTED_DATA':'VERIFIED_TRANSACTION_DATA';
 Object.assign(r,{transactionType:'pq_action',transactionHash:t.transactionHash,nativeWireHash:t.nativeWireHash,height:t.block.headerHeight,index:t.index,total:'18',executionCode:rejected?'2':'0',executionSuccessful:!rejected,outcome:rejected?'rejected':'succeeded',executionData:rejected?null:Buffer.from('0x'+t.transactionHash).toString('base64')});
 Object.assign(r.block,t.block,{trustedHeight:'9007199254740994',authorityThroughHeight:t.block.headerHeight});
 Object.assign(r.successor,t.successor,{trustedHeight:t.block.headerHeight,trustedBlockHash:t.block.blockHash,authorityThroughHeight:t.block.headerHeight,validatorsHash:r.block.nextValidatorsHash});
 return v;
}
const execution=v=>({stdout:bytes(v),stderr:new Uint8Array(),exitCode:0,signal:null});
const parse=(run=execution(output()),t=target())=>verifier.parsePQReviewedTypedActionFinalityVerifierResult(review,raw,original,t,run);
function noAuthority(o){for(const k of ['independentFinality','consensusFinality','nativeGrant','canRetry','clearsOriginal'])assert.equal(o[k],false,k)}

test('typed target and invocation preserve current Main full original material and separate Member/Comet coordinates',()=>{
 const t=target(),p=proof();
 assert.throws(()=>invocation.preparePQTransferFinalityTarget(record,original.selectedBinding,t),pqError);
 const expected=invocation.preparePQReviewedTypedActionFinalityTarget(review,raw,original,t),prepared=prepare(t,p);
 assert.deepEqual(expected,t);assert.deepEqual(JSON.parse(prepared.stdin),{version:'YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1',expected:t,proof:p});
 assert.equal(prepared.stdinSha256,sha(prepared.stdin));assert.equal(prepared.stdinByteLength,Buffer.byteLength(prepared.stdin));
 assert.equal('0x'+expected.transactionHash,record.hash);assert.equal('0x'+expected.nativeWireHash,record.typed.memberHash);
 assert.notEqual(expected.envelope,expected.nativeWire);assert.equal(expected.index,'17');assert.equal(expected.block.headerHeight,'9007199254740995');
 const snapshot=prepared.stdin;t.block.blockHash='ff'.repeat(32);p.executionProof='eA==';assert.equal(prepared.stdin,snapshot);assert.ok(Object.isFrozen(expected.block));
});
test('typed target rejects material stripping, swapped hashes, transfer casts and untrusted getters before execution',()=>{
 for(const change of [t=>{t.envelope=Buffer.from(encodePQActionTransportData({member,originals:[]})).toString('base64');t.transactionHash=sha(Buffer.from(t.envelope,'base64'));},t=>{t.nativeWire=t.envelope;},t=>{[t.transactionHash,t.nativeWireHash]=[t.nativeWireHash,t.transactionHash]},t=>{t.transactionType='pq_transfer'},t=>{t.index='4294967296'},t=>{t.successor.headerHeight=t.block.headerHeight},t=>{t.envelope+='\n'}]){const t=target();change(t);assert.throws(()=>prepare(t),pqError)}
 let hits=0;const t=target();Object.defineProperty(t,'envelope',{get(){hits++;throw Error('getter')},enumerable:true});assert.throws(()=>prepare(t),pqError);assert.equal(hits,0);
 const tampered=Buffer.from(raw);tampered[0]^=1;assert.throws(()=>invocation.preparePQReviewedTypedActionFinalityTarget(review,tampered,original,t),{code:'PQ_TYPED_TRANSPORT_HASH_MISMATCH'});assert.equal(hits,0);
 assert.throws(()=>invocation.preparePQReviewedTypedActionFinalityTarget(review,raw,{...original,reviewSnapshot:undefined},target()),pqError);
});
test('typed collection proof feeds invocation and exact saved context without deriving Host coordinates',()=>{
 const t=target(),http={method:'GET',requestPath:'/txs/'+original.transportHash+'/pq-action-finality-proof',status:200,contentType:'application/json',cacheControl:'no-store',body:bytes({version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'configured-comet-rpc',status:'collected',observedExecutionStatus:'committed',nativeTransactionHash:original.memberHash,abciTransactionHash:original.transportHash,executionHeight:t.block.headerHeight,cometIndex:17,independentFinality:false,proofVerification:'not-performed',proof:proof()})};
 const collected=inspectPQReviewedTypedActionFinalityCollector(review,raw,original,http),prepared=prepare(t,collected.proof),c=bytes(context(t)),i=Buffer.from(prepared.stdin);
 const checked=saved.bindPQReviewedTypedActionFinalityContext(review,raw,original,c),restored=bind(c,i);
 assert.deepEqual(restored.expected,t);assert.equal(restored.contextSha256,sha(c));assert.equal(restored.stdinSha256,sha(i));assert.equal(checked.lightTrust.originalGenesisHash,original.selectedBinding.networkId);noAuthority(restored);noAuthority(checked);
 c.fill(0);i.fill(0);assert.deepEqual(restored.expected,t);assert.equal(collected.observation.memberIndex,0);assert.equal(collected.observation.cometIndex,17);
});
test('typed saved invocation rejects cross-index, cross-network, duplicate aliases and malformed UTF-8',()=>{
 const p=prepare(),c=context();c.expectedTransaction.index='18';assert.throws(()=>bind(bytes(c),Buffer.from(p.stdin)),{code:'PQ_FINALITY_SAVED_INVOCATION_MISMATCH'});
 const wrong=context();wrong.lightTrust.originalGenesisHash='fa'.repeat(32);assert.throws(()=>bind(bytes(wrong),Buffer.from(p.stdin)),{code:'PQ_FINALITY_SAVED_INVOCATION_MISMATCH'});
 const duplicate=JSON.stringify(context()).replace('"transactionType":','"transactionType":"pq_action","transactionType":');assert.throws(()=>bind(Buffer.from(duplicate),Buffer.from(p.stdin)),{code:'PQ_FINALITY_SAVED_INVOCATION_INVALID'});
 assert.throws(()=>bind(bytes(context()),Buffer.from([0xc3,0x28])),{code:'PQ_FINALITY_SAVED_INVOCATION_INVALID'});
 const cast=JSON.parse(p.stdin);cast.expected.transactionType='pq_transfer';assert.throws(()=>bind(bytes(context()),bytes(cast)),pqError);
});
test('typed verifier succeeded/rejected/error output remains bounded DATA with full transport success identity',()=>{
 for(const rejected of [false,true]){const run=execution(output(target(),rejected)),r=parse(run),o=r.observation;noAuthority(o);assert.equal(o.kind,'pq-typed-action');assert.equal(o.transactionType,'pq_action');assert.equal(o.nativeTransactionHash,original.memberHash);assert.equal(o.abciTransactionHash,record.hash);assert.equal(o.operationId,record.operationId);assert.equal(o.cometIndex,17);assert.equal(o.reportedOutcome,rejected?'rejected':'succeeded');assert.equal(o.reportedExecutionSuccessful,!rejected);assert.equal(r.stdoutSha256,sha(run.stdout));assert.equal(o.proofVerification,'result-data-only');assert.equal(Object.hasOwn(o,'proof'),false)}
 const run={...execution({version:'YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1',code:'PROOF_REJECTED',error:'controlled private error'}),exitCode:1};const o=parse(run).observation;noAuthority(o);assert.equal(o.status,'verifier-error-data');assert.equal(o.reportedOutcome,null);assert.equal(Object.hasOwn(o,'error'),false);
});
test('typed verifier rejects transfer output, Member success hash, false success, duplicate keys and incomplete process',()=>{
 for(const change of [r=>{r.transactionType='pq_transfer'},r=>{r.nativeWireHash=r.transactionHash},r=>{r.executionData=Buffer.from(original.memberHash).toString('base64')},r=>{r.executionCode='2'},r=>{r.index='0'},r=>{r.nativeGrant=true},r=>{r.successor.trustedBlockHash='aa'.repeat(32)}]){const v=output();change(v.result);assert.throws(()=>parse(execution(v)),pqError)}
 const reject=output(target(),true);reject.result.executionData=Buffer.from(record.hash).toString('base64');assert.throws(()=>parse(execution(reject)),pqError);
 const run=execution(output());run.stdout=Buffer.from(run.stdout.toString().replace('"transactionType":','"transactionType":"pq_action","transactionType":'));assert.throws(()=>parse(run),pqError);
 assert.throws(()=>parse({...execution(output()),signal:'SIGTERM'}),{code:'PQ_FINALITY_VERIFIER_PROCESS_INCOMPLETE'});
});
test('shared refactor preserves actual prior transfer target, saved binding and producer result shape',()=>{
 const t=transferCase.expectedTransaction,wire=Buffer.from(t.nativeWire,'base64'),transfer=decodePQTransferRequest(wire).transfer,binding={account:transfer.from,networkId:transfer.chainId};
 const old=createPQOriginalRecord({account:binding.account,kind:'pq-transfer',operationId:'PUBLIC-legacy-shared-helper',request:preparePQTransferTransport(wire)});
 const p=invocation.preparePQTransferFinalityInvocation(old,binding,t,transferCase.request.proof),c=bytes(context(t,binding.networkId));
 assert.deepEqual(saved.bindSavedPQTransferFinalityInvocation(old,binding,c,Buffer.from(p.stdin)).expected,t);
 const r=verifier.parsePQTransferFinalityVerifierResult(old,binding,t,execution(transferCase.expectedResponse));assert.equal(r.observation.kind,'pq-transfer');assert.equal(r.observation.transactionType,'pq_transfer');assert.equal(r.observation.reportedOutcome,'succeeded');noAuthority(r.observation);
});

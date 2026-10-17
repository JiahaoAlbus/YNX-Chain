import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createPQWalletKeyHandle,readPQWalletKeyPublic,destroyPQWalletKeyHandle,signPQWalletNativeTransfer,createPQWalletMigrationPossession,signPQWalletCurrentMigration} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqPublicBindingToRegistrationKeys,encodePQMigrationRequest,preparePQMigrationTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {createPQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {parsePQSubmissionResponse,parsePQReadResponse} from '../src/wallet-pq-submission-evidence.mjs';
import {TransactionSubmissions} from '../src/transaction-submissions.mjs';
// Actual fresh QA crypto with explicit synthetic policy/HTTP bodies. No node,
// real funds, network writes or claimed source recognition is exercised here.
const owner='0x'+'11'.repeat(20),network={chainId:'71'.repeat(32),owner},nonce='18446744073709551615',amount='9223372036854775806';
let transfer,migration;
before(async()=>{
 const old=await createPQWalletKeyHandle(network),fresh=await createPQWalletKeyHandle(network);
 try{
  const keys=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(old)),next=pqPublicBindingToRegistrationKeys(readPQWalletKeyPublic(fresh));
  const snapshot=parsePQAccountAuthorization({owner,executionHeight:'30',ledgerNonce:'18446744073709551614',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:network.chainId,enableAt:'10',activeRevision:'1',records:[{algorithmVersion:keys.algorithmVersion,owner,pkA:keys.pkA,pkB:keys.pkB,revision:'1',registeredAt:'10',activeFrom:'20',ledgerNonce:'1'}]},{...network,nativeChainId:'6423'});
  transfer=createPQOriginalRecord({account:owner,kind:'pq-transfer',operationId:'QA-transfer',request:signPQWalletNativeTransfer(old,{chainId:network.chainId,nativeChainId:'6423',from:owner,to:'0x'+'22'.repeat(20),amount,fee:'1',nonce},snapshot)});
  const intent={...next,priorRevision:'1',newRevision:'2',ledgerNonce:nonce,activateAt:'60'};
  migration=createPQOriginalRecord({account:owner,kind:'pq-migration',operationId:'QA-migration',request:preparePQMigrationTransport(encodePQMigrationRequest({intent,classicPublicKey:Buffer.alloc(0),classicSignature:Buffer.alloc(0),currentPQMember:signPQWalletCurrentMigration(old,intent,snapshot),newKeyWholeProof:createPQWalletMigrationPossession(fresh,intent)}))});
 }finally{destroyPQWalletKeyHandle(old);destroyPQWalletKeyHandle(fresh);}
});
const h=byte=>'0x'+byte.repeat(32);
function fields(record,read=false){return {amount:record.kind==='pq-transfer'?amount:'0',fee:'1',nonce,executionHeight:'30',...(record.kind==='pq-migration'?{revision:'2',activationHeight:'60'}:{}),...(read?{blockNumber:'0'}:{})};}
function tx(record){return {hash:record.hash,type:record.kind==='pq-transfer'?'transfer':'account_migration',from:owner,to:record.kind==='pq-transfer'?'0x'+'22'.repeat(20):owner,...(record.kind==='pq-transfer'?{amount:Number(amount)}:{}),fee:1,nonce:Number(nonce),timestamp:'2026-10-18T00:00:00Z',memo:(record.kind==='pq-transfer'?'ynx-pq-transfer-v1:':'ynx-pq-migration-v1:')+Buffer.from(record.wire,'base64url').toString('hex')};}
const proof=(record,status,extra={})=>({version:'ynx-local-durability-v1',scope:'local-snapshot',status,transactionHash:record.hash,...extra});
function posted(record){return {transaction:tx(record),wireHash:record.hash,decimalFields:fields(record),replayed:false,status:record.kind==='pq-transfer'?'accepted':'active',...(record.kind==='pq-migration'?{activationHeight:'60',revision:'2',executionHeight:'100'}:{})};}
function read(record,status='pending_durable'){return {...tx(record),transactionHash:record.hash,wireHash:record.hash,decimalFields:fields(record,true),source:'authoritative_producer',consensusFinality:false,ynxDurability:proof(record,status,status==='pending_durable'?{checkpointBlockNumber:'0x0',checkpointBlockHash:h('22'),snapshotIntegrity:h('33')}:{})};}
const invalid=fn=>assert.throws(fn,{code:'PQ_RESPONSE_INVALID'});
test('POST validates original wire identity and exact high integers, but never calls admission finality',()=>{
 for(const original of [transfer,migration]){
  const observed=parsePQSubmissionResponse(original,200,JSON.stringify(posted(original)));assert.equal(observed.outcome,'admitted-unconfirmed');assert.equal(observed.decimalFields.nonce,nonce);assert.equal(observed.consensusFinality,false);assert.equal(observed.retryAuthorized,false);assert.equal(observed.clearsOriginal,false);assert.equal('transaction' in observed,false);assert.equal('wire' in observed,false);
  if(original===migration){assert.equal(observed.nextExecutionHeight,'100');assert.equal(observed.decimalFields.executionHeight,'30');}
  else assert.equal(observed.decimalFields.amount,amount);
 }
});
test('POST uncertainty and every observed HTTP refusal preserve the original and never authorize replay',()=>{
 for(const original of [transfer,migration]){
  const body={error:'retry the identical signed request',status:'transaction_durability_uncertain',transactionHash:original.hash,wireHash:original.hash,decimalFields:fields(original),durabilityVersion:'ynx-local-durability-v1',ynxDurability:proof(original,'uncertain')};
  const observed=parsePQSubmissionResponse(original,503,JSON.stringify(body));assert.equal(observed.outcome,'outcome-unknown');assert.equal(observed.retryAuthorized,false);assert.equal(observed.clearsOriginal,false);
  for(const status of [400,413,415,422]){const rejected=parsePQSubmissionResponse(original,status,JSON.stringify({error:'PUBLIC refusal'}));assert.equal(rejected.outcome,'rejection-observed');assert.equal(rejected.clearsOriginal,false);assert.equal(rejected.retryAuthorized,false);}
 }
});
test('GET pending checkpoint and uncertain observed inclusion are distinct from local durable inclusion',()=>{
 for(const original of [transfer,migration]){
  const pending=parsePQReadResponse(original,200,JSON.stringify(read(original)));assert.equal(pending.outcome,'pending-local-durable');assert.equal(pending.decimalFields.nonce,nonce);
  const body=read(original,'uncertain');body.decimalFields.blockNumber='3';body.blockNumber=3;body.blockHash='44'.repeat(32);body.ynxDurability=proof(original,'uncertain',{blockNumber:'0x3',blockHash:h('44')});
  assert.equal(parsePQReadResponse(original,200,JSON.stringify(body)).outcome,'outcome-unknown');
  body.ynxDurability=proof(original,'durable',{blockNumber:'0x3',blockHash:h('44'),checkpointBlockNumber:'0x5',checkpointBlockHash:h('55'),snapshotIntegrity:h('66')});
  const durable=parsePQReadResponse(original,200,JSON.stringify(body));assert.equal(durable.outcome,'local-inclusion-durable');assert.equal(durable.consensusFinality,false);assert.equal(durable.clearsOriginal,false);assert.equal(durable.retryAuthorized,false);
 }
});
test('GET not_found is an observation, never proof to clear UNKNOWN, change nonce or submit again',()=>{
 const value={error:'transaction not found',status:'not_found',transactionHash:transfer.hash,source:'authoritative_producer',consensusFinality:false,ynxDurability:proof(transfer,'not_found')};
 const observed=parsePQReadResponse(transfer,404,JSON.stringify(value));assert.equal(observed.outcome,'not-found-observed');assert.equal(observed.clearsOriginal,false);assert.equal(observed.retryAuthorized,false);
 invalid(()=>parsePQReadResponse(transfer,404,JSON.stringify({error:'transaction not found'})));invalid(()=>parsePQReadResponse(transfer,200,JSON.stringify(tx(transfer))));
});
test('wrong hash, unsafe decimal DTO, old EVM receipt, wrong wire memo and finality claims fail closed',()=>{
 for(const mutate of [value=>{value.wireHash=h('00');},value=>{value.decimalFields.nonce=Number(nonce);},value=>{value.decimalFields.amount='9223372036854775805';},value=>{value.transaction.memo='PUBLIC wrong original';},value=>{value.confirmed=true;}]){const value=posted(transfer);mutate(value);invalid(()=>parsePQSubmissionResponse(transfer,200,JSON.stringify(value)));}
 for(const mutate of [value=>{value.consensusFinality=true;},value=>{value.transactionHash=h('00');},value=>{value.decimalFields.blockNumber='01';},value=>{value.ynxDurability.transactionHash=h('00');},value=>{value.contractAddress=null;}]){const value=read(transfer);mutate(value);invalid(()=>parsePQReadResponse(transfer,200,JSON.stringify(value)));}
});
test('malformed JSON diagnostics and bounded parsing never expose response text as an error',()=>{
 for(const text of ['{"PRIVATE_QA_DO_NOT_ECHO":','x'.repeat(8*1024*1024+1)])assert.throws(()=>parsePQReadResponse(transfer,200,text),error=>error.code==='PQ_RESPONSE_INVALID'&&!error.message.includes('PRIVATE_QA_DO_NOT_ECHO')&&!(error instanceof SyntaxError));
});
test('original submissions owner checks PQ by hash only, without clearing or falling through to EVM transport',async()=>{
 let reads=0,checks=0;
 const guard={account:owner,assert(){checks++;}};
 const submissions=new TransactionSubmissions({intentStore:{async readPQOriginals(account,current){assert.equal(account,owner);current();return [transfer];}},provider:{send(){assert.fail('PQ read must not use an EVM receipt or broadcast');}},pqReadOriginal:async(...args)=>{reads++;assert.deepEqual(args,[transfer.hash]);return {status:200,text:JSON.stringify(read(transfer))};}});
 const result=await submissions.checkPQ(transfer.hash,owner,guard);
 assert.equal(reads,1);assert.ok(checks>=5);assert.equal(result.outcome,'pending-local-durable');assert.equal(result.clearsOriginal,false);assert.equal(result.retryAuthorized,false);assert.equal('wire' in result,false);
 await assert.rejects(submissions.checkPQ(h('00'),owner,guard),error=>error.data?.code==='TRANSACTION_INTENT_REQUIRED');assert.equal(reads,1);
});
test('PQ original check fails closed before source wiring and discards a late result after lock',async()=>{
 const guard={account:owner,assert(){}};
 await assert.rejects(new TransactionSubmissions({}).checkPQ(transfer.hash,owner,guard),error=>error.data?.code==='PQ_READ_SOURCE_UNAVAILABLE');
 let locked=false,release,started;const entered=new Promise(resolve=>{started=resolve;});
 const submissions=new TransactionSubmissions({intentStore:{async readPQOriginals(){return [transfer];}},pqReadOriginal:()=>{started();return new Promise(resolve=>{release=resolve;});}});
 const activeGuard={account:owner,assert(){if(locked)throw Object.assign(new Error('QA lock'),{code:'WALLET_LOCKED'});}};
 const pending=submissions.checkPQ(transfer.hash,owner,activeGuard);await entered;
 await assert.rejects(submissions.checkPQ(transfer.hash,owner,activeGuard),error=>error.data?.code==='TRANSACTION_CHECK_IN_PROGRESS');
 locked=true;release({status:200,text:JSON.stringify(read(transfer))});await assert.rejects(pending,{code:'WALLET_LOCKED'});
 locked=false;await assert.rejects(submissions.checkPQ(h('00'),owner,activeGuard),error=>error.data?.code==='TRANSACTION_INTENT_REQUIRED');
});

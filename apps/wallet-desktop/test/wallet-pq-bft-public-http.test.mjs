import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {createPQOriginalRecord} from '../src/wallet-pq-intent-record.mjs';
import {preparePQTransferTransport,preparePQMigrationTransport,preparePQRevocationTransport,decodePQRevocationRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {pqBFTOriginalIdentity,parsePQBFTOriginalResponse,parsePQBFTSubmissionResponse} from '../src/wallet-pq-bft-evidence.mjs';
const raw=gunzipSync(readFileSync(new URL('./fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url)),{maxOutputLength:8*1024*1024}),hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(raw.length,6814038);assert.equal(hash(raw),'add71722750c1ff8d0d6efff259ab0025864bc56179366503fade52dfae434ab');
const fixture=JSON.parse(raw),originals=new Map();
for(const value of fixture.originals){
 const wire=Buffer.from(value.wire,'base64');assert.equal(wire.toString('base64'),value.wire);
 const kind=value.kind==='pq_transfer'?'pq-transfer':value.kind==='account_migration'?'pq-migration':value.kind==='account_revocation'?'pq-revocation':assert.fail('Unknown producer fixture kind');
 const request=kind==='pq-transfer'?preparePQTransferTransport(wire):kind==='pq-migration'?preparePQMigrationTransport(wire):preparePQRevocationTransport(wire);
 const record=createPQOriginalRecord({account:fixture.owner,kind,operationId:'QA-public-'+value.name,request});assert.equal(record.hash,value.nativeWireHash);originals.set(value.name,{record,value});
}
const body=row=>{const b=Buffer.from(row.bodyWire,'base64');assert.equal(b.toString('base64'),row.bodyWire);const text=new TextDecoder('utf-8',{fatal:true}).decode(b);assert.deepEqual(JSON.parse(text),row.body);return text;};
const txRows=fixture.http.filter(row=>typeof row.body?.nativeTransactionHash==='string'),originalFor=row=>[...originals.values()].find(x=>x.record.hash===row.body.nativeTransactionHash).record;
test('exact public producer fixture keeps application/test-rpc evidence separate from node/finality/deployment',()=>{
 assert.equal(fixture.version,'YNX-PQ-WALLET-HTTP-FIXTURE/v1');assert.equal(fixture.sourceKind,'application-backed-test-rpc');assert.equal(fixture.actualCometNode,false);assert.equal(fixture.independentFinality,false);assert.equal(fixture.deployedSourceQualification,false);assert.equal(fixture.syntheticOnly,true);assert.match(fixture.revocationIngress,/not a gateway revoke POST/);assert.equal(txRows.length,9);
});
test('six actual Go originals match native hash, exact ABCI JSON bytes and distinct ABCI hash including revocation',()=>{
 for(const {record,value} of originals.values()){
  const identity=pqBFTOriginalIdentity(record),abci=Buffer.from(value.abciWire,'base64');assert.deepEqual(JSON.parse(abci),value.abciEnvelope);assert.equal(abci.toString('utf8'),JSON.stringify(value.abciEnvelope));
  assert.equal(identity.nativeTransactionHash,value.nativeWireHash);assert.equal(identity.abciTransactionHash,value.abciTransactionHash);assert.equal(identity.abciTransactionHash,'0x'+hash(abci));assert.notEqual(identity.nativeTransactionHash,identity.abciTransactionHash);assert.equal(value.abciEnvelope.type,value.kind);assert.equal(value.abciEnvelope.wireHex,Buffer.from(record.wire,'base64url').toString('hex'));
 }
});
test('nine real Gateway raw HTTP bodies bind original bytes without retyping or granting finality/retry',()=>{
 for(const row of txRows){
  const original=originalFor(row),text=body(row),observed=(row.method==='POST'?parsePQBFTSubmissionResponse:parsePQBFTOriginalResponse)(original,row.statusCode,text);
  assert.equal(observed.hash,original.hash);assert.equal(observed.abciTransactionHash,row.body.abciTransactionHash);assert.equal(observed.retryAuthorized,false);assert.equal(observed.clearsOriginal,false);assert.equal(observed.consensusFinality,false);assert.equal(observed.producerDurability,false);assert.equal('wire' in observed,false);assert.equal('transaction' in observed,false);
  assert.equal(observed.outcome,row.body.status==='committed'?'bft-inclusion-observed':row.body.status==='unknown'?'outcome-unknown':'rejection-observed');
 }
});
test('real 202 lost response and GET original reconciliation retain same native and ABCI identities',()=>{
 const lost=fixture.http.find(row=>row.name==='transfer-outcome-unknown'),read=fixture.http.find(row=>row.name==='transfer-original-reconciled'),original=originalFor(lost),before=JSON.stringify(original);
 assert.equal(parsePQBFTSubmissionResponse(original,lost.statusCode,body(lost)).outcome,'outcome-unknown');assert.equal(parsePQBFTOriginalResponse(original,read.statusCode,body(read)).outcome,'bft-inclusion-observed');assert.equal(JSON.stringify(original),before);assert.equal(original.status,'signed-unsubmitted');assert.equal(lost.body.abciTransactionHash,read.body.abciTransactionHash);assert.equal(lost.body.nativeTransactionHash,read.body.nativeTransactionHash);
});
test('actual historical migration and transfer remain original history after terminal revocation, not current signing authority',()=>{
 const policy=fixture.http.find(row=>row.name==='authorization-revoked-after-restart');assert.equal(policy.body.authorizationStatus,'revoked');assert.equal(policy.body.pqSigningEnabled,false);
 for(const name of ['initial-migration-history-after-revocation','first-transfer-history-after-revocation']){const row=fixture.http.find(row=>row.name===name),observed=parsePQBFTOriginalResponse(originalFor(row),row.statusCode,body(row));assert.equal(observed.outcome,'bft-inclusion-observed');assert.equal(observed.retryAuthorized,false);assert.equal(observed.clearsOriginal,false);assert.equal(observed.consensusFinality,false);}
});
test('controlled mutations of real response hashes, raw wire, source, decimals and signed operation refuse',()=>{
 const row=fixture.http.find(row=>row.name==='transfer-committed'),original=originalFor(row);
 for(const mutate of [v=>{v.nativeTransactionHash=v.abciTransactionHash;},v=>{v.abciTransactionHash=v.nativeTransactionHash;},v=>{v.source='authoritative_producer';},v=>{v.nonce=Number(v.nonce);},v=>{v.wire=v.wire.slice(1);},v=>{v.transaction.memo+='00';},v=>{v.transaction.to=fixture.owner;},v=>{v.readbackUrl='/txs/'+v.abciTransactionHash;}]){const value=structuredClone(row.body);mutate(value);assert.throws(()=>parsePQBFTOriginalResponse(original,200,JSON.stringify(value)),{code:'PQ_BFT_RESPONSE_INVALID'});}
});
test('controlled revocation uncertainty uses exact original N1 identity and never grants replay',()=>{
 const {record}=originals.get('terminal-revocation'),identity=pqBFTOriginalIdentity(record),value={...identity,type:'account_revocation',wire:Buffer.from(record.wire,'base64url').toString('base64'),status:'unknown',committed:false,executionHeight:'0',amount:'0',fee:'0',nonce:'0'};
 const observed=parsePQBFTSubmissionResponse(record,202,JSON.stringify(value));assert.equal(observed.outcome,'outcome-unknown');assert.equal(observed.retryAuthorized,false);assert.equal(observed.clearsOriginal,false);assert.equal(observed.consensusFinality,false);
 const {intent}=decodePQRevocationRequest(Buffer.from(record.wire,'base64url'));assert.equal(BigInt(intent.revokeAt),BigInt(intent.executeAt)+1n);
});
test('controlled revocation inclusion binds signed H and one fee flow without inventing fee-event or finality proof',()=>{
 // Structural control derived from frozen Go PQMemberView/account_revocation;
 // NOT an actual Gateway revoke POST/GET fixture, validator or live Source.
 const {record}=originals.get('terminal-revocation'),{intent}=decodePQRevocationRequest(Buffer.from(record.wire,'base64url')),wire=Buffer.from(record.wire,'base64url');
 const value={...pqBFTOriginalIdentity(record),type:'account_revocation',wire:wire.toString('base64'),status:'committed',committed:true,executionHeight:intent.executeAt,cometIndex:0,from:record.account,to:record.account,amount:'0',fee:'1',nonce:intent.ledgerNonce,transaction:{hash:record.hash,type:'account_revocation',from:record.account,to:record.account,fee:1,nonce:Number(intent.ledgerNonce),blockNumber:Number(intent.executeAt),timestamp:new Date(Number(intent.executeAt)*1000).toISOString(),memo:'ynx-pq-revocation-v1:'+wire.toString('hex'),lotFlows:[{lotId:'PUBLIC-CONTROLLED-FEE-LOT',amount:1,from:record.account,to:'PUBLIC-CONTROLLED-VALIDATOR'}]}};
 const observed=parsePQBFTOriginalResponse(record,200,JSON.stringify(value));assert.equal(observed.outcome,'bft-inclusion-observed');assert.equal(observed.signedRevocation.executeAt,intent.executeAt);assert.equal(observed.signedRevocation.revokeAt,intent.revokeAt);assert.equal(observed.feeLotFlowObserved,true);assert.equal(observed.feeEffectsVerified,false);assert.equal(observed.consensusFinality,false);assert.equal(observed.retryAuthorized,false);assert.equal(observed.clearsOriginal,false);
 for(const mutate of [v=>{v.executionHeight=(BigInt(intent.executeAt)+1n).toString();v.transaction.blockNumber++;},v=>{delete v.transaction.lotFlows;},v=>{v.transaction.lotFlows=[];},v=>{v.transaction.lotFlows[0].amount=2;},v=>{v.transaction.lotFlows[0].from=fixture.recipient;},v=>{v.transaction.lotFlows[0].to='';},v=>{v.transaction.lotFlows[0].lotId=' ';},v=>{v.transaction.lotFlows.push(v.transaction.lotFlows[0]);},v=>{v.transaction.lotFlows[0].extra=true;},v=>{v.transaction.memo='ynx-pq-transfer-v1:'+wire.toString('hex');}]){const changed=structuredClone(value);mutate(changed);assert.throws(()=>parsePQBFTOriginalResponse(record,200,JSON.stringify(changed)),{code:'PQ_BFT_RESPONSE_INVALID'});}
});

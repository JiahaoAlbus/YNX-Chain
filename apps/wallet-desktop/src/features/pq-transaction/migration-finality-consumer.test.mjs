import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {preparePQMigrationTransport,decodePQMigrationRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {createPQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {preparePQFinalityOriginal,preparePQFinalityTarget,bindPQFinalityContext} from '../../wallet-pq-finality-original.mjs';
import {PQFinalityEvidence} from '../../wallet-pq-finality-evidence.mjs';
import {createPQFinalityCollection} from '../../wallet-pq-finality-collection.mjs';
import {parsePQTransferFinalityCollector} from './finality-collector.mjs';
const vector=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url)))),row=vector.originals.find(x=>x.name==='rotation'),wire=Buffer.from(row.wire,'base64'),decoded=decodePQMigrationRequest(wire),binding={account:decoded.intent.owner,networkId:decoded.intent.chainId},original=createPQOriginalRecord({account:binding.account,kind:'pq-migration',operationId:'PUBLIC-migration-finality',request:preparePQMigrationTransport(wire)});
function target(){return{transactionType:'account_migration',nativeWire:wire.toString('base64'),envelope:Buffer.from(JSON.stringify({version:1,type:'account_migration',wireHex:wire.toString('hex')})).toString('base64'),transactionHash:row.abciTransactionHash.slice(2),nativeWireHash:row.nativeWireHash.slice(2),index:'7',block:{chainId:'PUBLIC-MIGRATION-ONLY',headerHeight:'9',blockHash:'11'.repeat(32),stateHeight:'8',stateAppHash:'22'.repeat(32)},successor:{chainId:'PUBLIC-MIGRATION-ONLY',headerHeight:'10',blockHash:'33'.repeat(32),stateHeight:'9',stateAppHash:'44'.repeat(32)}};}
function rawUnavailable(){return Buffer.from(JSON.stringify({version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'configured-comet-rpc',status:'unavailable',nativeTransactionHash:'',abciTransactionHash:row.abciTransactionHash,executionHeight:'0',independentFinality:false,proofVerification:'not-performed',error:'PUBLIC unavailable'}));}
test('migration finality target binds complete E6/E3 and separate Host H/index without a transfer cast',()=>{
 const plan=preparePQFinalityOriginal(original,binding),t=preparePQFinalityTarget(original,binding,target());assert.equal(plan.binding.kind,'pq-migration');assert.equal(t.transactionType,'account_migration');assert.equal(t.nativeWireHash,row.nativeWireHash.slice(2));assert.equal(t.transactionHash,row.abciTransactionHash.slice(2));assert.notEqual(t.nativeWireHash,t.transactionHash);assert.equal(t.index,'7');assert.equal(BigInt(t.successor.headerHeight),BigInt(t.block.headerHeight)+1n);assert.deepEqual(Buffer.from(t.nativeWire,'base64'),wire);
 for(const edit of [{transactionType:'pq_transfer'},{nativeWireHash:t.transactionHash},{transactionHash:t.nativeWireHash},{index:'4294967296'},{envelope:Buffer.from('other').toString('base64')},{successor:{...t.successor,headerHeight:'11'}}])assert.throws(()=>preparePQFinalityTarget(original,binding,{...t,...edit}));
});
test('migration collector observations remain pending/unavailable DATA, never a finality or Root grant',()=>{
 const a=parsePQTransferFinalityCollector(original,binding,502,rawUnavailable());assert.equal(a.observation.kind,'pq-migration');assert.equal(a.observation.transactionType,'account_migration');assert.equal(a.observation.independentFinality,false);assert.equal(a.observation.consensusFinality,false);assert.equal(a.proof,null);
 const pending={version:'YNX-PQ-RPC-TRANSACTION-PROOF/v1',source:'configured-comet-rpc',status:'pending',nativeTransactionHash:row.nativeWireHash,abciTransactionHash:row.abciTransactionHash,executionHeight:'9',cometIndex:7,observedExecutionStatus:'committed',independentFinality:false,proofVerification:'not-performed'};
 const b=parsePQTransferFinalityCollector(original,binding,202,Buffer.from(JSON.stringify(pending)));assert.equal(b.observation.cometIndex,7);assert.equal(b.proof,null);assert.equal(b.observation.consensusFinality,false);assert.throws(()=>parsePQTransferFinalityCollector(original,binding,202,Buffer.from(JSON.stringify({...pending,abciTransactionHash:row.nativeWireHash}))),{code:'PQ_FINALITY_ORIGINAL_MISMATCH'});
});
test('migration existing protected evidence collection and cold restore preserve original identity without a verifier',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-public-migration-proof-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new FileTransactionIntentStore({filePath:path.join(dir,'journal.json')});await store.reserveOriginal(binding.account,'pq-migration');store.captureOriginal(binding.account,original,'pq-migration');await store.saveOriginal(binding.account,original.hash,()=>{});
 let reads=0;const evidence=new PQFinalityEvidence({directory:path.join(dir,'evidence')}),controller=createPQFinalityCollection({intentStore:store,networkId:binding.networkId,evidence,transport:{async readFinalityProof(o,b){reads++;assert.deepEqual(o,original);assert.deepEqual(b,binding);return{status:502,rawBytes:rawUnavailable()}}}}),guard={account:binding.account,assert(){}};
 const out=await controller.collect(original.hash,guard);assert.equal(out.kind,'pq-migration');assert.equal(out.status,'unavailable');assert.equal(out.rawStored,true);assert.equal(out.independentFinality,false);assert.equal(out.consensusFinality,false);assert.equal(out.proofCollected,false);assert.equal(reads,1);
 const restored=await controller.restore(original.hash,guard);assert.equal(restored.records.length,1);assert.equal(restored.records[0].kind,'pq-migration');assert.equal(restored.records[0].abciTransactionHash,row.abciTransactionHash);await assert.rejects(controller.verify(original.hash,guard),{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'});assert.equal(reads,1);assert.deepEqual(await store.readPQOriginals(binding.account,()=>{}),[original]);
});

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
import {createPQTransactionSubmission} from './submission.mjs';
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('../../../test/fixtures/pq-public-http-af1cbaf.json.gz',import.meta.url))));
const row=fixture.originals.find(x=>x.name==='rotation'),wire=Buffer.from(row.wire,'base64'),decoded=decodePQMigrationRequest(wire),account=decoded.intent.owner,networkId=decoded.intent.chainId;
const original=createPQOriginalRecord({account,kind:'pq-migration',operationId:'PUBLIC-saved-migration',request:preparePQMigrationTransport(wire)});
const responseRow=fixture.http.find(x=>x.name==='rotation-committed'),committed={status:responseRow.statusCode,text:Buffer.from(responseRow.bodyWire,'base64').toString('utf8')};
async function setup(t){
 assert.equal(fixture.actualCometNode,false);const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-public-migration-consumer-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filePath=path.join(dir,'journal.json'),store=new FileTransactionIntentStore({filePath});await store.reserveOriginal(account,'pq-migration');store.captureOriginal(account,original,'pq-migration');await store.saveOriginal(account,original.hash,()=>{});return{store,filePath,cold:()=>new FileTransactionIntentStore({filePath})};
}
test('stored PQ migration cold reconcile dispatches its exact E6 native lookup without transfer or send',async t=>{
 const f=await setup(t);await f.store.beginPQSubmission(account,original.hash,()=>{});const calls=[];
 const controller=createPQTransactionSubmission({intentStore:f.cold(),networkId,transport:{async readOriginal(hash){calls.push(['GET',hash]);return committed},async submitTransfer(){throw Error('NO_TRANSFER')},async submitMigration(){throw Error('NO_SEND')}},acquireOriginalWalletTransactionPermission:()=>{throw Error('NO_APPROVAL')},isOriginalWalletTransactionPermission:()=>false});
 const out=await controller.reconcile(original.hash,{account,assert(){}});assert.equal(out.kind,'pq-migration');assert.equal(out.status,'inclusion-observed');assert.equal(out.consensusFinality,false);assert.deepEqual(calls,[['GET',original.hash]]);assert.deepEqual(await f.cold().readPQOriginals(account,()=>{}),[original]);
});

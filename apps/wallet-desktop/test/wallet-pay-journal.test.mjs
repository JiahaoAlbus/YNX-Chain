import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,stat} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {canonicalJSON,createSignedNativeTransfer,createSignedPayPaymentResult,evmAddressFromYNX} from "@ynx-chain/wallet-auth";
import {FileTransactionIntentStore,ORIGINAL_OWNER_LIMIT} from "../src/transaction-intent-store.mjs";
import {TransactionSubmissions} from "../src/transaction-submissions.mjs";
import {parseDesktopSignedPayRecord} from "../src/wallet-pay-record.mjs";
import {CANONICAL_RPC_URL} from "../src/rpc.mjs";
import {payTestSecret,signedPayFixture} from "./fixture-signed-pay.mjs";
import {Wallet,Transaction} from "ethers";
import {PrivateFilePolicy} from "../src/platform-private-file.mjs";
import {parseFeeModel} from "../src/rpc-capabilities.mjs";
async function ethereumIntent(secret=payTestSecret){
  const source=JSON.parse(await readFile(new URL("./fixtures/transaction-durability/native-json-contract-fixture.json",import.meta.url),"utf8"));
  const capabilities={version:"ynx-ethereum-native-v1",enabled:true,chainId:"0x1917",transactionType:"0x0",feeYNXT:"1",feeWei:"0xde0b6b3a7640000",gas:"0x61a8",gasPrice:"0x246139ca8000",decimals:18,amountQuantumWei:"0xde0b6b3a7640000",scope:"whole-YNXT plain native transfers",fullEVM:false,eip1559:false,durability:source.capability};
  const wallet=new Wallet("0x"+secret),to="0x"+"2".repeat(40),raw=await wallet.signTransaction({chainId:6423,type:0,nonce:0,to,value:10n**18n,gasLimit:25000,gasPrice:BigInt(capabilities.gasPrice)});
  return {account:wallet.address.toLowerCase(),chainId:"0x1917",nonce:"0x0",hash:Transaction.from(raw).hash,to,value:"0xde0b6b3a7640000",capabilities:parseFeeModel(capabilities),raw,origin:CANONICAL_RPC_URL};
}
function packet(version=1,nonce=2){
  const f=signedPayFixture(version),transfer=createSignedNativeTransfer({accountSecret:payTestSecret,to:f.input.review.to,amount:25,nonce});
  const paymentResult=createSignedPayPaymentResult({accountSecret:payTestSecret,intent:f.input.rawIntent,transferPayload:transfer.payload,issuedAt:new Date(f.input.now()).toISOString()},new Date(f.input.now()));
  return {...f,record:{version:2,account:f.identity.account,origin:CANONICAL_RPC_URL,invoice:f.input.rawInvoice,intent:f.input.rawIntent,session:f.authority.session,transfer,paymentResult}};
}
async function fixture(){const directory=await mkdtemp(join(tmpdir(),"ynx-desktop-pay-journal-")),filePath=join(directory,"journal.json");return{filePath,store:new FileTransactionIntentStore({filePath})}}
test('r5 full Pay save-only persists original record with conservative progress and idempotent cold read',async()=>{
 const f=packet(),{store,filePath}=await fixture(),account=evmAddressFromYNX(f.identity.account);await store.reserveOriginal(account,'pay');store.captureOriginal(account,f.record,'pay');
 await store.saveOriginal(account,f.record.transfer.hash,()=>{},{policy:f.input.policy});assert.equal(store.localOriginal(account),null);
 const cold=new FileTransactionIntentStore({filePath}),entry=await cold.signedPayProgress(f.identity.account,f.input.policy,()=>{});assert.equal(canonicalJSON(entry.record),canonicalJSON(f.record));assert.equal(entry.broadcastAttempted,true);assert.equal(entry.settlementAttempted,false);
 const before=await readFile(filePath,'utf8');await cold.saveOriginal(account,f.record.transfer.hash,()=>{},{policy:f.input.policy});assert.equal(await readFile(filePath,'utf8'),before);await assert.rejects(cold.assertNoPreparation(account).then(()=>cold.assertNoSignedPayment(account)));
});
test('r5 marker-only cold and native-only Pay cannot synthesize or clear an original',async()=>{
 const f=packet(),{store,filePath}=await fixture(),account=evmAddressFromYNX(f.identity.account);await store.reserveOriginal(account,'pay');const before=await readFile(filePath,'utf8');
 await assert.rejects(new FileTransactionIntentStore({filePath}).saveOriginal(account,f.record.transfer.hash,()=>{},{policy:f.input.policy}));store.captureOriginal(account,f.record.transfer,'native');await assert.rejects(store.saveOriginal(account,f.record.transfer.hash,()=>{},{policy:f.input.policy}));assert.equal(await readFile(filePath,'utf8'),before);
});
test('r5 full Pay publication fault preserves first cause and separately updates storage cause',async()=>{
 const f=packet(),{store,filePath}=await fixture(),account=evmAddressFromYNX(f.identity.account);await store.reserveOriginal(account,'pay');store.captureOriginal(account,f.record,'pay');store.originalFailed(account,Error('QA_ORIGINAL_LOCK'));
 const replace=store.filePolicy.replace.bind(store.filePolicy);store.filePolicy.replace=async()=>{throw Error('QA_R5_DISK')};await assert.rejects(store.saveOriginal(account,f.record.transfer.hash,()=>{},{policy:f.input.policy}));
 const local=store.localOriginal(account);assert.equal(canonicalJSON(local.pay),canonicalJSON(f.record));assert.equal(local.originalCause.message,'QA_ORIGINAL_LOCK');assert.equal(local.storageCause.message,'QA_R5_DISK');assert.ok(await store.unresolvedPreparation(account));
 store.filePolicy.replace=replace;await store.saveOriginal(account,f.record.transfer.hash,()=>{},{policy:f.input.policy});assert.equal(store.localOriginal(account),null);assert.ok((await readFile(filePath,'utf8')).includes(f.record.paymentResult.walletSignature));
});
test('r5 full Pay save cannot overwrite another complete valid journal original',async()=>{
 const f=packet(),other=packet(1,3),{store,filePath}=await fixture(),account=evmAddressFromYNX(f.identity.account);await store.reserveOriginal(account,'pay');store.captureOriginal(account,f.record,'pay');
 await store.retainSignedPayment(other.record,other.input.policy,()=>{});const before=await readFile(filePath,'utf8');await assert.rejects(store.saveOriginal(account,f.record.transfer.hash,()=>{},{policy:f.input.policy}));assert.equal(await readFile(filePath,'utf8'),before);assert.equal(canonicalJSON(store.localOriginal(account).pay),canonicalJSON(f.record));
});
test('r5 Pay save rejects wrong hash and absent policy before discarding held custody',async()=>{
 const f=packet(),{store,filePath}=await fixture(),account=evmAddressFromYNX(f.identity.account);await store.reserveOriginal(account,'pay');store.captureOriginal(account,f.record,'pay');const before=await readFile(filePath,'utf8');
 await assert.rejects(store.saveOriginal(account,'0x'+'f'.repeat(64),()=>{},{policy:f.input.policy}));await assert.rejects(store.saveOriginal(account,f.record.transfer.hash,()=>{}));assert.equal(await readFile(filePath,'utf8'),before);assert.ok(store.localOriginal(account).pay);
});
test("r4 durable preparing marker blocks cold replacement and capacity rejects before producer",async()=>{
 const {store,filePath}=await fixture();for(let i=1;i<=ORIGINAL_OWNER_LIMIT;i++)await store.reserveOriginal('0x'+i.toString(16).padStart(40,'0'),'native');
 await assert.rejects(store.reserveOriginal('0x'+"9".repeat(40),'native'));assert.equal((JSON.parse(await readFile(filePath))).preparations.length,8);
 const cold=new FileTransactionIntentStore({filePath});for(let i=1;i<=8;i++){assert.equal(cold.localOriginal('0x'+i.toString(16).padStart(40,'0')),null);await assert.rejects(cold.assertNoPreparation('0x'+i.toString(16).padStart(40,'0')))}
 await assert.rejects(store.reserveOriginal('0x'+"1".padStart(40,'0'),'native'));
});
test("r4 failed initial marker readback blocks signing and cold owner without deleting marker",async()=>{
 const {store,filePath}=await fixture(),replace=store.filePolicy.replace.bind(store.filePolicy);store.filePolicy.replace=async(...args)=>{await replace(...args);throw Error('QA_MARKER_ACK')};const account='0x'+"1".repeat(40);await assert.rejects(store.reserveOriginal(account,'native'));assert.equal(store.localOriginal(account),null);
 const cold=new FileTransactionIntentStore({filePath});await assert.rejects(cold.assertNoPreparation(account));const rows=await new TransactionSubmissions({intentStore:cold}).list(account);assert.equal(rows[0].signingUnknown,true);assert.equal(rows[0].hash,null);
});
test("r4 signed publication failure preserves complete Pay owner and separate cause, never raw renderer DTO",async()=>{
 const f=packet(),{store,filePath}=await fixture(),account=evmAddressFromYNX(f.identity.account);await store.reserveOriginal(account,'pay');store.captureOriginal(account,f.record,'pay');
 store.originalFailed(account,Error('QA_PRODUCER_CAUSE'));store.originalFailed(account,Error('QA_SAVE_CAUSE'),{storage:true});
 const entry=await store.signedPayProgress(f.identity.account,f.input.policy,()=>{});assert.equal(canonicalJSON(entry.record),canonicalJSON(f.record));assert.equal(entry.localRetention.originalCause.message,'QA_PRODUCER_CAUSE');assert.equal(entry.localRetention.storageCause.message,'QA_SAVE_CAUSE');
 assert.equal(Object.isFrozen(store.localOriginal(account).pay.paymentResult),true);const cold=new FileTransactionIntentStore({filePath});assert.equal(await cold.signedPayProgress(f.identity.account,f.input.policy,()=>{}),null);await assert.rejects(cold.assertNoPreparation(account));
});
test("r4 conflicting duplicate capture cannot overwrite original public packet",async()=>{
 const f=packet(),{store}=await fixture(),account=evmAddressFromYNX(f.identity.account);await store.reserveOriginal(account,'pay');store.captureOriginal(account,f.record,'pay');const before=canonicalJSON(store.localOriginal(account).pay);assert.throws(()=>store.captureOriginal(account,packet(1,3).record,'pay'));assert.equal(canonicalJSON(store.localOriginal(account).pay),before);await assert.rejects(store.reserveOriginal(account,'pay'));
});
test("r4 schema successor preserves old private original and does not invent a no-broadcast proof",async()=>{
 const f=packet(),{store,filePath}=await fixture();await store.retainSignedPayment(f.record,f.input.policy,()=>{});const old=JSON.parse(await readFile(filePath));assert.equal(old.schemaVersion,3);
 await store.reserveOriginal('0x'+"3".repeat(40),'native');const current=JSON.parse(await readFile(filePath));assert.equal(current.schemaVersion,5);assert.equal(canonicalJSON(current.signedPayments[0]),canonicalJSON(old.signedPayments[0]));assert.equal(current.payProgress[0].broadcastAttempted,true);assert.equal(current.preparations.length,1);
 const cold=new FileTransactionIntentStore({filePath});assert.equal(canonicalJSON((await cold.signedPayProgress(f.identity.account,f.input.policy,()=>{})).record),canonicalJSON(f.record));await assert.rejects(cold.assertNoSignedPayment(evmAddressFromYNX(f.identity.account)));
});
for(const version of [1,2,3,4,5])test(`Desktop v${version} saves immutable signed packet in original private journal and re-verifies after restart/expiry`,async()=>{
  const f=packet(version),{filePath,store}=await fixture();await store.retainSignedPayment(f.record,f.input.policy,()=>{});
  const raw=await readFile(filePath,"utf8"),saved=JSON.parse(raw);assert.equal(saved.schemaVersion,3);assert.equal(saved.signedPayments.length,1);assert.deepEqual(saved.records,[]);assert.equal((await stat(filePath)).mode&0o777,0o600);
  f.setNow(f.input.now()+3600_000);const restart=new FileTransactionIntentStore({filePath});
  assert.equal(canonicalJSON(await restart.signedPayment(f.identity.account,f.input.policy,()=>{})),canonicalJSON(f.record));
  await assert.rejects(restart.assertNoSignedPayment(evmAddressFromYNX(f.identity.account)),error=>error.data?.code==="PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW");
  await restart.retainSignedPayment(f.record,f.input.policy,()=>{});assert.equal(await readFile(filePath,"utf8"),raw);
});
test("Desktop legacy journal read remains byte-for-byte unchanged until explicit signed publication",async()=>{
  for(const version of [1,2]){const {filePath,store}=await fixture(),before=JSON.stringify({schemaVersion:version,records:[],rejections:[],...(version===2?{resolutions:[]}: {})});
    await writeFile(filePath,before,{mode:0o600});assert.deepEqual(await store.snapshot(),[]);assert.equal(await readFile(filePath,"utf8"),before);
    const f=packet();await store.retainSignedPayment(f.record,f.input.policy,()=>{});const after=JSON.parse(await readFile(filePath,"utf8"));assert.equal(after.schemaVersion,3);assert.deepEqual(after.records,[]);assert.deepEqual(after.rejections,[]);assert.deepEqual(after.resolutions,[]);
  }
});
test("Desktop retained original cannot be replaced with another nonce or discarded by generic sender preparation",async()=>{
  const f=packet(),{filePath,store}=await fixture();await store.retainSignedPayment(f.record,f.input.policy,()=>{});const before=await readFile(filePath,"utf8");
  const second=packet(1,3);await assert.rejects(store.retainSignedPayment(second.record,second.input.policy,()=>{}));assert.equal(await readFile(filePath,"utf8"),before);
  const submissions=new TransactionSubmissions({intentStore:store});await assert.rejects(submissions.assertResolved(evmAddressFromYNX(f.identity.account)),error=>error.data?.code==="PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW");
  assert.equal(await readFile(filePath,"utf8"),before);
});
test("Desktop tampered Pay journal blocks generic creation without deleting the corrupt original",async()=>{
  const f=packet(),{filePath,store}=await fixture();await store.retainSignedPayment(f.record,f.input.policy,()=>{});
  const state=JSON.parse(await readFile(filePath,"utf8"));state.signedPayments[0].transfer.hash="0x"+"f".repeat(64);const raw=JSON.stringify(state);await writeFile(filePath,raw,{mode:0o600});
  await assert.rejects(store.snapshot(),error=>error.data?.code==="TRANSACTION_JOURNAL_INVALID");await assert.rejects(store.assertNoSignedPayment(evmAddressFromYNX(f.identity.account)));assert.equal(await readFile(filePath,"utf8"),raw);
});
test("Desktop persisted policy is not signer authority and live guards fence record publication",async()=>{
  const f=packet(),{filePath,store}=await fixture();await assert.rejects(store.retainSignedPayment(f.record,null,()=>{}));await assert.rejects(readFile(filePath),error=>error.code==="ENOENT");
  await assert.rejects(store.retainSignedPayment(f.record,f.input.policy,()=>{throw Error("locked")}));await assert.rejects(readFile(filePath),error=>error.code==="ENOENT");
  await store.retainSignedPayment(f.record,f.input.policy,()=>{});await assert.rejects(store.signedPayment(f.identity.account,null,()=>{}));
  assert.equal(await store.signedPayment(signedPayFixture().input.rawInvoice.payoutAddress,f.input.policy,()=>{}),null);
});
test("Desktop historical fields cannot substitute session, intent, invoice or transfer evidence",()=>{
  const f=packet(5);
  for(const change of [{session:{...f.record.session,nonce:"x".repeat(32),sessionBinding:"a".repeat(64)}},{invoice:{...f.record.invoice,merchantName:"other merchant"}},{intent:{...f.record.intent,amount:24}},{paymentResult:{...f.record.paymentResult,transactionHash:"0x"+"f".repeat(64)}},{origin:"https://other.example"}]){
    assert.throws(()=>parseDesktopSignedPayRecord(canonicalJSON({...f.record,...change}),f.identity.account,f.input.policy,()=>{}));
  }
});
test("Desktop Ethereum journal and signed Pay admission block each other for the same account",async()=>{
  const f=packet(),eth=await ethereumIntent(),first=await fixture();await first.store.add(eth);const before=await readFile(first.filePath,"utf8");
  await assert.rejects(first.store.retainSignedPayment(f.record,f.input.policy,()=>{}),error=>error.data?.code==="TRANSACTION_RESOLUTION_REQUIRED");assert.equal(await readFile(first.filePath,"utf8"),before);
  const second=await fixture();await second.store.retainSignedPayment(f.record,f.input.policy,()=>{});const signed=await readFile(second.filePath,"utf8");
  await assert.rejects(second.store.add(eth),error=>error.data?.code==="PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW");assert.equal(await readFile(second.filePath,"utf8"),signed);
});
test("Desktop publishing signed Pay preserves another account's actual Ethereum bytes and fields",async()=>{
  const f=packet(),eth=await ethereumIntent("02".repeat(32)),{store,filePath}=await fixture();await store.add(eth);const before=await store.snapshot();
  await store.retainSignedPayment(f.record,f.input.policy,()=>{});assert.deepEqual(await store.snapshot(),before);assert.equal(JSON.parse(await readFile(filePath,"utf8")).records[0].raw,eth.raw);
});
test("Desktop failed durable file replacement cannot claim a saved Pay packet",async()=>{
  const f=packet(),{filePath}=await fixture(),policy=new PrivateFilePolicy();policy.replace=async()=>{throw Error("simulated storage failure")};
  const store=new FileTransactionIntentStore({filePath,filePolicy:policy});await assert.rejects(store.retainSignedPayment(f.record,f.input.policy,()=>{}),error=>error.data?.code==="TRANSACTION_JOURNAL_WRITE_FAILED");
  await assert.rejects(readFile(filePath),error=>error.code==="ENOENT");
});

import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,stat} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {canonicalJSON,createSignedNativeTransfer,createSignedPayPaymentResult,evmAddressFromYNX} from "@ynx-chain/wallet-auth";
import {FileTransactionIntentStore} from "../src/transaction-intent-store.mjs";
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

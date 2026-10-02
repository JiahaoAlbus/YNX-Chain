import test from "node:test";
import assert from "node:assert/strict";
import {createSignedNativeTransfer,walletIdentity,ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import type {SecureStorageAdapter} from "../storage/walletRepository";
import {NativeTransferOutbox,NATIVE_OUTBOX_PREFIX} from "../chain/nativeTransferOutbox";
import {NativeChainClient} from "../chain/nativeTransfer";
import {NATIVE_DURABILITY_MODEL,createNativeDurabilityEvidence} from "../chain/nativeDurability";
import {WalletPayInvoiceClient,parseWalletPayInvoice} from "../chain/walletPayInvoice";
import {WalletPayFlow} from "./walletPayFlow";

const seed="01".repeat(32),account=walletIdentity(seed).account,to=ynxAddressFromEVM("0x"+"2".repeat(40));
const invoice=parseWalletPayInvoice({id:"invoice-001",intentId:"intent-001",merchant:"Original merchant",payoutAddress:to,amount:25,currency:"YNXT",status:"issued",createdAt:"2026-10-02T12:00:00Z",dueAt:"2026-10-03T12:00:00Z"},"invoice-001");
const signed=createSignedNativeTransfer({accountSecret:seed,to,amount:25,nonce:2});
const guard=()=>{},at=()=>Date.parse("2026-10-02T13:00:00Z");
class Memory implements SecureStorageAdapter {
  values=new Map<string,string>();
  async getItem(key:string){return this.values.get(key)??null}
  async setItem(key:string,value:string){this.values.set(key,value)}
  async deleteItem(key:string){this.values.delete(key)}
}
function setup(storage=new Memory(),fresh=invoice){
  let broadcasts=0;
  const chain=new NativeChainClient("https://rpc-testnet.ynxweb4.com",async(url,options)=>{
    if(url.endsWith("/evm")){const {id,method}=JSON.parse(String(options?.body));return new Response(JSON.stringify({jsonrpc:"2.0",id,result:method==="eth_chainId"?"0x1917":NATIVE_DURABILITY_MODEL}))}
    broadcasts++;throw new Error("lost acknowledgement");
  });
  const outbox=new NativeTransferOutbox(storage),pay=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>new Response(JSON.stringify(fresh)));
  return {storage,chain,outbox,pay,flow:new WalletPayFlow(storage,outbox,pay,at),broadcasts:()=>broadcasts};
}
test("Pay prepares under the original native outbox; lost ACK preserves exact invoice/hash across restart",async()=>{
  const f=setup();let signs=0;
  const result=await f.flow.payReviewed(invoice,account,f.chain,guard,async()=>{signs++;return signed});
  assert.equal(result.phase,"unknown");assert.equal(result.hash,signed.hash);assert.equal(f.broadcasts(),1);
  const restarted=new WalletPayFlow(f.storage,new NativeTransferOutbox(f.storage),f.pay,at),binding=await restarted.read(account);
  assert.equal(binding?.hash,signed.hash);assert.equal(binding?.invoice.id,invoice.id);
  await assert.rejects(()=>restarted.payReviewed(invoice,account,f.chain,guard,async()=>{signs++;return signed}),/PAY_ORIGINAL_PAYMENT_REQUIRES_REVIEW/);
  assert.equal(signs,1);assert.equal(f.broadcasts(),1);
  let settlements=0;await assert.rejects(()=>restarted.settleOriginal(account,guard,async()=>{settlements++;return {status:"paid"}}),/PAY_TRANSFER_NOT_DURABLE/);assert.equal(settlements,0);
});
test("changed invoice and misbound signing output never send a transfer",async()=>{
  const changed=setup(new Memory(),parseWalletPayInvoice({...invoice,amount:26},invoice.id));let signs=0;
  await assert.rejects(()=>changed.flow.payReviewed(invoice,account,changed.chain,guard,async()=>{signs++;return signed}),/PAY_INVOICE_CHANGED_REVIEW_AGAIN/);
  assert.equal(signs,0);assert.equal(changed.broadcasts(),0);
  const f=setup(),wrong=createSignedNativeTransfer({accountSecret:seed,to,amount:26,nonce:2});
  await assert.rejects(()=>f.flow.payReviewed(invoice,account,f.chain,guard,async()=>wrong),/PAY_SIGNED_TRANSFER_REVIEW_MISMATCH/);
  assert.equal(f.broadcasts(),0);assert.equal(await f.flow.read(account),null);
});
test("lock while authorizing/signing prevents journal publication and dispatch",async()=>{
  const f=setup();let current=true;
  await assert.rejects(()=>f.flow.payReviewed(invoice,account,f.chain,()=>{if(!current)throw new Error("locked")},async()=>{current=false;return signed}),/locked/);
  assert.equal(f.broadcasts(),0);assert.equal(await f.flow.read(account),null);
});
test("Pay binding storage readback failure prevents broadcast and cannot erase native history",async()=>{
  const storage=new Memory(),set=storage.setItem.bind(storage);
  storage.setItem=async(key,value)=>{if(key.startsWith("ynx.wallet.pay-binding"))return;await set(key,value)};
  const f=setup(storage);
  await assert.rejects(()=>f.flow.payReviewed(invoice,account,f.chain,guard,async()=>signed),/PAY_BINDING_STORAGE_UNAVAILABLE/);
  assert.equal(f.broadcasts(),0);assert.equal(await f.outbox.read(account),null);
});
async function durableFixture(f:ReturnType<typeof setup>){
  await f.flow.payReviewed(invoice,account,f.chain,guard,async()=>signed);
  const original=(await f.outbox.read(account))!,blockHash="0x"+"a".repeat(64);
  // Local protocol fixture passed through the production proof validator;
  // not a live-chain receipt or a mocked 'accepted' flag without evidence.
  const receipt={transactionHash:signed.hash,from:signed.transaction.from,to:signed.transaction.to,status:"0x1",contractAddress:null,
    transactionIndex:"0x0",blockNumber:"0x2",blockHash,
    ynxNativeTransaction:{type:"transfer",amountYNXT:"25",feeYNXT:"1",nonce:"0x2"},
    ynxDurability:{version:NATIVE_DURABILITY_MODEL.version,scope:"local-snapshot",status:"durable",transactionHash:signed.hash,
      blockNumber:"0x2",blockHash,checkpointBlockNumber:"0x2",checkpointBlockHash:blockHash,snapshotIntegrity:"0x"+"b".repeat(64)}};
  const evidence=createNativeDurabilityEvidence(f.chain.origin,NATIVE_DURABILITY_MODEL,receipt,signed.transaction,signed.hash);
  await f.storage.setItem(NATIVE_OUTBOX_PREFIX+account,JSON.stringify({...original,phase:"accepted",durabilityEvidence:evidence}));
}
const settlement={id:"settlement-001",intentId:invoice.intentId,invoiceId:invoice.id,merchant:invoice.merchant,payoutAddress:invoice.payoutAddress,
  payer:account,amount:25,currency:"YNXT",transactionHash:signed.hash,blockNumber:3,status:"paid",auditHash:"c".repeat(64),createdAt:"2026-10-02T13:01:00Z"};
test("bound durable settlement is archived before permitting the next payment and survives restart",async()=>{
  const f=setup();await durableFixture(f);
  await f.flow.settleOriginal(account,guard,async()=>settlement);
  const receipt=await f.flow.acknowledgeSettled(account,signed.hash,guard);
  assert.equal(receipt.binding.settlement?.blockNumber,3,"settlement height need not equal payment height");
  assert.equal(await f.flow.read(account),null);assert.equal((await f.outbox.read(account))?.phase,"done");
  const restarted=new WalletPayFlow(f.storage,new NativeTransferOutbox(f.storage),f.pay,at);
  assert.equal((await restarted.receipt(account,signed.hash))?.binding.invoice.id,invoice.id);
  let signs=0;
  await assert.rejects(()=>restarted.payReviewed(invoice,account,f.chain,guard,async()=>{signs++;return signed}),/PAY_INVOICE_ALREADY_PAID/);
  assert.equal(signs,0);assert.equal(f.broadcasts(),1);
  const next=parseWalletPayInvoice({...invoice,id:"invoice-002",intentId:"intent-002"},"invoice-002");
  const nextPay=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>new Response(JSON.stringify(next)));
  const nextFlow=new WalletPayFlow(f.storage,f.outbox,nextPay,at);
  await nextFlow.payReviewed(next,account,f.chain,guard,async()=>{signs++;return createSignedNativeTransfer({accountSecret:seed,to,amount:25,nonce:3})});
  assert.equal(signs,1);assert.equal(f.broadcasts(),2);
  assert.equal((await restarted.receipt(account,signed.hash))?.binding.settlement?.id,settlement.id);
});
test("lost settlement acknowledgement retains original idempotency key and cannot release payment",async()=>{
  const f=setup();await durableFixture(f);const keys:string[]=[];
  await assert.rejects(()=>f.flow.settleOriginal(account,guard,async b=>{keys.push(b.idempotencyKey);throw new Error("private transport response")}),/PAY_SETTLEMENT_RESULT_UNKNOWN/);
  assert.equal((await f.flow.read(account))?.phase,"settlement_unknown");
  await assert.rejects(()=>f.flow.acknowledgeSettled(account,signed.hash,guard),/PAY_SETTLED_REVIEW_REQUIRED/);
  await f.flow.settleOriginal(account,guard,async b=>{keys.push(b.idempotencyKey);return settlement});
  assert.equal(keys[0],keys[1]);assert.equal(f.broadcasts(),1);
});
test("archive readback failure leaves bound settlement and native outbox unreleased",async()=>{
  const f=setup();await durableFixture(f);await f.flow.settleOriginal(account,guard,async()=>settlement);
  const set=f.storage.setItem.bind(f.storage);
  f.storage.setItem=async(k,v)=>{if(k.startsWith("ynx.wallet.pay-receipt"))return;await set(k,v)};
  await assert.rejects(()=>f.flow.acknowledgeSettled(account,signed.hash,guard),/PAY_RECEIPT_STORAGE_UNAVAILABLE/);
  assert.equal((await f.flow.read(account))?.phase,"settled");assert.equal((await f.outbox.read(account))?.phase,"accepted");
});
test("crash after native acknowledgement is recoverable without overwriting archived receipt",async()=>{
  const f=setup();await durableFixture(f);await f.flow.settleOriginal(account,guard,async()=>settlement);
  const remove=f.storage.deleteItem.bind(f.storage);
  f.storage.deleteItem=async()=>{throw new Error("crash")};
  await assert.rejects(()=>f.flow.acknowledgeSettled(account,signed.hash,guard),/PAY_BINDING_STORAGE_UNAVAILABLE/);
  assert.equal((await f.outbox.read(account))?.phase,"done");
  const key="ynx.wallet.pay-receipt.v1."+account+"."+signed.hash,before=await f.storage.getItem(key);
  f.storage.deleteItem=remove;
  await f.flow.acknowledgeSettled(account,signed.hash,guard);
  assert.equal(await f.storage.getItem(key),before);assert.equal(await f.flow.read(account),null);
  const tampered=JSON.parse(before!);tampered.transfer.durabilityEvidence.receipt.ynxNativeTransaction.amountYNXT="26";
  await f.storage.setItem(key,JSON.stringify(tampered));
  await assert.rejects(()=>f.flow.receipt(account,signed.hash),/PAY_RECEIPT_STORAGE_UNAVAILABLE/);
});
test("failure of the paid-invoice marker cannot release either original payment journal",async()=>{
  const f=setup();await durableFixture(f);await f.flow.settleOriginal(account,guard,async()=>settlement);
  const set=f.storage.setItem.bind(f.storage);
  f.storage.setItem=async(k,v)=>{if(k.startsWith("ynx.wallet.pay-invoice-paid"))return;await set(k,v)};
  await assert.rejects(()=>f.flow.acknowledgeSettled(account,signed.hash,guard),/PAY_RECEIPT_STORAGE_UNAVAILABLE/);
  assert.equal((await f.flow.read(account))?.phase,"settled");assert.equal((await f.outbox.read(account))?.phase,"accepted");
  f.storage.setItem=set;await f.flow.acknowledgeSettled(account,signed.hash,guard);
  assert.equal(await f.flow.read(account),null);
});
test("a second invoice cannot reuse a native hash archived for the first invoice",async()=>{
  const f=setup();await durableFixture(f);await f.flow.settleOriginal(account,guard,async()=>settlement);
  await f.flow.acknowledgeSettled(account,signed.hash,guard);
  const next=parseWalletPayInvoice({...invoice,id:"invoice-002",intentId:"intent-002"},"invoice-002");
  const pay=new WalletPayInvoiceClient("https://api.ynxweb4.com",async()=>new Response(JSON.stringify(next)));
  const flow=new WalletPayFlow(f.storage,f.outbox,pay,at);
  await assert.rejects(()=>flow.payReviewed(next,account,f.chain,guard,async()=>signed),/PAY_SIGNED_TRANSFER_ALREADY_USED/);
  assert.equal(await flow.read(account),null);assert.equal((await f.outbox.read(account))?.phase,"done");assert.equal(f.broadcasts(),1);
});

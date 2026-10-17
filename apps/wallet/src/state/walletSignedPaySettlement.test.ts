import {test} from "node:test";
import assert from "node:assert/strict";
import {walletIdentity} from "@ynx-chain/wallet-auth";
import {signedPayFixture} from "../security/signedPayTestFixture";
import {NativeChainClient} from "../chain/nativeTransfer";
import {NativeTransferOutbox,NATIVE_OUTBOX_PREFIX} from "../chain/nativeTransferOutbox";
import {NATIVE_DURABILITY_MODEL,createNativeDurabilityEvidence} from "../chain/nativeDurability";
import {WalletPayInvoiceClient,parseWalletPayInvoice} from "../chain/walletPayInvoice";
import {WalletPayFlow} from "./walletPayFlow";
import {WalletSignedPayFlow,type WalletSignedSettlementTransport} from "./walletSignedPayFlow";
import {SIGNED_PAY_BINDING_PREFIX} from "./walletSignedPayRecord";
import {SIGNED_PAY_SETTLEMENT_PREFIX,SIGNED_PAY_RECEIPT_PREFIX,SIGNED_PAY_PAID_INVOICE_PREFIX,SIGNED_PAY_HISTORY_HEAD_PREFIX,parseSignedPaySettlementResponse,signedPayIdempotencyKey} from "./walletSignedPaySettlement";
function fixture(){
  const f=signedPayFixture(),values=new Map<string,string>(),account=f.input.review.account,policy=f.input.policy;
  const storage={values,getItem:async(key:string)=>values.get(key)??null,setItem:async(key:string,value:string)=>{values.set(key,value)},deleteItem:async(key:string)=>{values.delete(key)}};
  let broadcasts=0,submits=0,reads=0;
  const chain=new NativeChainClient("https://rpc-testnet.ynxweb4.com");chain.account=f.client.account;chain.requireDurabilityCapability=f.client.requireDurabilityCapability;
  chain.broadcast=async()=>{broadcasts++;throw Error("controlled lost ACK")};
  const outbox=new NativeTransferOutbox(storage,()=>new Date(f.input.now())),legacy=new WalletPayFlow(storage,outbox,new WalletPayInvoiceClient(),f.input.now);
  const flow=new WalletSignedPayFlow(storage,outbox,legacy,f.input.now);
  let response:any;
  const transport:WalletSignedSettlementTransport={authority:f.authority,submitOriginal:async(record,key,guard)=>{guard();submits++;assert.equal(key,signedPayIdempotencyKey(record));assert.equal(record.transfer.hash,response.settlement.transactionHash);return response},readOriginal:async(record,guard)=>{guard();reads++;assert.equal(record.transfer.hash,response.settlement.transactionHash);return response}};
  const durable=async()=>{
    const original=(await outbox.read(account))!,tx=original.transaction,blockHash="0x"+"a".repeat(64);
    // Controlled protocol fixture through the real proof validator; not a live
    // chain receipt, server session or production business settlement.
    const receipt={transactionHash:original.hash,from:tx.from,to:tx.to,status:"0x1",contractAddress:null,transactionIndex:"0x0",blockNumber:"0x2",blockHash,
      ynxNativeTransaction:{type:"transfer",amountYNXT:String(tx.amount),feeYNXT:"1",nonce:"0x"+tx.nonce.toString(16)},
      ynxDurability:{version:NATIVE_DURABILITY_MODEL.version,scope:"local-snapshot",status:"durable",transactionHash:original.hash,blockNumber:"0x2",blockHash,checkpointBlockNumber:"0x2",checkpointBlockHash:blockHash,snapshotIntegrity:"0x"+"b".repeat(64)}};
    const evidence=createNativeDurabilityEvidence(chain.origin,NATIVE_DURABILITY_MODEL,receipt,tx,original.hash);
    await storage.setItem(NATIVE_OUTBOX_PREFIX+account,JSON.stringify({...original,phase:"accepted",durabilityEvidence:evidence}));
  };
  const prepare=async()=>{
    await flow.payReviewed({...f.input,chain});await durable();
    const record=(await flow.read(account,policy,()=>{}))!;
    response={...record.invoice,status:"committed",settlement:{id:"settlement-001",chainId:"ynx_6423-1",transactionHash:record.transfer.hash,blockNumber:3,finality:"committed",payer:account,payee:record.invoice.payoutAddress,payoutAddress:record.invoice.payoutAddress,amount:25,asset:"YNXT",invoiceId:record.invoice.id,centralInvoiceId:record.invoice.centralInvoiceId,intentId:record.invoice.intentId,intentDigest:record.paymentResult.intentDigest,requestNonce:record.intent.requestId,idempotencyKey:signedPayIdempotencyKey(record),receiptId:"settlement-001",status:"committed",auditHash:"c".repeat(64),auditId:"aud_"+"d".repeat(20),committedAt:"2026-10-03T01:00:20Z",source:"authoritative-central-pay-api",sourceAsOf:"2026-10-03T01:00:20Z",sourceVersion:1,confidence:"authoritative"}};
    return record;
  };
  return{...f,storage,values,account,policy,chain,outbox,legacy,flow,transport,prepare,durable,response:()=>response,setResponse:(value:any)=>{response=value},counts:()=>({broadcasts,submits,reads})};
}
test("explicit signed settlement binds original wire; immutable receipt is saved before journal release and survives restart",async()=>{
  const f=fixture();try{
    const record=await f.prepare();assert.equal((await f.flow.recovery(f.account,f.policy,()=>{}))?.state,"settlement_pending");
    const state=await f.flow.settleOriginal(f.account,f.policy,()=>{},f.transport);assert.equal(state.phase,"verified");assert.equal(state.settlement?.blockNumber,3,"settlement and transfer ledger heights need not be equal");
    assert.deepEqual((await f.flow.recovery(f.account,f.policy,()=>{}))?.actions,["done"]);
    const receipt=await f.flow.acknowledgeSettled(f.account,record.transfer.hash,f.policy,()=>{});assert.equal(receipt.consensusFinality,false);
    assert.equal(await f.flow.read(f.account,f.policy,()=>{}),null);assert.equal((await f.outbox.read(f.account))?.phase,"done");
    const restarted=new WalletSignedPayFlow(f.storage,new NativeTransferOutbox(f.storage),f.legacy,f.input.now);
    assert.equal((await restarted.history(f.account,f.policy,()=>{})).receipts[0]?.settlement.intentDigest,record.paymentResult.intentDigest);
    await assert.rejects(restarted.payReviewed({...f.input,chain:f.chain}),/INVOICE_ALREADY_PAID/);
    assert.deepEqual(f.counts(),{broadcasts:1,submits:1,reads:0});
    const old=parseWalletPayInvoice({id:record.invoice.id,intentId:record.invoice.intentId,merchant:record.invoice.merchantName,payoutAddress:record.invoice.payoutAddress,amount:25,currency:"YNXT",status:"issued",createdAt:record.invoice.createdAt,dueAt:record.invoice.expiresAt},record.invoice.id);
    let signs=0;await assert.rejects(f.legacy.payReviewed(old,f.account,f.chain,()=>{},async()=>{signs++;throw Error("must not sign")}),/INVOICE_ALREADY_PAID/);assert.equal(signs,0);
  }finally{f.lease.finish()}
});
test("lost settlement response stores original unknown and stable idempotency before effect, never broadcasts again",async()=>{
  const f=fixture();try{
    const record=await f.prepare(),keys:string[]=[];
    const submit=f.transport.submitOriginal;
    const failed={...f.transport,submitOriginal:async(_record:any,key:string)=>{keys.push(key);const raw=f.values.get(SIGNED_PAY_SETTLEMENT_PREFIX+f.account)!;assert.equal(JSON.parse(raw).phase,"unknown");throw Error("lost signed settlement ACK")}};
    await assert.rejects(f.flow.settleOriginal(f.account,f.policy,()=>{},failed),/RESULT_UNKNOWN/);
    assert.equal((await f.flow.recovery(f.account,f.policy,()=>{}))?.state,"settlement_unknown");
    await assert.rejects(f.flow.acknowledgeSettled(f.account,record.transfer.hash,f.policy,()=>{}),/SETTLED_REVIEW_REQUIRED/);
    await f.flow.settleOriginal(f.account,f.policy,()=>{},{...f.transport,submitOriginal:async(r,key,guard)=>{keys.push(key);return submit(r,key,guard)}});
    assert.equal(keys[0],keys[1]);assert.equal(f.counts().broadcasts,1);
  }finally{f.lease.finish()}
});
test("wrong intent, actor, invoice, nonce, receipt, fee proof or substituted server evidence cannot release journals",async()=>{
  const f=fixture();try{
    const record=await f.prepare(),original=(await f.outbox.read(f.account))!,response=f.response();
    const changes=[{intentDigest:"e".repeat(64)},{requestNonce:"x".repeat(32)},{payer:walletIdentity("02".repeat(32)).account},{amount:26},{invoiceId:"inv_"+"e".repeat(20)},{centralInvoiceId:"other-central"},{intentId:"other-intent"},{transactionHash:"0x"+"e".repeat(64)},{payee:walletIdentity("02".repeat(32)).account},{idempotencyKey:"other-key"},{receiptId:"other-receipt"},{blockNumber:Number.MAX_SAFE_INTEGER+1},{auditHash:"z".repeat(64)},{source:"public-qr"},{confidence:"unverified"},{sourceAsOf:"2026-10-03T01:00:21Z"}];
    for(const change of changes)assert.throws(()=>parseSignedPaySettlementResponse({...response,settlement:{...response.settlement,...change}},record,original,f.policy,()=>{}));
    assert.throws(()=>parseSignedPaySettlementResponse({...response,status:"paid"},record,original,f.policy,()=>{}));
    assert.throws(()=>parseSignedPaySettlementResponse({...response,merchantName:"substituted merchant"},record,original,f.policy,()=>{}));
    f.setResponse({...response,settlement:{...response.settlement,requestNonce:"x".repeat(32)}});
    await assert.rejects(f.flow.settleOriginal(f.account,f.policy,()=>{},f.transport),/BINDING_MISMATCH/);
    assert.equal((await f.flow.recovery(f.account,f.policy,()=>{}))?.state,"settlement_unknown");assert.equal((await f.outbox.read(f.account))?.phase,"accepted");
  }finally{f.lease.finish()}
});
test("expiry or wrong current session blocks submission, but a fresh same-account session may observe original receipt without rebinding",async()=>{
  const f=fixture();try{
    const record=await f.prepare();f.setNow(f.input.now()+600_000);
    await assert.rejects(f.flow.settleOriginal(f.account,f.policy,()=>{},f.transport),/EXPIRED/);assert.equal(f.counts().submits,0);
    const now=f.input.now();f.authority.session=f.parsedSession({sessionBinding:"e".repeat(64),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+180_000).toISOString()});
    const before=f.values.get(SIGNED_PAY_BINDING_PREFIX+f.account);
    await f.flow.readOriginalReceipt(f.account,f.policy,()=>{},f.transport);
    assert.equal(f.values.get(SIGNED_PAY_BINDING_PREFIX+f.account),before);assert.equal((await f.flow.read(f.account,f.policy,()=>{}))?.intent.sessionBinding,record.intent.sessionBinding);
    assert.deepEqual(f.counts(),{broadcasts:1,submits:0,reads:1});
  }finally{f.lease.finish()}
});
test("lock during late authenticated settlement response preserves real bound evidence and suppresses UI return",async()=>{
  const f=fixture();try{
    await f.prepare();let current=true;const submit=f.transport.submitOriginal;
    const transport={...f.transport,submitOriginal:async(record:any,key:string,guard:()=>void)=>{const response=await submit(record,key,guard);current=false;return response}};
    await assert.rejects(f.flow.settleOriginal(f.account,f.policy,()=>{if(!current)throw Error("locked")},transport),/locked/);
    assert.equal(JSON.parse(f.values.get(SIGNED_PAY_SETTLEMENT_PREFIX+f.account)!).phase,"verified");
    assert.equal((await f.flow.recovery(f.account,f.policy,()=>{}))?.state,"settled");assert.equal(f.counts().broadcasts,1);
  }finally{f.lease.finish()}
});
for(const prefix of [SIGNED_PAY_RECEIPT_PREFIX,SIGNED_PAY_PAID_INVOICE_PREFIX,SIGNED_PAY_HISTORY_HEAD_PREFIX])test(`failed ${prefix} readback cannot release original journals`,async()=>{
  const f=fixture();try{
    const record=await f.prepare();await f.flow.settleOriginal(f.account,f.policy,()=>{},f.transport);
    const set=f.storage.setItem;f.storage.setItem=async(key,value)=>{if(key.startsWith(prefix))return;await set(key,value)};
    await assert.rejects(f.flow.acknowledgeSettled(f.account,record.transfer.hash,f.policy,()=>{}),/RECEIPT_STORAGE_UNAVAILABLE/);
    assert.ok(await f.flow.read(f.account,f.policy,()=>{}));assert.equal((await f.outbox.read(f.account))?.phase,"accepted");
  }finally{f.lease.finish()}
});
test("crash after native Done and transient settlement deletion resumes from immutable receipt without overwrite",async()=>{
  const f=fixture();try{
    const record=await f.prepare();await f.flow.settleOriginal(f.account,f.policy,()=>{},f.transport);
    const remove=f.storage.deleteItem;f.storage.deleteItem=async key=>{if(key.startsWith(SIGNED_PAY_BINDING_PREFIX))throw Error("process died after state cleanup");await remove(key)};
    await assert.rejects(f.flow.acknowledgeSettled(f.account,record.transfer.hash,f.policy,()=>{}),/RECORD_UNAVAILABLE/);
    assert.equal((await f.outbox.read(f.account))?.phase,"done");assert.equal(f.values.has(SIGNED_PAY_SETTLEMENT_PREFIX+f.account),false);
    const receipt=f.values.get(SIGNED_PAY_RECEIPT_PREFIX+f.account+"."+record.transfer.hash);
    assert.equal((await f.flow.recovery(f.account,f.policy,()=>{}))?.state,"settled");
    f.storage.deleteItem=remove;await f.flow.acknowledgeSettled(f.account,record.transfer.hash,f.policy,()=>{});
    assert.equal(f.values.get(SIGNED_PAY_RECEIPT_PREFIX+f.account+"."+record.transfer.hash),receipt);assert.equal(await f.flow.read(f.account,f.policy,()=>{}),null);
    assert.equal((await f.flow.history(f.account,f.policy,()=>{})).receipts.length,1);
  }finally{f.lease.finish()}
});

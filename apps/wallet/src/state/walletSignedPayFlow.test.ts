import {test} from "node:test";
import assert from "node:assert/strict";
import {canonicalJSON,createSignedNativeTransfer,walletIdentity} from "@ynx-chain/wallet-auth";
import {signedPayFixture} from "../security/signedPayTestFixture";
import {NativeChainClient} from "../chain/nativeTransfer";
import {NativeTransferOutbox,NATIVE_OUTBOX_PREFIX} from "../chain/nativeTransferOutbox";
import {WalletPayInvoiceClient,parseWalletPayInvoice} from "../chain/walletPayInvoice";
import {WalletPayFlow} from "./walletPayFlow";
import {WalletSignedPayFlow} from "./walletSignedPayFlow";
import {SIGNED_PAY_BINDING_PREFIX,parseWalletSignedPayRecord} from "./walletSignedPayRecord";
import type {SecureStorageAdapter} from "../storage/walletRepository";
class Memory implements SecureStorageAdapter{
  values=new Map<string,string>();
  async getItem(key:string){return this.values.get(key)??null}
  async setItem(key:string,value:string){this.values.set(key,value)}
  async deleteItem(key:string){this.values.delete(key)}
}
function fixture(){
  const f=signedPayFixture(),storage=new Memory(),account=f.input.review.account,policy=f.input.policy;
  let broadcasts=0;
  const chain=new NativeChainClient("https://rpc-testnet.ynxweb4.com");
  chain.account=f.client.account;chain.requireDurabilityCapability=f.client.requireDurabilityCapability;
  chain.broadcast=async()=>{broadcasts++;throw Error("controlled lost ACK")};
  const outbox=new NativeTransferOutbox(storage,()=>new Date(f.input.now())),pay=new WalletPayInvoiceClient();
  const legacy=new WalletPayFlow(storage,outbox,pay,f.input.now),flow=new WalletSignedPayFlow(storage,outbox,legacy);
  const input={...f.input,chain};
  return{...f,storage,account,policy,chain,outbox,legacy,flow,input,broadcasts:()=>broadcasts};
}
test("signed Pay retains original invoice/intent/result before native dispatch; lost ACK recovers without signing again",async()=>{
  const f=fixture();try{
    const result=await f.flow.payReviewed(f.input);assert.equal(result.phase,"unknown");assert.equal(f.broadcasts(),1);
    const record=(await f.flow.read(f.account,f.policy,()=>{}))!;
    assert.equal(record.transfer.hash,result.hash);assert.equal(record.paymentResult.transactionHash,result.hash);
    assert.equal(record.paymentResult.intentDigest,f.input.reviewedIntentDigest);assert.equal(record.intent.invoiceSignature,record.invoice.signature);
    assert.equal(f.counts().reads,1);assert.equal(await f.legacy.hasRetainedPayment(f.account),true);
    const prior=new Map(f.storage.values),restarted=new WalletSignedPayFlow(f.storage,new NativeTransferOutbox(f.storage),f.legacy);
    const recovery=(await restarted.recovery(f.account,f.policy,()=>{}))!;
    assert.equal(recovery.state,"transfer_unconfirmed");assert.deepEqual(recovery.actions,["check"]);
    assert.equal(recovery.paymentAuthorized,false);assert.equal(recovery.settlementVerified,false);assert.deepEqual(f.storage.values,prior);
    f.setNow(f.input.now()+600_000);
    assert.equal((await restarted.recovery(f.account,f.policy,()=>{}))?.record.transfer.hash,result.hash,"expired session/quote never erases original records");
    assert.equal(await restarted.read(walletIdentity("02".repeat(32)).account,f.policy,()=>{}),null);
  }finally{f.lease.finish()}
});
test("missing authority and identity-only scope cannot reach signing, storage publication or POST",async()=>{
  for(const identityOnly of [false,true]){
    const f=fixture();try{
      if(identityOnly)f.authority.session=f.parsedSession({scopes:["account:read"]});
      await assert.rejects(f.flow.payReviewed({...f.input,authority:identityOnly?f.authority:null}));
      assert.equal(f.broadcasts(),0);assert.equal(f.counts().reads,0);assert.equal(f.storage.values.size,0);
    }finally{f.lease.finish()}
  }
});
test("signed record readback failure never dispatches and preserves attempted public evidence",async()=>{
  const f=fixture();try{
    const get=f.storage.getItem.bind(f.storage);let written=false;
    f.storage.setItem=async(key,value)=>{f.storage.values.set(key,value);if(key.startsWith(SIGNED_PAY_BINDING_PREFIX))written=true};
    f.storage.getItem=async key=>written&&key.startsWith(SIGNED_PAY_BINDING_PREFIX)?null:get(key);
    await assert.rejects(f.flow.payReviewed(f.input),/RECORD_UNAVAILABLE/);
    assert.equal(f.broadcasts(),0);assert.equal(await f.outbox.read(f.account),null);
    assert.ok(f.storage.values.has(SIGNED_PAY_BINDING_PREFIX+f.account));
  }finally{f.lease.finish()}
});
for(const boundary of ["revoke","quote-expiry","session-change","lock"]){
  test(`final native dispatch ${boundary} fence preserves original bytes and performs no POST`,async()=>{
    const f=fixture();try{
      const set=f.storage.setItem.bind(f.storage);f.storage.setItem=async(key,raw)=>{
        await set(key,raw);
        if(key.startsWith(NATIVE_OUTBOX_PREFIX)&&JSON.parse(raw).phase==="unknown"){
          if(boundary==="revoke")f.revoke();if(boundary==="quote-expiry")f.setNow(f.input.now()+60_000);
          if(boundary==="session-change")f.authority.session=f.parsedSession({deviceId:"other-device"});if(boundary==="lock")f.operations.lock();
        }
      };
      await assert.rejects(f.flow.payReviewed(f.input));assert.equal(f.broadcasts(),0);
      const original=await f.outbox.read(f.account),record=await f.flow.read(f.account,f.policy,()=>{});
      assert.equal(original?.phase,"unknown");assert.equal(original?.payload,record?.transfer.payload);assert.equal(original?.hash,record?.paymentResult.transactionHash);
    }finally{f.lease.finish()}
  });
}
test("authority refresh after unknown marker is required before POST, and its failure does not clear originals",async()=>{
  const f=fixture();try{
    const refresh=f.authority.refresh;f.authority.refresh=async()=>{
      const raw=f.storage.values.get(NATIVE_OUTBOX_PREFIX+f.account);
      if(raw&&JSON.parse(raw).phase==="unknown")throw Error("canonical authority unavailable");return refresh();
    };
    await assert.rejects(f.flow.payReviewed(f.input),/authority unavailable/);assert.equal(f.broadcasts(),0);
    assert.equal((await f.outbox.read(f.account))?.phase,"unknown");assert.ok(await f.flow.read(f.account,f.policy,()=>{}));
  }finally{f.lease.finish()}
});
test("revocation during final signed-record readback suppresses POST but retains both journals",async()=>{
  const f=fixture();try{
    const get=f.storage.getItem.bind(f.storage);f.storage.getItem=async key=>{
      const value=await get(key),native=f.storage.values.get(NATIVE_OUTBOX_PREFIX+f.account);
      if(key.startsWith(SIGNED_PAY_BINDING_PREFIX)&&native&&JSON.parse(native).phase==="unknown")f.revoke();return value;
    };
    await assert.rejects(f.flow.payReviewed(f.input),/revoked/);assert.equal(f.broadcasts(),0);
    assert.equal((await f.outbox.read(f.account))?.phase,"unknown");assert.ok(f.storage.values.has(SIGNED_PAY_BINDING_PREFIX+f.account));
  }finally{f.lease.finish()}
});
test("existing native journal with different bytes is never overwritten by signed-record recovery",async()=>{
  const f=fixture();try{
    await f.flow.payReviewed(f.input);const key=NATIVE_OUTBOX_PREFIX+f.account,original=JSON.parse(f.storage.values.get(key)!);
    const other=createSignedNativeTransfer({accountSecret:"01".repeat(32),to:f.input.review.to,amount:26,nonce:3});
    // Native v1 retains its original serializer/order; do not use the signed
    // Pay record's canonical JSON encoder to rewrite that legacy wire.
    const changed=JSON.stringify({...original,...other});await f.storage.setItem(key,changed);
    await assert.rejects(f.flow.checkOriginal(f.account,f.policy,f.chain,()=>{}),/ORIGINAL_MISMATCH/);
    await assert.rejects(f.flow.recovery(f.account,f.policy,()=>{}),/ORIGINAL_MISMATCH/);
    assert.equal(f.storage.values.get(key),changed);assert.equal(f.broadcasts(),1);
  }finally{f.lease.finish()}
});
test("original record cannot reopen same invoice or be replaced by a legacy Pay request",async()=>{
  const f=fixture();try{
    await f.flow.payReviewed(f.input);const original=new Map(f.storage.values);
    await assert.rejects(f.flow.payReviewed(f.input),/ORIGINAL_REQUIRES_REVIEW/);
    const invoice=parseWalletPayInvoice({id:"legacy-invoice",intentId:"legacy-intent",merchant:"Legacy merchant",payoutAddress:f.input.review.to,amount:25,currency:"YNXT",status:"issued",createdAt:"2026-10-03T00:00:00Z",dueAt:"2026-10-03T02:00:00Z"},"legacy-invoice");
    let signed=0;await assert.rejects(f.legacy.payReviewed(invoice,f.account,f.chain,()=>{},async()=>{signed++;return createSignedNativeTransfer({accountSecret:"01".repeat(32),to:invoice.payoutAddress,amount:25,nonce:3})}),/SIGNED_ORIGINAL_REQUIRES_REVIEW/);
    assert.equal(signed,0);assert.deepEqual(f.storage.values,original);assert.equal(f.broadcasts(),1);
  }finally{f.lease.finish()}
});
test("tampered intent/result/transfer cannot become trusted historical evidence; missing original never permits replacement",async()=>{
  const f=fixture();try{
    await f.flow.payReviewed(f.input);const key=SIGNED_PAY_BINDING_PREFIX+f.account,raw=f.storage.values.get(key)!,record=JSON.parse(raw);
    const changes=[{account:walletIdentity("02".repeat(32)).account},{intent:{...record.intent,amount:26,total:27}},{paymentResult:{...record.paymentResult,walletSignature:"0".repeat(128)}},{transfer:{...record.transfer,hash:"0x"+"e".repeat(64)}}];
    for(const change of changes)assert.throws(()=>parseWalletSignedPayRecord(canonicalJSON({...record,...change}),f.account,f.policy,()=>{}));
    await f.storage.deleteItem(NATIVE_OUTBOX_PREFIX+f.account);
    const recovery=await f.flow.recovery(f.account,f.policy,()=>{});assert.equal(recovery?.state,"original_unavailable");assert.deepEqual(recovery?.actions,["check"]);
    await assert.rejects(f.flow.payReviewed(f.input),/ORIGINAL_REQUIRES_REVIEW/);assert.equal(f.broadcasts(),1);
    assert.equal(f.storage.values.get(key),raw);
  }finally{f.lease.finish()}
});
test("explicit original-hash check repairs a missing native journal conservatively without signing, resending or changing bytes",async()=>{
  const f=fixture();try{
    await f.flow.payReviewed(f.input);const record=(await f.flow.read(f.account,f.policy,()=>{}))!,before=f.counts();
    await f.storage.deleteItem(NATIVE_OUTBOX_PREFIX+f.account);
    let checked=0;f.chain.checkTransferDurability=async(transaction,hash)=>{checked++;assert.equal(hash,record.transfer.hash);assert.deepEqual(transaction,record.transfer.transaction);return {status:"not_found",evidence:null}};
    const result=await f.flow.checkOriginal(f.account,f.policy,f.chain,()=>{});
    assert.equal(result.payload,record.transfer.payload);assert.equal(result.hash,record.transfer.hash);assert.equal(result.phase,"not_found");
    assert.equal(checked,1);assert.deepEqual(f.counts(),before);assert.equal(f.broadcasts(),1);
    assert.equal((await f.flow.recovery(f.account,f.policy,()=>{}))?.state,"transfer_unconfirmed");
    await assert.rejects(f.flow.payReviewed(f.input),/ORIGINAL_REQUIRES_REVIEW/);
  }finally{f.lease.finish()}
});
test("corrupt signed metadata blocks ordinary new/Done/retry gates without discarding legacy data",async()=>{
  const f=fixture();try{
    await f.storage.setItem(SIGNED_PAY_BINDING_PREFIX+f.account,"corrupt-preserved");
    assert.equal(await f.legacy.hasSignedRetainedPayment(f.account),true);assert.equal(await f.legacy.hasRetainedPayment(f.account),true);
    await assert.rejects(f.flow.read(f.account,f.policy,()=>{}),/RECORD_UNAVAILABLE/);
    assert.equal(f.storage.values.get(SIGNED_PAY_BINDING_PREFIX+f.account),"corrupt-preserved");assert.equal(f.broadcasts(),0);
  }finally{f.lease.finish()}
});

import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {evmAddressFromYNX,canonicalJSON,createSignedNativeTransfer,createSignedPayPaymentResult} from "@ynx-chain/wallet-auth";
import {DesktopKeyLifecycle} from "../src/key-lifecycle.mjs";
import {DesktopWalletVault} from "../src/desktop-wallet-vault.mjs";
import {DesktopNativePayChain} from "../src/native-pay-chain.mjs";
import {FileTransactionIntentStore} from "../src/transaction-intent-store.mjs";
import {createProtectedDesktopPayFlow} from "../src/wallet-pay-flow.mjs";
import {desktopPayIdempotencyKey,parseDesktopPaySettlement} from "../src/wallet-pay-settlement.mjs";
import {CANONICAL_RPC_URL} from "../src/rpc.mjs";
import {payTestSecret,signedPayFixture} from "./fixture-signed-pay.mjs";
import {fixtureKeyAuthorization} from "./fixture-key-authorization.mjs";
const literal=JSON.parse(await readFile(new URL("./fixtures/transaction-durability/native-json-contract-fixture.json",import.meta.url),"utf8"));
function r5FullPacket(f){const transfer=createSignedNativeTransfer({accountSecret:payTestSecret,to:f.input.review.to,amount:25,nonce:2});const paymentResult=createSignedPayPaymentResult({accountSecret:payTestSecret,intent:f.input.rawIntent,transferPayload:transfer.payload,issuedAt:new Date(f.input.now()).toISOString()},new Date(f.input.now()));return {version:2,account:f.identity.account,origin:CANONICAL_RPC_URL,invoice:f.input.rawInvoice,intent:f.input.rawIntent,session:f.authority.session,transfer,paymentResult}}
test('r5 actual Pay flow saves complete held original with zero decrypt RPC broadcast or settlement',async()=>{
 const f=await fixture(),record=r5FullPacket(f),account=evmAddressFromYNX(f.identity.account);await f.store.reserveOriginal(account,'pay');f.store.captureOriginal(account,record,'pay');
 const entry=await f.flow.saveOriginal(f.identity.account,record.transfer.hash);assert.equal(canonicalJSON(entry.record),canonicalJSON(record));assert.equal(entry.broadcastAttempted,true);assert.equal(f.decryptions(),0);assert.deepEqual(f.calls,[]);
 const cold=createProtectedDesktopPayFlow({...f.integration,store:new FileTransactionIntentStore({filePath:f.filePath})});assert.equal(canonicalJSON((await cold.restore(f.identity.account)).entry.record),canonicalJSON(record));f.lifecycle.lock();
});
test('r5 actual Pay lifecycle lock after replacement retains same original for later storage-only adoption',async()=>{
 const f=await fixture(),record=r5FullPacket(f),account=evmAddressFromYNX(f.identity.account);await f.store.reserveOriginal(account,'pay');f.store.captureOriginal(account,record,'pay');const replace=f.store.filePolicy.replace.bind(f.store.filePolicy);
 f.store.filePolicy.replace=async(...args)=>{await replace(...args);f.lifecycle.lock()};await assert.rejects(f.flow.saveOriginal(f.identity.account,record.transfer.hash));assert.equal(canonicalJSON(f.store.localOriginal(account).pay),canonicalJSON(record));
 f.store.filePolicy.replace=replace;await f.lifecycle.unlock();await f.flow.saveOriginal(f.identity.account,record.transfer.hash);assert.equal(f.store.localOriginal(account),null);assert.equal(f.decryptions(),0);assert.deepEqual(f.calls,[]);f.lifecycle.lock();
});
async function fixture(version=1){
  const f=signedPayFixture(version),directory=await mkdtemp(join(tmpdir(),"ynx-desktop-pay-flow-")),filePath=join(directory,"journal.json");let decryptions=0;
  const lifecycle=new DesktopKeyLifecycle({now:f.input.now,authorizer:{available:()=>true,authenticate:async()=>{},method:"controlled-test-only"},schedule:()=>null,unschedule:()=>{}});lifecycle.setFocused(true);
  const vault=new DesktopWalletVault({authorization:fixtureKeyAuthorization,filePath:join(directory,"vault.json"),randomSecret:()=>payTestSecret,safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptStringAsync:async bytes=>{decryptions++;return {result:Buffer.from(bytes).reverse().toString()}}}});
  await vault.createAccount();vault.authorization=lifecycle;lifecycle.setAccount(evmAddressFromYNX(f.identity.account));await lifecycle.unlock();
  const store=new FileTransactionIntentStore({filePath}),calls=[],state={broadcast:null,settle:null,read:null,afterClaim:null,nativeStatus:"durable"};
  const client=new DesktopNativePayChain({fetchImpl:async(url,init)=>{
    calls.push({url,init});assert.ok(url.startsWith(CANONICAL_RPC_URL+"/"));
    let value;
    if(url.includes("/accounts/"))value={account:{address:evmAddressFromYNX(f.identity.account),balance:26,nonce:1}};
    else if(url.endsWith("/transactions/broadcast")){
      const retained=await store.signedPayProgress(f.identity.account,f.input.policy,()=>{});assert.equal(retained.broadcastAttempted,true);assert.equal(init.body,retained.record.transfer.payload);
      if(state.broadcast)return state.broadcast(retained.record);
      value={transaction:{hash:retained.record.transfer.hash,...retained.record.transfer.transaction},replayed:false,truthfulStatus:"signature-verified-authoritative-native-transfer"};
    }else{
      const request=JSON.parse(init.body);let receipt=null,proof=null;
      if(["ynx_getTransactionDurability","eth_getTransactionReceipt"].includes(request.method)){
        const retained=await store.signedPayProgress(f.identity.account,f.input.policy,()=>{}),tx=retained.record.transfer.transaction,hash=retained.record.transfer.hash;
        assert.deepEqual(request.params,[hash]);receipt={...literal.durableReceipt,transactionHash:hash,from:tx.from,to:tx.to,ynxDurability:{...literal.durableReceipt.ynxDurability,transactionHash:hash},ynxNativeTransaction:{type:"transfer",amountYNXT:"25",feeYNXT:"1",nonce:"0x2"}};
        proof=state.nativeStatus==="durable"?receipt.ynxDurability:{version:literal.capability.version,scope:"local-snapshot",status:state.nativeStatus,transactionHash:hash};
      }
      value={jsonrpc:"2.0",id:request.id,result:{eth_chainId:"0x1917",ynx_getDurabilityModel:literal.capability,ynx_getTransactionDurability:proof,eth_getTransactionReceipt:receipt}[request.method]};
    }return new Response(JSON.stringify(value));
  }});
  f.authority.verifyOriginalBinding=async()=>{};
  function response(record){const settlement={id:"receipt-controlled",chainId:"ynx_6423-1",transactionHash:record.transfer.hash,blockNumber:99,finality:"committed",payer:record.account,payee:record.invoice.payoutAddress,payoutAddress:record.invoice.payoutAddress,amount:25,asset:"YNXT",invoiceId:record.invoice.id,centralInvoiceId:record.invoice.centralInvoiceId,intentId:record.invoice.intentId,intentDigest:record.paymentResult.intentDigest,requestNonce:record.intent.requestId,idempotencyKey:desktopPayIdempotencyKey(record),receiptId:"receipt-controlled",status:"committed",auditHash:"a".repeat(64),auditId:"aud_"+"b".repeat(20),committedAt:"2026-10-03T01:00:01Z",source:"authoritative-central-pay-api",sourceAsOf:"2026-10-03T01:00:01Z",sourceVersion:1,confidence:"authoritative"};return {...record.invoice,status:"committed",settlement}}
  const transport={submitOriginal:async args=>{calls.push({settlement:true,args});const retained=await store.signedPayProgress(f.identity.account,f.input.policy,()=>{});assert.equal(retained.settlementAttempted,true);assert.deepEqual(args.body,{intent:retained.record.intent,result:retained.record.paymentResult,idempotencyKey:desktopPayIdempotencyKey(retained.record)});if(state.settle)return state.settle(args);return response(args.record)},readOriginal:async args=>{calls.push({read:true,args});if(state.read)return state.read(args);return response(args.record)}};
  const integration={store,lifecycle,vault,client,policy:f.input.policy,authorityForReview:async()=>f.authority,authorityForOriginal:async()=>f.authority,settlementTransport:transport,now:f.input.now};
  const flow=createProtectedDesktopPayFlow(integration);
  return {...f,flow,integration,store,lifecycle,filePath,calls,state,response,decryptions:()=>decryptions,approve:()=>flow.approve(f.input)};
}
test("r4 full Pay before-write publication rejection is restored from original owner without financial actions",async()=>{
 const f=await fixture();f.store.retainSignedPayment=async()=>{throw Object.assign(Error('QA_SAVE_FAILURE'),{cause:Error('QA_DISK_CAUSE')})};
 await assert.rejects(f.approve(),/QA_SAVE_FAILURE/);f.lifecycle.lock();await f.lifecycle.unlock();
 const restored=await f.flow.restore(f.identity.account);assert.ok(restored.entry.record.paymentResult.walletSignature);assert.equal(restored.entry.localRetention.storageCause.message,'QA_DISK_CAUSE');
 await assert.rejects(f.flow.checkOriginal(f.identity.account),/REVIEW_ONLY/);await assert.rejects(f.flow.settleOriginal(f.identity.account),/REVIEW_ONLY/);await assert.rejects(f.flow.done(f.identity.account),/REVIEW_ONLY/);await assert.rejects(f.approve());
 assert.equal(f.decryptions(),1);assert.equal(f.calls.filter(x=>x.url?.endsWith('/transactions/broadcast')).length,0);const cold=new FileTransactionIntentStore({filePath:f.filePath});await assert.rejects(cold.assertNoPreparation(evmAddressFromYNX(f.identity.account)));f.lifecycle.lock();
});
test("r4 native-only Pay output survives key lock and never becomes a complete payment result",async()=>{
 const f=await fixture(),capture=f.store.captureOriginal.bind(f.store);f.store.captureOriginal=(...args)=>{const result=capture(...args);if(args[2]==='native')f.lifecycle.lock();return result};
 await assert.rejects(f.approve());await f.lifecycle.unlock();const restored=await f.flow.restore(f.identity.account);assert.equal(restored.entry.nativeOnly,true);assert.ok(restored.entry.hash);assert.equal('record' in restored.entry,false);assert.equal(await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{}),null);
 assert.equal(f.calls.filter(x=>x.url?.endsWith('/transactions/broadcast')).length,0);await assert.rejects(f.approve());f.lifecycle.lock();
});
for(const boundary of ['persisted-ack','readback'])test(`r4 full Pay publication ${boundary} keeps same complete owner and actual cold record`,async()=>{
 const f=await fixture(),replace=f.store.filePolicy.replace.bind(f.store.filePolicy);let writes=0;f.store.filePolicy.replace=async(...args)=>{writes++;await replace(...args);if(boundary==='persisted-ack'&&writes===2)throw Error('QA_PAY_PERSISTED_ACK')};
 if(boundary==='readback'){const available=f.store.filePolicy.available.bind(f.store.filePolicy);f.store.filePolicy.available=async p=>{if(writes===2&&p===f.filePath)throw Error('QA_PAY_READBACK');return available(p)}}
 await assert.rejects(f.approve());const entry=(await f.flow.restore(f.identity.account)).entry;assert.ok(entry.record.paymentResult.walletSignature);assert.equal(entry.localRetention.durable,false);assert.ok(entry.localRetention.storageCause.message.startsWith('QA_PAY_'));
 const cold=new FileTransactionIntentStore({filePath:f.filePath});const actual=await cold.signedPayProgress(f.identity.account,f.input.policy,()=>{});if(actual)assert.equal(canonicalJSON(actual.record),canonicalJSON(entry.record));else assert.ok(await cold.unresolvedPreparation(evmAddressFromYNX(f.identity.account)));await assert.rejects(cold.assertNoSignedPayment(evmAddressFromYNX(f.identity.account)));assert.equal(f.calls.filter(x=>x.url?.endsWith('/transactions/broadcast')).length,0);f.lifecycle.lock();
});
for(const version of [1,2,3,4,5])test(`Desktop v${version} existing vault → durable attempt → one POST → original proof → settlement → atomic paid history`,async()=>{
  const f=await fixture(version),approved=await f.approve();assert.equal(approved.durabilityConfirmed,false);assert.equal(f.decryptions(),1);
  await assert.rejects(f.flow.done(f.identity.account),/PAY_ORIGINAL_SETTLEMENT_REQUIRED/);
  const checked=await f.flow.checkOriginal(f.identity.account);assert.ok(checked.evidence);assert.equal(checked.consensusFinality,false);
  const settled=await f.flow.settleOriginal(f.identity.account);assert.ok(settled.settlement);assert.equal(settled.settlement.blockNumber,99);
  await assert.rejects(f.flow.done(f.identity.account,""),/PAY_SIGNED_ORIGINAL_BINDING_MISMATCH/);
  const archived=await f.flow.done(f.identity.account);assert.equal(archived.record.transfer.hash,approved.record.transfer.hash);
  assert.deepEqual(await f.flow.done(f.identity.account,approved.record.transfer.hash),archived);assert.equal(await f.flow.restore(f.identity.account),null);
  const restart=new FileTransactionIntentStore({filePath:f.filePath});assert.equal(await restart.signedPayProgress(f.identity.account,f.input.policy,()=>{}),null);
  const history=await restart.payHistory(f.identity.account,f.input.policy,()=>{});assert.equal(history.length,1);assert.equal(history[0].consensusFinality,false);
  await restart.assertNoSignedPayment(evmAddressFromYNX(f.identity.account));const before=await readFile(f.filePath,"utf8");
  assert.deepEqual(await restart.archiveSignedPay(f.identity.account,approved.record.transfer.hash,f.input.policy,()=>{}),archived);assert.equal(await readFile(f.filePath,"utf8"),before);
  await assert.rejects(f.approve(),/PAY_INVOICE_ALREADY_PAID/);assert.equal(f.decryptions(),1);
  assert.equal(f.calls.filter(call=>call.url?.endsWith("/transactions/broadcast")).length,1);assert.equal(f.calls.filter(call=>call.settlement).length,1);f.lifecycle.lock();
});
test("Desktop lost broadcast keeps original and only reads after restart, without key or replacement POST",async()=>{
  const f=await fixture();f.state.broadcast=async()=>{throw Error("lost ACK")};await assert.rejects(f.approve());const before=await readFile(f.filePath,"utf8");
  const restarted=createProtectedDesktopPayFlow({...f.integration,store:new FileTransactionIntentStore({filePath:f.filePath})});
  const restored=await restarted.restore(f.identity.account);assert.equal(restored.state,"transfer_unconfirmed");assert.equal(restored.currentAuthorityVerified,false);
  await assert.rejects(restarted.approve(f.input),/PAY_SIGNED_ORIGINAL_REQUIRES_REVIEW/);assert.equal(await readFile(f.filePath,"utf8"),before);
  const entry=await restarted.checkOriginal(f.identity.account);assert.ok(entry.evidence);assert.equal(f.decryptions(),1);assert.equal(f.calls.filter(call=>call.url?.endsWith("/transactions/broadcast")).length,1);f.lifecycle.lock();
});
test("Desktop failed journal claim cannot start POST and conservatively fences restart",async()=>{
  const f=await fixture(),original=f.store.claimSignedPayBroadcast.bind(f.store);f.store.claimSignedPayBroadcast=async(...args)=>{await original(...args);throw Error("readback interrupted")};
  await assert.rejects(f.approve(),/readback interrupted/);assert.equal(f.calls.filter(call=>call.url?.endsWith("/transactions/broadcast")).length,0);
  const entry=await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{});assert.equal(entry.broadcastAttempted,true);
  await assert.rejects(f.store.claimSignedPayBroadcast(f.identity.account,entry.record.transfer.hash,f.input.policy,()=>{}));f.lifecycle.lock();
});
test("Desktop journal lock after save never POSTs, and original remains review-only",async()=>{
  const f=await fixture(),retain=f.store.retainSignedPayment.bind(f.store);f.store.retainSignedPayment=async(...args)=>{const value=await retain(...args);f.lifecycle.lock();return value};
  await assert.rejects(f.approve());assert.equal(f.calls.filter(call=>call.url?.endsWith("/transactions/broadcast")).length,0);assert.ok(await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{}));
});
test("Desktop lost settlement never resubmits; original authenticated read recovers and archives",async()=>{
  const f=await fixture();await f.approve();await f.flow.checkOriginal(f.identity.account);f.state.settle=async()=>{throw Error("lost settlement response")};await assert.rejects(f.flow.settleOriginal(f.identity.account));
  await assert.rejects(f.flow.settleOriginal(f.identity.account));const recovered=await f.flow.readOriginalReceipt(f.identity.account);assert.ok(recovered.settlement);await f.flow.done(f.identity.account);
  assert.equal(f.calls.filter(call=>call.settlement).length,1);assert.equal(f.calls.filter(call=>call.read).length,1);assert.equal(f.decryptions(),1);f.lifecycle.lock();
});
test("Desktop late authenticated settlement is retained but cannot publish unlocked UI success",async()=>{
  const f=await fixture();await f.approve();await f.flow.checkOriginal(f.identity.account);f.state.settle=async args=>{f.lifecycle.lock();return f.response(args.record)};
  await assert.rejects(f.flow.settleOriginal(f.identity.account));const retained=await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{});assert.ok(retained.settlement);
  assert.equal((await f.store.payHistory(f.identity.account,f.input.policy,()=>{})).length,0);await f.lifecycle.unlock();await f.flow.done(f.identity.account);assert.equal(f.decryptions(),1);f.lifecycle.lock();
});
test("Desktop full fresh same-account session may read old result but never rebind or resubmit",async()=>{
  const f=await fixture();await f.approve();await f.flow.checkOriginal(f.identity.account);const original=await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{});
  f.setNow(f.input.now()+240_000);f.lifecycle.lock();await f.lifecycle.unlock();f.authority.session=f.parsedSession({sessionBinding:"e".repeat(64),nonce:"x".repeat(32),issuedAt:"2026-10-03T01:03:59.000Z",expiresAt:"2026-10-03T01:06:59.000Z"});
  await assert.rejects(f.flow.settleOriginal(f.identity.account));const read=await f.flow.readOriginalReceipt(f.identity.account);assert.equal(canonicalJSON(read.record),canonicalJSON(original.record));await f.flow.done(f.identity.account);
  assert.equal(f.calls.filter(call=>call.settlement).length,0);assert.equal(f.decryptions(),1);f.lifecycle.lock();
});
test("Desktop non-durable late reads cannot demote already verified proof",async()=>{
  const f=await fixture();await f.approve();const verified=await f.flow.checkOriginal(f.identity.account);f.state.nativeStatus="not_found";const next=await f.flow.checkOriginal(f.identity.account);assert.deepEqual(next.evidence,verified.evidence);f.lifecycle.lock();
});
test("Desktop schema3 inheritance reads bytes unchanged and never infers unattempted POST",async()=>{
  const f=await fixture();await f.approve();const record=(await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{})).record;
  const raw=JSON.stringify({schemaVersion:3,records:[],rejections:[],resolutions:[],signedPayments:[record]});await writeFile(f.filePath,raw,{mode:0o600});
  assert.equal((await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{})).broadcastAttempted,true);assert.equal(await readFile(f.filePath,"utf8"),raw);
  await assert.rejects(f.store.claimSignedPayBroadcast(f.identity.account,record.transfer.hash,f.input.policy,()=>{}));assert.equal(await readFile(f.filePath,"utf8"),raw);await f.flow.checkOriginal(f.identity.account);assert.equal(JSON.parse(await readFile(f.filePath,"utf8")).schemaVersion,4);f.lifecycle.lock();
});
test("Desktop settlement fields, invoice signer and source labels cannot manufacture trusted receipt",async()=>{
  const f=await fixture(5);await f.approve();const entry=await f.flow.checkOriginal(f.identity.account),settlement=f.response(entry.record).settlement;
  for(const change of [{amount:24},{payer:f.input.rawInvoice.payoutAddress},{transactionHash:"0x"+"f".repeat(64)},{intentDigest:"e".repeat(64)},{requestNonce:"x".repeat(32)},{idempotencyKey:"other"},{sourceVersion:2},{committedAt:"2026-10-03T00:00:00Z"}])assert.throws(()=>parseDesktopPaySettlement({...settlement,...change},entry.record,entry.evidence));
  f.state.read=async args=>({...f.response(args.record),merchantName:"substituted"});const before=await readFile(f.filePath,"utf8");await assert.rejects(f.flow.readOriginalReceipt(f.identity.account));assert.equal(await readFile(f.filePath,"utf8"),before);f.lifecycle.lock();
});
test("Desktop corrupt history blocks reads and new transfers without deleting receipts",async()=>{
  const f=await fixture();await f.approve();await f.flow.checkOriginal(f.identity.account);await f.flow.settleOriginal(f.identity.account);await f.flow.done(f.identity.account);
  const state=JSON.parse(await readFile(f.filePath,"utf8"));state.payHistory[0].settlement.transactionHash="0x"+"f".repeat(64);const raw=JSON.stringify(state);await writeFile(f.filePath,raw,{mode:0o600});
  await assert.rejects(f.store.assertNoSignedPayment(evmAddressFromYNX(f.identity.account)));await assert.rejects(f.approve());assert.equal(await readFile(f.filePath,"utf8"),raw);f.lifecycle.lock();
});
test("Desktop no fixture/default/global or partial integration enables protected flow",()=>{
  assert.throws(()=>createProtectedDesktopPayFlow({}));assert.throws(()=>createProtectedDesktopPayFlow({policy:{resolve:()=>{}},settlementTransport:{submitOriginal:async()=>({})}}));
});
for(const boundary of ["revoke","lock","expiry"])test(`Desktop ${boundary} after durable broadcast claim never starts a POST`,async()=>{
  const f=await fixture(),claim=f.store.claimSignedPayBroadcast.bind(f.store);f.store.claimSignedPayBroadcast=async(...args)=>{const value=await claim(...args);if(boundary==="revoke")f.revoke();if(boundary==="lock")f.lifecycle.lock();if(boundary==="expiry")f.setNow(f.input.now()+60_000);return value};
  await assert.rejects(f.approve());assert.equal(f.calls.filter(call=>call.url?.endsWith("/transactions/broadcast")).length,0);
  assert.equal((await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{})).broadcastAttempted,true);f.lifecycle.lock();
});
test("Desktop transport receives live effect guard and cannot deliver after its own await is invalidated",async()=>{
  const f=await fixture();await f.approve();await f.flow.checkOriginal(f.identity.account);f.state.settle=async args=>{args.guard();f.lifecycle.lock();args.guard();return f.response(args.record)};
  await assert.rejects(f.flow.settleOriginal(f.identity.account));const retained=await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{});assert.equal(retained.settlementAttempted,true);assert.equal(retained.settlement,null);
});
test("Desktop verified settlement cannot be replaced or demoted by later unknown/foreign responses",async()=>{
  const f=await fixture();await f.approve();await f.flow.checkOriginal(f.identity.account);const verified=await f.flow.settleOriginal(f.identity.account),before=await readFile(f.filePath,"utf8");
  f.state.read=async args=>({...f.response(args.record),settlement:{...f.response(args.record).settlement,auditHash:"c".repeat(64)}});await assert.rejects(f.flow.readOriginalReceipt(f.identity.account));
  assert.equal(await readFile(f.filePath,"utf8"),before);assert.deepEqual((await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{})).settlement,verified.settlement);f.lifecycle.lock();
});
test("Desktop failed archive write keeps active original, verified receipt and transfer block",async()=>{
  const f=await fixture();await f.approve();await f.flow.checkOriginal(f.identity.account);await f.flow.settleOriginal(f.identity.account);const before=await readFile(f.filePath,"utf8"),replace=f.store.filePolicy.replace;
  f.store.filePolicy.replace=async()=>{throw Error("simulated replacement denied")};await assert.rejects(f.flow.done(f.identity.account));assert.equal(await readFile(f.filePath,"utf8"),before);
  await assert.rejects(f.store.assertNoSignedPayment(evmAddressFromYNX(f.identity.account)));f.store.filePolicy.replace=replace;await f.flow.done(f.identity.account);f.lifecycle.lock();
});
test("Desktop duplicate concurrent approvals never create a second key access or POST",async()=>{
  const f=await fixture(),results=await Promise.allSettled([f.approve(),f.approve()]);assert.equal(results.filter(value=>value.status==="fulfilled").length,1);assert.equal(f.decryptions(),1);assert.equal(f.calls.filter(call=>call.url?.endsWith("/transactions/broadcast")).length,1);f.lifecycle.lock();
});

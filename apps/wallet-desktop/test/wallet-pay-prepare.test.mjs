import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {evmAddressFromYNX,parseSignedNativeTransfer,verifyPayPaymentResult} from "@ynx-chain/wallet-auth";
import {DesktopKeyLifecycle} from "../src/key-lifecycle.mjs";
import {DesktopWalletVault} from "../src/desktop-wallet-vault.mjs";
import {prepareDesktopSignedPayTransfer} from "../src/wallet-pay-prepare.mjs";
import {payTestSecret,signedPayFixture} from "./fixture-signed-pay.mjs";
import {fixtureKeyAuthorization} from "./fixture-key-authorization.mjs";
async function fixture(version=1,expectedPayerHash){
  const f=signedPayFixture(version,expectedPayerHash);let reads=0,action=()=>{};
  const lifecycle=new DesktopKeyLifecycle({now:f.input.now,authorizer:{available:()=>true,authenticate:async()=>{},method:"controlled-test-only"},schedule:()=>null,unschedule:()=>{}});
  lifecycle.setFocused(true);
  const directory=await mkdtemp(join(tmpdir(),"ynx-desktop-pay-test-"));
  const vault=new DesktopWalletVault({authorization:fixtureKeyAuthorization,filePath:join(directory,"vault.json"),randomSecret:()=>payTestSecret,safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptStringAsync:async bytes=>{reads++;await action();return {result:Buffer.from(bytes).reverse().toString()}}}});
  // Synthetic account setup only. Signing uses the REAL lifecycle and vault.
  await vault.createAccount();vault.authorization=lifecycle;lifecycle.setAccount(evmAddressFromYNX(f.identity.account));await lifecycle.unlock();
  return {...f,lifecycle,vault,reads:()=>reads,onKey:fn=>{action=fn},prepare:()=>lifecycle.run(guard=>prepareDesktopSignedPayTransfer({...f.input,vault,guard}))};
}
for(const version of [1,2,3,4,5])test(`Desktop v${version} uses existing encrypted vault once and binds exact native transfer/result`,async()=>{
  const f=await fixture(version),signed=await f.prepare();assert.equal(f.reads(),1);
  const tx=parseSignedNativeTransfer(signed.payload);assert.equal(tx.nonce,2);assert.equal(tx.amount,25);assert.equal(tx.fee,1);
  assert.equal(tx.from,evmAddressFromYNX(f.identity.account));assert.equal(signed.paymentResult.transactionHash,signed.hash);
  assert.equal(verifyPayPaymentResult(signed.paymentResult,signed.intent,f.identity.account,new Date(f.input.now())).intentDigest,f.input.reviewedIntentDigest);
  assert.equal(Object.isFrozen(signed),true);assert.equal(JSON.stringify(signed).includes(payTestSecret),false);f.lifecycle.lock();
});
test("Desktop missing business authority, mismatched visible review or restricted payer never decrypts",async()=>{
  for(const mode of ["missing","identity-only","digest","amount","payer"]){const f=await fixture(mode==="payer"?5:1,mode==="payer"?"f".repeat(64):undefined);
    if(mode==="missing")f.input.authority=null;if(mode==="identity-only")f.authority.session=f.parsedSession({scopes:["account:read"]});
    if(mode==="digest")f.input.reviewedIntentDigest="e".repeat(64);if(mode==="amount")f.input.review={...f.input.review,amount:24};
    await assert.rejects(f.prepare());assert.equal(f.reads(),0);f.lifecycle.lock();}
});
for(const stage of ["account","capability","key"])for(const boundary of ["lock","account","background","revoke","expiry","session"]){
  test(`Desktop ${boundary} during ${stage} cannot return a signed Pay result`,async()=>{
    const f=await fixture(),invalidate=()=>{
      if(boundary==="lock")f.lifecycle.lock();if(boundary==="account")f.lifecycle.setAccount("0x"+"3".repeat(40));if(boundary==="background")f.lifecycle.setFocused(false);
      if(boundary==="revoke")f.revoke();if(boundary==="expiry")f.setNow(f.input.now()+60_000);if(boundary==="session")f.authority.session=f.parsedSession({nonce:"x".repeat(32)});
    };
    if(stage==="account"){const original=f.input.client.account;f.input.client.account=async()=>{const value=await original();invalidate();return value}}
    if(stage==="capability")f.input.client.requireDurabilityCapability=async()=>{invalidate()};if(stage==="key")f.onKey(invalidate);
    await assert.rejects(f.prepare(),error=>["WALLET_OPERATION_CANCELLED","PAY_CURRENT_AUTHORITY_EXPIRED","PAY_CURRENT_SESSION_CHANGED","revoked"].includes(error.data?.code??error.code??error.message));assert.equal(f.reads(),stage==="key"?1:0);f.lifecycle.lock();
  });
}
test("Desktop canonical business conflict after protected key await cannot yield a result",async()=>{
  const f=await fixture();let checks=0;f.authority.verifyInvoicePayable=async()=>{if(++checks===2)throw Error("already paid")};
  await assert.rejects(f.prepare(),/already paid/);assert.equal(f.reads(),1);f.lifecycle.lock();
});
test("Desktop captures review before awaits and does not inherit caller edits",async()=>{
  const f=await fixture(),original=f.input.client.account;
  f.input.client.account=async()=>{f.input.review.amount=1;f.input.review.to=f.identity.account;return original()};
  const signed=await f.prepare(),tx=parseSignedNativeTransfer(signed.payload);assert.equal(tx.amount,25);assert.equal(tx.to,evmAddressFromYNX(signed.invoice.payoutAddress));assert.equal(f.reads(),1);f.lifecycle.lock();
});
test("Desktop malformed native account, insufficient whole-unit balance or unsupported nonce never decrypts",async()=>{
  for(const changes of [{address:"0x"+"4".repeat(40)},{balance:25},{nonce:-1},{nonce:Number.MAX_SAFE_INTEGER}]){
    const f=await fixture(),original=await f.input.client.account(f.identity.account);f.input.client.account=async()=>({...original,...changes});
    await assert.rejects(f.prepare(),/PAY_NATIVE_ACCOUNT_OR_BALANCE_INVALID/);assert.equal(f.reads(),0);f.lifecycle.lock();
  }
});
test("Desktop concurrent explicit preparations stay under original lifecycle single-flight",async()=>{
  const f=await fixture();let resume;const waiting=new Promise(resolve=>{resume=resolve}),original=f.input.client.account;
  f.input.client.account=async()=>{await waiting;return original()};const first=f.prepare();await assert.rejects(f.prepare(),error=>error.data?.code==="WALLET_OPERATION_BUSY");resume();await first;assert.equal(f.reads(),1);f.lifecycle.lock();
});
test("Desktop authority invalidation at vault return cannot publish the prepared result",async()=>{
  const f=await fixture(),original=f.vault.withSecret.bind(f.vault);f.vault.withSecret=async action=>{const result=await original(action);f.revoke();return result};
  await assert.rejects(f.prepare(),/revoked/);assert.equal(f.reads(),1);f.lifecycle.lock();
});

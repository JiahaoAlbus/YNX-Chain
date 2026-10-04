import {test} from "node:test";
import assert from "node:assert/strict";
import {verifyPayPaymentResult,walletIdentity,ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {prepareSignedPayTransfer} from "./prepareSignedPayTransfer";
import {signedPayFixture as fixture} from "./signedPayTestFixture";
const at=Date.parse("2026-10-03T01:00:00.000Z"),identity=walletIdentity("01".repeat(32));
for(const version of [2,3,4,5])test(`V${version} preparation preserves the original signed invoice restrictions`,async()=>{
  const f=fixture(version);try{const signed=await prepareSignedPayTransfer(f.input);assert.equal(signed.paymentResult.invoiceId,f.input.rawInvoice.id);assert.equal(signed.transaction.amount,25);assert.equal(f.counts().reads,1)}finally{f.lease.finish()}
});
for(const version of [4,5])test(`V${version} invoice for a different expected payer cannot prompt or use a key`,async()=>{
  const f=fixture(version,"e".repeat(64));try{await assert.rejects(prepareSignedPayTransfer(f.input),/EXPECTED_PAYER_MISMATCH/);assert.equal(f.counts().prompts,0);assert.equal(f.counts().reads,0)}finally{f.lease.finish()}
});
test("current session alone cannot authorize an already-paid or unreserved invoice",async()=>{
  const f=fixture();try{
    f.authority.verifyInvoicePayable=async()=>{throw Error("invoice already paid on another device")};
    await assert.rejects(prepareSignedPayTransfer(f.input),/already paid/);assert.equal(f.counts().prompts,0);assert.equal(f.counts().reads,0);
  }finally{f.lease.finish()}
  const missing=fixture();try{
    await assert.rejects(prepareSignedPayTransfer({...missing.input,authority:{...missing.authority,verifyInvoicePayable:undefined} as any}),/BUSINESS_AUTHORITY_REQUIRED/);
    assert.equal(missing.counts().prompts,0);assert.equal(missing.counts().reads,0);
  }finally{missing.lease.finish()}
});
test("Pay transfer and public result use the original single protected key read and reviewed exact amount",async()=>{
  const f=fixture();try{
    const signed=await prepareSignedPayTransfer(f.input);
    assert.equal(f.counts().reads,1);assert.equal(f.counts().prompts,1);assert.ok(f.counts().refreshes>=7);
    assert.equal(signed.transaction.nonce,2);assert.equal(signed.transaction.amount,25);assert.equal(signed.transaction.fee,1);
    assert.equal(signed.paymentResult.transactionHash,signed.hash);assert.equal(signed.paymentResult.accountPublicKey,identity.accountPublicKey);
    assert.deepEqual(verifyPayPaymentResult(signed.paymentResult,f.input.rawIntent,identity.account,new Date(at)),signed.paymentResult);
    assert.ok(Object.isFrozen(signed));assert.equal("accountSecret" in signed,false);
  }finally{f.lease.finish()}
});
test("missing real authority, changed visible digest/amount/account and identity-only scopes reject before authorization",async()=>{
  const variants=[{authority:null},{reviewedIntentDigest:"e".repeat(64)},{review:{account:identity.account,accountPublicKey:identity.accountPublicKey,to:ynxAddressFromEVM("0x"+"3".repeat(40)),amount:25}},{review:{account:identity.account,accountPublicKey:identity.accountPublicKey,to:ynxAddressFromEVM("0x"+"2".repeat(40)),amount:26}}];
  for(const change of variants){const f=fixture();try{await assert.rejects(prepareSignedPayTransfer({...f.input,...change}));assert.equal(f.counts().prompts,0);assert.equal(f.counts().reads,0)}finally{f.lease.finish()}}
  for(const changes of [{scopes:["account:read"]},{scopes:["account:read","pay:case:create","pay:route:select","pay:settlement:submit","pay:sponsorship:request"]},{account:walletIdentity("02".repeat(32)).account},{origin:"https://other.invalid"},{sessionBinding:"e".repeat(64)},{expiresAt:"2026-10-03T01:05:00.000Z"}]){
    const f=fixture();try{f.authority.session=f.parsedSession(changes);await assert.rejects(prepareSignedPayTransfer(f.input));assert.equal(f.counts().prompts,0);assert.equal(f.counts().reads,0)}finally{f.lease.finish()}
  }
});
test("quote must fit the full originally approved session; no caller clamping or silent session replacement",async()=>{
  const f=fixture();try{
    f.authority.session=f.parsedSession({expiresAt:"2026-10-03T01:00:30.000Z"});
    await assert.rejects(prepareSignedPayTransfer(f.input),/EXCEEDS_SESSION_LIFETIME/);assert.equal(f.counts().prompts,0);
  }finally{f.lease.finish()}
  const changed=fixture();try{
    changed.authority.refresh=async()=>changed.parsedSession({deviceId:"other-device"});
    await assert.rejects(prepareSignedPayTransfer(changed.input),/SESSION_CHANGED/);assert.equal(changed.counts().reads,0);
  }finally{changed.lease.finish()}
});
for(const stage of ["authorization","account","capability","key"]){
  for(const boundary of ["revoke","expiry","lock","account","background"]){
    test(`Pay ${boundary} after ${stage} await cannot yield signed payment result`,async()=>{
      const f=fixture(),invalidate=()=>{
        if(boundary==="revoke")f.revoke();if(boundary==="expiry")f.setNow(at+60_000);if(boundary==="lock")f.operations.lock();
        if(boundary==="account")f.operations.setAccount(walletIdentity("02".repeat(32)).account);if(boundary==="background")f.operations.setAppState("background");
      };
      try{
        if(stage==="authorization"){const original=f.input.authorize;f.input.authorize=async()=>{await original();invalidate()}}
        if(stage==="account"){const original=f.client.account;f.client.account=async()=>{const result=await original();invalidate();return result}}
        if(stage==="capability")f.client.requireDurabilityCapability=async()=>{invalidate()};
        if(stage==="key"){const original=f.repository.accountSecret;f.repository.accountSecret=async(account,guard)=>{const result=await original(account,guard);invalidate();return result}}
        await assert.rejects(prepareSignedPayTransfer(f.input));if(stage!=="key")assert.equal(f.counts().reads,0);
      }finally{f.lease.finish()}
    });
  }
}
test("revocation during post-key introspection and a wrong protected identity cannot produce a result",async()=>{
  const f=fixture();try{
    const original=f.authority.refresh;f.authority.refresh=async()=>{const session=await original();if(f.counts().reads)f.revoke();return session};
    await assert.rejects(prepareSignedPayTransfer(f.input),/revoked/);assert.equal(f.counts().reads,1);
  }finally{f.lease.finish()}
  const wrong=fixture();try{wrong.repository.accountSecret=async()=>"02".repeat(32);await assert.rejects(prepareSignedPayTransfer(wrong.input),/Signing account changed/)}finally{wrong.lease.finish()}
});

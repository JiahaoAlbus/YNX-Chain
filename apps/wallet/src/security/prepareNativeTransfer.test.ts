import test from "node:test";
import assert from "node:assert/strict";
import {evmAddressFromYNX,walletIdentity,ynxAddressFromEVM} from "@ynx-chain/wallet-auth";
import {WalletOperationLifecycle} from "./operationLifecycle";
import {prepareNativeTransfer} from "./prepareNativeTransfer";

const seed="01".repeat(32),identity=walletIdentity(seed),to=ynxAddressFromEVM("0x"+"2".repeat(40));
const review={account:identity.account,accountPublicKey:identity.accountPublicKey,to,amount:25};
function fixture(){
  const operations=new WalletOperationLifecycle();operations.setAccount(identity.account);
  const unlock=operations.scope().begin({requireUnlocked:false});operations.unlock(unlock);unlock.finish();
  const lease=operations.scope().begin();const calls:string[]=[];
  const client={async account(account:string){calls.push("account");assert.equal(account,review.account);return {address:evmAddressFromYNX(identity.account),balance:26,nonce:1}},async requireDurabilityCapability(){calls.push("capability")}};
  const repository={async accountSecret(account:string,guard:()=>void,options?:{allowLegacyMigration?:boolean}){calls.push("protected-key");guard();assert.equal(account,review.account);assert.equal(options?.allowLegacyMigration,true);return seed}};
  const authorize=async()=>{calls.push("authorize")};
  return {operations,lease,calls,client,repository,authorize};
}
test("Send and Pay preparation use the reviewed identity and existing protected read after authorization",async()=>{
  const f=fixture();try{
    const signed=await prepareNativeTransfer(review,f.lease,f.client,f.repository,f.authorize);
    assert.deepEqual(f.calls,["authorize","account","capability","protected-key"]);
    assert.equal(signed.transaction.amount,25);assert.equal(signed.transaction.fee,1);assert.equal(signed.transaction.nonce,2);
  }finally{f.lease.finish()}
});
test("invalid review never prompts or reads a key",async()=>{
  for(const amount of [0,-1,0.5,NaN,Number.MAX_SAFE_INTEGER]){
    const f=fixture();try{await assert.rejects(()=>prepareNativeTransfer({...review,amount},f.lease,f.client,f.repository,f.authorize),/whole YNXT/);assert.deepEqual(f.calls,[])}finally{f.lease.finish()}
  }
});
test("lock during authorization and switch during account read cancel before protected key access",async()=>{
  for(const stage of ["authorize","account"]){
    const f=fixture();try{
      if(stage==="authorize")f.authorize=async()=>{f.operations.lock()};
      else{const original=f.client.account;f.client.account=async account=>{const value=await original(account);f.operations.setAccount(to);return value}};
      await assert.rejects(()=>prepareNativeTransfer(review,f.lease,f.client,f.repository,f.authorize),/cancelled/);
      assert.equal(f.calls.includes("protected-key"),false);
    }finally{f.lease.finish()}
  }
});
test("insufficient balance, nonce overflow and wrong protected identity never produce a signature",async()=>{
  for(const stage of ["balance","nonce","identity"]){
    const f=fixture();try{
      if(stage!=="identity")f.client.account=async()=>({address:evmAddressFromYNX(identity.account),balance:stage==="balance"?25:26,nonce:stage==="nonce"?Number.MAX_SAFE_INTEGER:1});
      else f.repository.accountSecret=async()=>"02".repeat(32);
      await assert.rejects(()=>prepareNativeTransfer(review,f.lease,f.client,f.repository,f.authorize),stage==="identity"?/Signing account changed/:stage==="balance"?/Insufficient/:/nonce exceeds/);
      if(stage!=="identity")assert.equal(f.calls.includes("protected-key"),false);
    }finally{f.lease.finish()}
  }
});

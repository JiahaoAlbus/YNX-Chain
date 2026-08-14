import assert from "node:assert/strict";
import { test } from "node:test";
import { generateRecoveryKeyFailClosed } from "./recoveryKeyGenerationPolicy";

test("recovery-key generation requires an active lifecycle and wipes temporary entropy",async()=>{
  const bytes=Uint8Array.from({length:32},(_,index)=>index+1);
  const recoveryKey=await generateRecoveryKeyFailClosed(async()=>bytes,()=>{});
  assert.equal(recoveryKey,"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
  assert.deepEqual([...bytes],Array(32).fill(0));
});

test("background, lock and invalid entropy fail closed and still wipe bytes",async()=>{
  for(const failAt of [1,2]){
    const bytes=new Uint8Array(32).fill(7);let checks=0;
    await assert.rejects(generateRecoveryKeyFailClosed(async()=>bytes,()=>{if(++checks===failAt)throw new Error("inactive")}),/inactive/);
    assert.deepEqual([...bytes],Array(32).fill(0));
  }
  const short=new Uint8Array(31).fill(9);
  await assert.rejects(generateRecoveryKeyFailClosed(async()=>short,()=>{}),/entropy is invalid/);
  assert.deepEqual([...short],Array(31).fill(0));
});

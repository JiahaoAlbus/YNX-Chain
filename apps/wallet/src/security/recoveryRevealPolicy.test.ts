import assert from "node:assert/strict";
import { test } from "node:test";
import { revealRecoverySecretFailClosed } from "./recoveryRevealPolicy";

const SECRET=`${"00".repeat(31)}01`;

test("recovery reveal confirms screenshot protection before biometric and secret read",async()=>{
  const events:string[]=[];
  const secret=await revealRecoverySecretFailClosed(async()=>{events.push("protect")},async()=>{events.push("biometric")},async()=>{events.push("read");return SECRET},()=>events.push("active"));
  assert.equal(secret,SECRET);
  assert.deepEqual(events,["protect","active","biometric","active","read","active"]);
});

test("protection failure and lifecycle invalidation fail closed before later steps",async()=>{
  const failedProtection:string[]=[];
  await assert.rejects(revealRecoverySecretFailClosed(async()=>{failedProtection.push("protect");throw new Error("privacy failed")},async()=>{failedProtection.push("biometric")},async()=>{failedProtection.push("read");return SECRET},()=>failedProtection.push("active")),/privacy failed/);
  assert.deepEqual(failedProtection,["protect"]);

  for(const failAt of [1,2,3]){
    const events:string[]=[];let checks=0;
    await assert.rejects(revealRecoverySecretFailClosed(async()=>{events.push("protect")},async()=>{events.push("biometric")},async()=>{events.push("read");return SECRET},()=>{events.push("active");if(++checks===failAt)throw new Error("inactive")}),/inactive/);
    assert.deepEqual(events,["protect","active",...(failAt>=2?["biometric","active"]:[]),...(failAt>=3?["read","active"]:[])]);
  }

  await assert.rejects(revealRecoverySecretFailClosed(async()=>{},async()=>{},async()=>"AA".repeat(32),()=>{}),/recovery key is invalid/);
});

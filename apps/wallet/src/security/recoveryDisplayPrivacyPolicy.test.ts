import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareRecoveryKeyDisplayFailClosed } from "./recoveryDisplayPrivacyPolicy";

test("recovery display becomes eligible only after screenshot protection",async()=>{
  const events:string[]=[];
  await prepareRecoveryKeyDisplayFailClosed(async()=>{events.push("protect")},()=>events.push("active"));
  assert.deepEqual(events,["protect","active"]);
});

test("protection failure or dismissal never makes recovery display eligible",async()=>{
  const failed:string[]=[];
  await assert.rejects(prepareRecoveryKeyDisplayFailClosed(async()=>{failed.push("protect");throw new Error("privacy failed")},()=>failed.push("active")),/privacy failed/);
  assert.deepEqual(failed,["protect"]);
  await assert.rejects(prepareRecoveryKeyDisplayFailClosed(async()=>{},()=>{throw new Error("dismissed")}),/dismissed/);
});

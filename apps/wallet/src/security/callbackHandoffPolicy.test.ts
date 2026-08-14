import assert from "node:assert/strict";
import { test } from "node:test";
import { completeAuthorizationCallbackHandoff } from "./callbackHandoffPolicy";

test("callback handoff validates before opening and records a successful OS handoff",async()=>{
  const events:string[]=[];
  await completeAuthorizationCallbackHandoff(()=>events.push("active"),async()=>{events.push("open")},async()=>{events.push("audit")},()=>events.push("complete"));
  assert.deepEqual(events,["active","open","audit","complete"]);
});

test("invalid lifecycle or failed open never records callback success",async()=>{
  const inactive:string[]=[];
  await assert.rejects(completeAuthorizationCallbackHandoff(()=>{inactive.push("active");throw new Error("expired")},async()=>{inactive.push("open")},async()=>{inactive.push("audit")},()=>inactive.push("complete")),/expired/);
  assert.deepEqual(inactive,["active"]);

  const failedOpen:string[]=[];
  await assert.rejects(completeAuthorizationCallbackHandoff(()=>failedOpen.push("active"),async()=>{failedOpen.push("open");throw new Error("no handler")},async()=>{failedOpen.push("audit")},()=>failedOpen.push("complete")),/no handler/);
  assert.deepEqual(failedOpen,["active","open"]);
});

test("expected background after a successful OS handoff does not erase callback audit",async()=>{
  const events:string[]=[];let active=true;
  await completeAuthorizationCallbackHandoff(()=>{events.push("active");if(!active)throw new Error("backgrounded")},async()=>{events.push("open");active=false},async()=>{events.push("audit")},()=>events.push("complete"));
  assert.deepEqual(events,["active","open","audit","complete"]);

  const auditFailure:string[]=[];
  await assert.rejects(completeAuthorizationCallbackHandoff(()=>auditFailure.push("active"),async()=>auditFailure.push("open"),async()=>{auditFailure.push("audit");throw new Error("storage failed")},()=>auditFailure.push("complete")),/storage failed/);
  assert.deepEqual(auditFailure,["active","open","audit"]);
});

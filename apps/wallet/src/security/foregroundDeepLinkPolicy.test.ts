import assert from "node:assert/strict";
import { test } from "node:test";
import { ForegroundDeepLinkGate } from "./foregroundDeepLinkPolicy";

test("Android intent handoff waits for the exact active foreground before parsing",()=>{
  const handled:string[]=[],rejected:string[]=[];
  const gate=new ForegroundDeepLinkGate((url)=>handled.push(url),(error)=>rejected.push(error.message));
  gate.receive("ynxwallet://authorize?request=one","background");
  assert.deepEqual(handled,[]);
  gate.stateChanged("inactive");
  assert.deepEqual(handled,[]);
  gate.stateChanged("active");
  assert.deepEqual(handled,["ynxwallet://authorize?request=one"]);
  assert.deepEqual(rejected,[]);
});

test("ambiguous lifecycle replay and unknown lifecycle fail closed",()=>{
  const handled:string[]=[],rejected:string[]=[];
  const gate=new ForegroundDeepLinkGate((url)=>handled.push(url),(error)=>rejected.push(error.message));
  gate.receive("ynxwallet://authorize?request=one","background");
  gate.receive("ynxwallet://authorize?request=one","inactive");
  gate.stateChanged("active");
  gate.receive("ynxwallet://authorize?request=unknown",null);
  assert.deepEqual(handled,[]);
  assert.deepEqual(rejected,["Wallet authorization link lifecycle is ambiguous","Wallet authorization links require a known application lifecycle"]);
});

test("failed gate discards queued and future authorization links",()=>{
  const handled:string[]=[];
  const gate=new ForegroundDeepLinkGate((url)=>handled.push(url),()=>{});
  gate.receive("ynxwallet://authorize?request=queued","background");
  gate.fail();
  gate.stateChanged("active");
  gate.receive("ynxwallet://authorize?request=future","active");
  assert.deepEqual(handled,[]);
});

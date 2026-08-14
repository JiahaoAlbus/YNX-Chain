import assert from "node:assert/strict";
import { test } from "node:test";
import { StartupDeepLinkGate } from "./startupDeepLinkPolicy";

test("cold-start deep link waits for successful secure repository reconstruction",()=>{
  const handled:string[]=[];
  const gate=new StartupDeepLinkGate((url)=>handled.push(url));
  gate.receive("ynxwallet://authorize?request=one");
  assert.deepEqual(handled,[]);
  gate.ready();
  assert.deepEqual(handled,["ynxwallet://authorize?request=one"]);
  gate.receive("ynxwallet://authorize?request=two");
  assert.deepEqual(handled,["ynxwallet://authorize?request=one","ynxwallet://authorize?request=two"]);
});

test("failed reconstruction and ambiguous startup callback replay discard pending links",()=>{
  const failed:string[]=[];
  const unavailable=new StartupDeepLinkGate((url)=>failed.push(url));
  unavailable.receive("ynxwallet://authorize?request=one");
  unavailable.fail();
  unavailable.ready();
  unavailable.receive("ynxwallet://authorize?request=two");
  assert.deepEqual(failed,[]);

  const replayed:string[]=[];
  const ambiguous=new StartupDeepLinkGate((url)=>replayed.push(url));
  ambiguous.receive("ynxwallet://authorize?request=same");
  ambiguous.receive("ynxwallet://authorize?request=same");
  ambiguous.ready();
  assert.deepEqual(replayed,[]);
});

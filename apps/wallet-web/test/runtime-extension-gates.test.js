import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const bridge=await readFile(new URL("../scripts/runtime-bridge-gate.mjs",import.meta.url),"utf8");
const activeTab=await readFile(new URL("../scripts/runtime-active-tab-browser-gate.mjs",import.meta.url),"utf8");
const fixture=await readFile(new URL("fixtures/dapp-eip6963.html",import.meta.url),"utf8");

test("runtime bridge uses an HTTPS blank fixture and discovers the real EIP-6963 provider",()=>{
  assert.match(bridge,/createServer\} from "node:https"/u);
  assert.match(bridge,/dapp-eip6963\.html/u);
  assert.match(bridge,/eip6963/u);
  assert.match(bridge,/item\.provider\.request\(\{method:"eth_chainId"\}\)/u);
  assert.doesNotMatch(bridge,/__YNX_FIXTURE_CALLS__/u);
  assert.doesNotMatch(bridge,/ethereum\.providers\.find/u);
  assert.match(bridge,/excludedLegacyFixtureGates/u);
  assert.match(bridge,/accountAuthorized:false/u);
  assert.match(fixture,/eip6963:announceProvider/u);
  assert.match(fixture,/eip6963:requestProvider/u);
  assert.doesNotMatch(fixture,/isYNXWallet\s*:/u);
  assert.doesNotMatch(fixture,/async request/u);
  assert.doesNotMatch(fixture,/window\.ethereum/u);
});

test("active-tab runtime polls migration and classifies toolbar action as manual",()=>{
  assert.match(activeTab,/for\(let attempt=0;attempt<50&&!report/u);
  assert.match(activeTab,/toolbarActionAutomation:"unsupported"/u);
  assert.match(activeTab,/classification:"manual-required"/u);
  assert.match(activeTab,/automationUnsupported:true/u);
  assert.doesNotMatch(activeTab,/keyboard\.press/u);
  assert.doesNotMatch(activeTab,/executeScript\(/u);
});

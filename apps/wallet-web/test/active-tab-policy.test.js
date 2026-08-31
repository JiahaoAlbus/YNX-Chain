import assert from "node:assert/strict";
import test from "node:test";
import {activeTabInjectionPlans,requireActiveDappTab} from "../src/active-tab-policy.js";

test("activeTab accepts only an exact HTTP(S) top-level DApp context",()=>{
  assert.deepEqual(requireActiveDappTab({id:7,url:"https://dapp.example/path"}),{tabId:7,origin:"https://dapp.example"});
  for(const tab of [null,{id:7},{id:"7",url:"https://dapp.example"},{id:7,url:"file:///tmp/app"},{id:7,url:"chrome://extensions"},{id:7,url:"https://user:secret@dapp.example"}])assert.throws(()=>requireActiveDappTab(tab),error=>error.code==="ACTIVE_TAB_REQUIRED");
});

test("activeTab bridge injection is isolated-world first and main-world second",()=>{
  assert.deepEqual(activeTabInjectionPlans(7),[
    {target:{tabId:7},files:["content-script.js"]},
    {target:{tabId:7},world:"MAIN",files:["page-provider.js"]},
  ]);
  assert.throws(()=>activeTabInjectionPlans(null),error=>error.code==="ACTIVE_TAB_REQUIRED");
});

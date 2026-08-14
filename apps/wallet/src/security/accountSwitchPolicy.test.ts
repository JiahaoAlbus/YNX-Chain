import assert from "node:assert/strict";
import { test } from "node:test";
import { switchAccountFailClosed } from "./accountSwitchPolicy";

test("account switching relocks synchronously before selection persistence",async()=>{
  const events:string[]=[];
  const result=await switchAccountFailClosed("two",(account)=>events.push(`lock:${account}`),async(account)=>{events.push(`persist:${account}`);return account});
  assert.equal(result,"two");
  assert.deepEqual(events,["lock:two","persist:two"]);
});

test("failed and same-account selection attempts still relock before failure",async()=>{
  for(const account of ["one","missing"]){
    const events:string[]=[];
    await assert.rejects(switchAccountFailClosed(account,(value)=>events.push(`lock:${value}`),async(value)=>{events.push(`persist:${value}`);throw new Error("selection failed")}),/selection failed/);
    assert.deepEqual(events,[`lock:${account}`,`persist:${account}`]);
  }
});

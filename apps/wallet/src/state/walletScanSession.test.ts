import test from "node:test";
import assert from "node:assert/strict";
import {WalletOperationLifecycle} from "../security/operationLifecycle";
import {WalletScanSession} from "./walletScanSession";

function fixture(){const operations=new WalletOperationLifecycle();operations.setAccount("account-a");const lease=operations.scope().begin({requireUnlocked:false});operations.unlock(lease);lease.finish();return {operations,scan:new WalletScanSession(operations)}}
const result={kind:"invoice",invoiceID:"invoice-1"} as const;
test("scanning is one-shot input, never an authorization or signature",()=>{
  const {scan}=fixture();let routed=0;scan.open("account-a");assert.equal(scan.accept(result,value=>{assert.deepEqual(value,result);routed++}),true);
  assert.equal(scan.accept(result,()=>routed++),false);assert.equal(routed,1);
});
test("cancel, lock, account switch and background reject late camera results",()=>{
  for(const change of [(f:ReturnType<typeof fixture>)=>f.scan.cancel(),(f:ReturnType<typeof fixture>)=>f.operations.lock(),(f:ReturnType<typeof fixture>)=>f.operations.setAccount("account-b"),(f:ReturnType<typeof fixture>)=>f.operations.setAppState("background"),(f:ReturnType<typeof fixture>)=>f.operations.invalidate()]){
    const f=fixture();f.scan.open("account-a");change(f);assert.equal(f.scan.accept(result,()=>assert.fail("late camera route")),false);
  }
});
test("camera cannot open for a locked or different account",()=>{
  const f=fixture();assert.throws(()=>f.scan.open("account-b"));f.operations.lock();assert.throws(()=>f.scan.open("account-a"));
});

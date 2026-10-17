import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {WalletConnectViewOperations} from "./viewOperations";
const source=readFileSync(new URL("./WalletConnectModal.tsx",import.meta.url),"utf8");
function scanner(){
 let now=1000,opened=0;const ops=new WalletConnectViewOperations(()=>now);ops.setAccount("account-a");ops.setAppState("active");
 const scanCurrent=ops.captureCurrent("account-a"),start=source.indexOf('onPress={()=>{if(scanCurrent()&&AppState.currentState==="active")');assert.notEqual(start,-1);const end=source.indexOf("} style=",start),handler=source.slice(start+"onPress={".length,end);
 const context={scanCurrent,AppState:{currentState:"active"},scannerAccount:{current:"account-a"},account:{account:"account-a"},setScanning:(value:boolean)=>{if(value)opened++;}};
 const press=runInNewContext("("+handler+")",context);return{ops,context,press,opened:()=>opened,advance:()=>{now+=120001;}};
}
test("actual enabled Scan control remains available after passive same-account idle without a render",()=>{const h=scanner();h.advance();h.press();assert.equal(h.opened(),1);});
for(const change of ["account","background","close","generation","inactive"] as const)test(`old passive Scan callback is still fenced after ${change}`,()=>{
 const h=scanner();h.advance();if(change==="account")h.ops.setAccount("account-b");else if(change==="background"){h.ops.setAppState("background");h.ops.setAppState("active");}else if(change==="close"||change==="generation")h.ops.cancel();else h.context.AppState.currentState="inactive";
 h.press();assert.equal(h.opened(),0);
});
test("long original-record projection keeps passive ownership but never extends an active operation TTL",()=>{
 let now=1000;const ops=new WalletConnectViewOperations(()=>now);ops.setAccount("account-a");ops.setAppState("active");const passive=ops.captureCurrent("account-a"),operation=ops.begin("account-a");now+=120001;
 assert.equal(passive(),true);assert.equal(operation.isCurrent(),false);assert.throws(operation.assert,/expired or was cancelled/);operation.finish();
 const fresh=ops.begin("account-a");assert.equal(fresh.isCurrent(),true);ops.cancel();assert.equal(passive(),false);assert.equal(fresh.isCurrent(),false);
});

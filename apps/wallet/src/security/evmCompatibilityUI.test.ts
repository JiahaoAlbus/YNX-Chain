import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {WalletOperationLifecycle} from "./operationLifecycle";
const source=readFileSync(new URL("../../App.tsx",import.meta.url),"utf8");
const start=source.indexOf("function EvmCompatibilityModal("),end=source.indexOf("return <Modal",start);
const handler=source.slice(start,end)+"return {simulate,edit,dismiss};}\n";
const hook=source.match(/function useOperationScope\([^\n]+/)![0];
function harness(){
  const operations=new WalletOperationLifecycle();operations.setAccount("original-account");
  const effects:Array<()=>void|(()=>void)>=[],cleanups:Array<()=>void>=[],calls:Array<{input:unknown;resolve:(value:unknown)=>void;reject:(error:Error)=>void;guard:()=>void}>=[];
  const values=["0x"+"2".repeat(40),"0x","0",false,false,null,null],state:unknown[]=[...values];let stateIndex=0,closed=0;
  const context={useWalletOperations:()=>operations,useMemo:(factory:()=>unknown)=>factory(),useRef:(value:unknown)=>({current:value}),useEffect:(effect:()=>void|(()=>void))=>effects.push(effect),useState:()=>{const index=stateIndex++;return[state[index],(value:unknown)=>{state[index]=value}]},evmAddressFromYNX:()=>"0x"+"1".repeat(40),message:(error:Error)=>error.message,
    evmSimulationClient:()=>({simulate:(input:unknown,guard:()=>void)=>new Promise((resolve,reject)=>calls.push({input,guard,resolve,reject}))}),setTimeout:()=>{},copyPublicValueWithExpiry:async()=>{},Clipboard:{}};
  const compiled=ts.transpileModule(hook+"\n"+handler+"\nreturn EvmCompatibilityModal({visible:true,account:{account:'original-account'},close:closeHandler});",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const handlers=new Function(...Object.keys(context),"closeHandler",compiled)(...Object.values(context),()=>{closed++});
  for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup)}
  return{operations,calls,state,handlers,closed:()=>closed,unmount:()=>cleanups.forEach(fn=>fn())};
}
test("actual EVM UI handler rejects synchronous duplicate clicks and snapshots reviewed input",async()=>{
  const h=harness(),pending=h.handlers.simulate();await h.handlers.simulate();assert.equal(h.calls.length,1);
  assert.deepEqual(h.calls[0]!.input,{from:"0x"+"1".repeat(40),to:"0x"+"2".repeat(40),data:"0x",valueWei:"0"});
  h.calls[0]!.resolve({truthfulStatus:"read-only-evm-simulation-no-sign-no-broadcast"});await pending;assert.equal((h.state[5] as any).truthfulStatus,"read-only-evm-simulation-no-sign-no-broadcast");assert.equal(h.state[3],false);h.unmount();
});
for(const boundary of ["lock","background","account","close","unmount"]){test(`actual EVM UI cannot display late success or error after ${boundary}`,async()=>{
  for(const thrown of [false,true]){const h=harness(),pending=h.handlers.simulate();
    if(boundary==="lock")h.operations.lock();if(boundary==="background")h.operations.setAppState("background");if(boundary==="account")h.operations.setAccount("other-account");if(boundary==="close")h.handlers.dismiss();if(boundary==="unmount")h.unmount();
    assert.equal(h.calls.length,1);if(thrown)h.calls[0]!.reject(Error("obsolete RPC error"));else h.calls[0]!.resolve({source:"obsolete RPC result"});await pending;
    assert.equal(h.state[5],null);assert.equal(h.state[6],null);if(boundary==="close")assert.equal(h.closed(),1);if(boundary!=="unmount")h.unmount();
  }
})}
test("editing and restarting EVM UI cannot let an old completion clear the newer busy state",async()=>{
  const h=harness(),old=h.handlers.simulate();h.handlers.edit(()=>{},"0x");const next=h.handlers.simulate();assert.equal(h.calls.length,2);
  h.calls[0]!.resolve({source:"old"});await old;assert.equal(h.state[3],true);assert.equal(h.state[5],null);
  h.calls[1]!.resolve({source:"new"});await next;assert.equal((h.state[5] as any).source,"new");assert.equal(h.state[3],false);h.unmount();
});

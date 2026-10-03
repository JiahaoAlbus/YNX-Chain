import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {WalletOperationLifecycle} from "../security/operationLifecycle";
import {ModalActionGate} from "./modalActionGate";
const source=readFileSync(new URL("../../App.tsx",import.meta.url),"utf8");
const hooks=["useOperationScope","useModalActionGate"].map(name=>source.match(new RegExp(`function ${name}\\([^\\n]+`))![0]).join("\n");
const names=["NativeTransferHistoryModal","WalletPayHistoryModal","WalletInvoiceReferenceModal"] as const;
function harness(name:typeof names[number],retained:any=null,initialRecords:any[]=[]){
  const start=source.indexOf(`function ${name}(`),end=source.indexOf("return <Modal",start);
  const body=source.slice(start,end)+`return {load,dismiss${name==="WalletPayHistoryModal"?",recover":""}};}\nreturn ${name}({account:{account:'original-account'},invoiceID:'controlled-invoice',close:closeHandler});`;
  const operations=new WalletOperationLifecycle();operations.setAccount("original-account");
  // Controlled lifecycle only; this does not bypass any device biometrics.
  const unlock=operations.scope().begin({requireUnlocked:false});operations.unlock(unlock);unlock.finish();
  const state:any[]=[],effects:Array<()=>void|(()=>void)>=[],cleanups:Array<()=>void>=[];
  const calls:Array<{kind:string;args:any[];resolve:(value:any)=>void;reject:(error:Error)=>void}>=[];let index=0;
  const read=(kind:string)=>(...args:any[])=>new Promise((resolve,reject)=>calls.push({kind,args,resolve,reject}));
  const context={ModalActionGate,useWalletOperations:()=>operations,useContext:()=>"en",WalletLocaleContext:{},
    useMemo:(factory:()=>unknown)=>factory(),useEffect:(effect:()=>void|(()=>void))=>effects.push(effect),
    useState:(initial:any)=>{const position=index++;state[position]=name==="WalletPayHistoryModal"&&position===5?retained:position===0&&name!=="WalletInvoiceReferenceModal"?initialRecords:initial;return[state[position],(value:any)=>{state[position]=typeof value==="function"?value(state[position]):value}]},
    nativeOutbox:{history:read("history")},walletPayFlow:{recovery:read("recovery"),history:read("receipts"),checkOriginal:read("check"),acknowledgeSettled:read("done")},
    WalletPayInvoiceClient:class{invoice=read("invoice")},chainClient:()=>({})};
  const compiled=ts.transpileModule(hooks+"\n"+body,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const handlers=new Function(...Object.keys(context),"closeHandler",compiled)(...Object.values(context),()=>{});
  // Execute the real scope and gate mount effects. History's last effect is
  // its auto-load; drive that same load handler explicitly to retain its promise.
  const mount=name==="WalletInvoiceReferenceModal"?effects:effects.slice(0,-1);
  for(const effect of mount){const cleanup=effect();if(cleanup)cleanups.push(cleanup)}
  return{handlers,operations,state,calls,unmount:()=>cleanups.forEach(fn=>fn())};
}
async function complete(h:ReturnType<typeof harness>,name:typeof names[number]){
  if(name==="WalletPayHistoryModal"){h.calls[0]!.resolve(null);await Promise.resolve();await Promise.resolve();h.calls[1]!.resolve({receipts:[],nextCursor:null});}
  else h.calls[0]!.resolve(name==="NativeTransferHistoryModal"?{records:[],nextCursor:null}:{id:"controlled-invoice"});
}
for(const name of names){
  test(`${name} actual handler prevents duplicate reads before React rerenders`,async()=>{
    const h=harness(name),pending=h.handlers.load(false);await h.handlers.load(false);assert.equal(h.calls.length,1);
    await complete(h,name);await pending;assert.equal(h.state[name==="WalletInvoiceReferenceModal"?1:3],false);h.unmount();
  });
  for(const boundary of ["lock","account","background","close","unmount"]){
    test(`${name} late results/errors are fenced after ${boundary}`,async()=>{
      for(const fail of [false,true]){
        const h=harness(name),pending=h.handlers.load(false);
        if(boundary==="lock")h.operations.lock();if(boundary==="account")h.operations.setAccount("other-account");
        if(boundary==="background")h.operations.setAppState("background");if(boundary==="close")h.handlers.dismiss();if(boundary==="unmount")h.unmount();
        const before=[...h.state];if(fail)h.calls[0]!.reject(Error("obsolete error"));else h.calls[0]!.resolve({obsolete:true});
        await pending;assert.deepEqual(h.state,before);assert.equal(h.calls.length,1);
        if(boundary==="close"||boundary==="unmount"){await h.handlers.load(false);assert.equal(h.calls.length,1);assert.deepEqual(h.state,before);}
        if(boundary!=="unmount")h.unmount();
      }
    });
  }
}
test("receipt check and archive share the read single-flight gate",async()=>{
  for(const mode of ["check","done"]){
    const h=harness("WalletPayHistoryModal",{hash:"controlled-hash",actions:["check","done"]});
    const pending=h.handlers.recover(mode);await h.handlers.recover(mode);await h.handlers.load(false);
    assert.equal(h.calls.length,1);assert.equal(h.calls[0]!.kind,mode);
    h.handlers.dismiss();h.calls[0]!.resolve(null);await pending;assert.equal(h.calls.length,1);h.unmount();
  }
});
test("Pay receipt page returning after account change cannot append or replace retained records",async()=>{
  const h=harness("WalletPayHistoryModal"),pending=h.handlers.load(false);
  h.calls[0]!.resolve(null);await Promise.resolve();assert.equal(h.calls.length,2);
  h.operations.setAccount("other-account");const before=[...h.state];
  h.calls[1]!.resolve({receipts:[{binding:{hash:"obsolete"}}],nextCursor:"obsolete"});await pending;
  assert.deepEqual(h.state,before);h.unmount();
});
test("repeated Pay receipt page is rejected without duplicating the original receipt",async()=>{
  const saved={binding:{hash:"original"}},h=harness("WalletPayHistoryModal",null,[saved]),pending=h.handlers.load(true);
  h.calls[0]!.resolve(null);await Promise.resolve();h.calls[1]!.resolve({receipts:[saved],nextCursor:"original"});await pending;
  assert.deepEqual(h.state[0],[saved]);assert.match(h.state[4],/could not be verified/);assert.equal(h.state[3],false);h.unmount();
});
for(const name of names)test(`${name} releases a failed action for an explicit retry`,async()=>{
  const h=harness(name),first=h.handlers.load(false);h.calls[0]!.reject(Error("read unavailable"));await first;
  const next=h.handlers.load(false);assert.equal(h.calls.length,2);h.handlers.dismiss();h.calls[1]!.resolve(null);await next;h.unmount();
});

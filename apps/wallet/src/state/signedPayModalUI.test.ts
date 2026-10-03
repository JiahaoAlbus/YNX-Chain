import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {canonicalJSON,parseProductSession} from "@ynx-chain/wallet-auth";
import {signedPayFixture} from "../security/signedPayTestFixture";
import {assertSignedPaySessionBinding,assertSignedPayExpectedPayer} from "../security/prepareSignedPayTransfer";
import {verifyWalletPayQuote} from "../chain/walletPayQuote";
import {ModalActionGate} from "./modalActionGate";
const source=readFileSync(new URL("../../App.tsx",import.meta.url),"utf8");
const hooks=["useOperationScope","useModalActionGate"].map(name=>source.match(new RegExp(`function ${name}\\([^\\n]+`))![0]).join("\n");
function harness(invoiceID?:string){
  const f=signedPayFixture(),slots:any[]=[],states:any[]=[],effects:any[]=[],cleanups=new Map<number,()=>void>();let index=0,closed=false;
  const calls:string[]=[],pending:Array<{resolve:(value:any)=>void;reject:(error:Error)=>void}>=[];
  const integration={policy:f.input.policy,getQuote:async()=>{calls.push("quote");return new Promise((resolve,reject)=>pending.push({resolve,reject}))},getSettlementTransport:async()=>{calls.push("transport");return {}}};
  let activeIntegration=integration;
  const same=(a:any[],b:any[])=>a&&a.length===b.length&&a.every((value,i)=>value===b[i]);
  const context={ModalActionGate,useWalletOperations:()=>f.operations,useContext:()=>"en",WalletLocaleContext:{},
    useMemo:(factory:()=>any,deps:any[])=>{const i=index++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:factory()};return slots[i].value},
    useRef:(initial:any)=>{const i=index++;return slots[i]??(slots[i]={current:initial})},
    useState:(initial:any)=>{const i=index++;if(!slots[i]){slots[i]={value:initial};states.push(i)}return [slots[i].value,(value:any)=>slots[i].value=typeof value==="function"?value(slots[i].value):value]},
    useEffect:(effect:any,deps:any[])=>{const i=index++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]={deps};effects.push({i,effect})}},
    Date:class extends Date{static now(){return f.input.now()}},setInterval:()=>1,clearInterval:()=>{},
    walletSignedPayFlow:{recovery:async()=>null,history:async()=>({receipts:[],nextCursor:null}),payReviewed:async(input:any)=>{calls.push("pay");input.lease.assert();assert.equal(input.reviewedIntentDigest,f.input.reviewedIntentDigest)}},
    walletPayFlow:{read:async()=>null},verifyWalletPayQuote:(invoice:unknown,intent:unknown,policy:any,guard:()=>void)=>verifyWalletPayQuote(invoice,intent,policy,guard,f.input.now()),assertSignedPaySessionBinding,assertSignedPayExpectedPayer,canonicalJSON,parseProductSession,
    chainClient:()=>f.client,repository:f.repository,authorizeLocalKeyUse:async()=>{calls.push("authorize")},message:(error:Error)=>error.message};
  const start=source.indexOf("function WalletSignedPayModal("),end=source.indexOf("return <Modal",start);
  const code=ts.transpileModule(hooks+"\n"+source.slice(start,end)+"return {loadQuote,approve,readSaved,recover,dismiss};}\nreturn WalletSignedPayModal(props);",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const fn=new Function(...Object.keys(context),"props",code);
  const render=()=>{index=0;effects.length=0;const handlers=fn(...Object.values(context),{account:{account:f.input.review.account,accountPublicKey:f.input.review.accountPublicKey},invoiceID:invoiceID??f.input.rawInvoice.id,integration:activeIntegration,close:()=>{closed=true}});
    // Drive the actual read handler explicitly; all other lifecycle effects run.
    for(const {i,effect} of effects.slice(0,-1)){cleanups.get(i)?.();const cleanup=effect();if(cleanup)cleanups.set(i,cleanup)}return handlers};
  let handlers=render();
  return {f,calls,pending,get handlers(){return handlers},render:()=>{handlers=render()},replaceIntegration:()=>{activeIntegration={...integration};handlers=render()},state:()=>states.map(i=>slots[i].value),unmount:()=>cleanups.forEach(fn=>fn()),closed:()=>closed,
    quote:()=>({invoice:f.input.rawInvoice,intent:f.input.rawIntent,authority:f.authority})};
}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
test("actual signed modal requires a separate exact review and approval; duplicate clicks cannot dispatch twice",async()=>{
  const h=harness();assert.deepEqual(h.calls,[]);const read=h.handlers.loadQuote();await tick();await h.handlers.loadQuote();assert.deepEqual(h.calls,["quote"]);
  h.pending[0]!.resolve(h.quote());await read;assert.deepEqual(h.calls,["quote"]);h.render();
  const approve=h.handlers.approve();await h.handlers.approve();await approve;assert.deepEqual(h.calls,["quote","pay"]);h.unmount();
});
for(const boundary of ["lock","account","background","close","unmount","integration"]){
  test(`actual signed modal rejects late quote after ${boundary}`,async()=>{
    const h=harness(),read=h.handlers.loadQuote();await tick();
    if(boundary==="lock")h.f.operations.lock();if(boundary==="account")h.f.operations.setAccount("different-account");if(boundary==="background")h.f.operations.setAppState("background");
    if(boundary==="close")h.handlers.dismiss();if(boundary==="unmount")h.unmount();if(boundary==="integration")h.replaceIntegration();
    h.pending[0]!.resolve(h.quote());await read;h.render();await h.handlers.approve();assert.deepEqual(h.calls,["quote"]);assert.equal(h.state()[0],null);h.unmount();
  });
}
test("actual signed modal rejects invalid reference before transport and changed session before approval",async()=>{
  const invalid=harness("inv_wrong");await invalid.handlers.loadQuote();assert.deepEqual(invalid.calls,[]);invalid.unmount();
  const h=harness(),read=h.handlers.loadQuote();await tick();h.pending[0]!.resolve(h.quote());await read;h.render();
  h.f.authority.session=h.f.parsedSession({nonce:"x".repeat(32)});await h.handlers.approve();assert.deepEqual(h.calls,["quote"]);h.unmount();
});

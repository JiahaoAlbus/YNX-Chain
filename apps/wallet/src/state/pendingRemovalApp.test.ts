import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {WalletOperationLifecycle} from "../security/operationLifecycle";
import {PendingRemovalRetryController} from "../security/pendingRemovalRetry";
import {pendingRemovalCopy} from "../i18n/pendingRemovalCopy";
import {SUPPORTED_LOCALES,type WalletLocale} from "../i18n/i18n";

// Execute the actual App review/confirm callbacks, not an alternative UI.
// Native Alert, authentication and public repository result are controlled.
const source=readFileSync(new URL("../../App.tsx",import.meta.url),"utf8");
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve}}
const flush=async()=>{for(let i=0;i<4;i++)await new Promise<void>(r=>setImmediate(r))};
function harness(locale:WalletLocale="en"){
  let now=0;
  const operations=new WalletOperationLifecycle(()=>now);operations.setAccount("original");
  const rootScope=operations.scope(),events:string[]=[],state={busy:false,error:null as string|null,settings:true,notice:null as string|null,manifest:null as unknown};
  let auth=async()=>{},read=async(_guard:()=>void):Promise<unknown>=>({schemaVersion:2,selectedAccountId:"original",accounts:[]});
  const controller=new PendingRemovalRetryController(rootScope,{retryPendingDeletions:async guard=>{events.push("retry");guard();return read(guard)}},async()=>{events.push("authenticate");await auth()});
  const dialogs:Array<{title:string;body:string;buttons:Array<{onPress:()=>void}>;options:unknown}>=[];
  const context={pendingRemovalRetry:controller,pendingRemovalCopy,rootScope,operations,locale,busy:false,appearanceBusy:false,corruptReset:{active:()=>false},readyRef:{current:true},
    setBusy:(v:boolean)=>{state.busy=v},setError:(v:string|null)=>{state.error=v},setSettings:(v:boolean)=>{state.settings=v},setNotice:(v:string)=>{state.notice=v},
    updateManifest:(v:unknown,preserve:boolean)=>{events.push("publish");assert.equal(preserve,true);state.manifest=v;operations.invalidate()},
    localizeError:(_locale:string,error:Error)=>error.message,translate:()=>"Close",
    Alert:{alert:(title:string,body:string,buttons:any,options:unknown)=>dialogs.push({title,body,buttons,options})},
    useEffect:(effect:()=>void|(()=>void))=>effect()};
  const start=source.indexOf("  const reviewPendingRemovals=()=>{"),end=source.indexOf("  const reviewReset=",start);
  assert.ok(start>=0&&end>start,"actual reviewed retry entry exists");
  const subscription=source.match(/  useEffect\(\(\)=>\{const unsubscribe=operations\.subscribe\(\(\)=>pendingRemovalRetry\.cancel\(\)\);[^\n]+/)![0];
  assert.ok(subscription,"actual lifecycle cancellation subscription exists");
  const compiled=ts.transpileModule(subscription+"\n"+source.slice(start,end)+"\nreturn reviewPendingRemovals",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const review=new Function("context","with(context){"+compiled+"}")(context);
  return{review,controller,operations,rootScope,context,state,events,dialogs,authorize:(fn:()=>Promise<void>)=>{auth=fn},read:(fn:(guard:()=>void)=>Promise<unknown>)=>{read=fn},expire:()=>{now=120000},confirm:(index=dialogs.length-1)=>dialogs[index]!.buttons[1]!.onPress(),cancel:(index=dialogs.length-1)=>dialogs[index]!.buttons[0]!.onPress()};
}
test("actual settings review/cancel never opens the deletion journal or authenticates",()=>{
  const h=harness();assert.deepEqual(h.events,[]);h.review();assert.deepEqual(h.events,[]);assert.equal(h.state.busy,true);assert.deepEqual(h.dialogs[0]!.options,{cancelable:false});h.cancel();assert.equal(h.state.busy,false);assert.equal(h.controller.active(),false);assert.deepEqual(h.events,[]);
});
test("actual confirmed entry publishes only after original authentication and guarded repository result",async()=>{
  const h=harness(),result=Object.freeze({schemaVersion:2,selectedAccountId:"original",accounts:[]});h.read(async guard=>{guard();return result});h.review();h.confirm();await flush();
  assert.deepEqual(h.events,["authenticate","retry","publish"]);assert.equal(h.state.manifest,result);assert.equal(h.state.notice,pendingRemovalCopy("en").finished);assert.equal(h.state.busy,false);assert.equal(h.state.settings,false);assert.equal(h.controller.active(),false);
});
test("a duplicate native confirm callback cannot cancel the original in-flight retry",async()=>{
  const h=harness(),wait=deferred<void>();h.authorize(()=>wait.promise);h.review();h.confirm();h.confirm();await flush();
  assert.equal(h.controller.active(),true);assert.equal(h.state.busy,true);assert.equal(h.state.error,null);assert.deepEqual(h.events,["authenticate"]);
  wait.resolve();await flush();assert.deepEqual(h.events,["authenticate","retry","publish"]);assert.equal(h.state.notice,pendingRemovalCopy("en").finished);
});
for(const boundary of ["account","background","expired","cancel"] as const)test(`${boundary} during authentication prevents journal access and late successful UI`,async()=>{
  const h=harness(),wait=deferred<void>();h.authorize(()=>wait.promise);h.review();h.confirm();
  if(boundary==="account")h.operations.setAccount("other");if(boundary==="background")h.operations.setAppState("background");if(boundary==="expired")h.expire();if(boundary==="cancel")h.cancel();
  const before={...h.state};wait.resolve();await flush();assert.deepEqual(h.events,["authenticate"]);assert.equal(h.state.notice,null);assert.equal(h.state.manifest,null);
  // Other App lifecycle handlers own busy reset on account/background events.
  assert.equal(h.state.error,before.error);assert.equal(h.state.settings,before.settings);
});
for(const boundary of ["account","background","expired","cancel"] as const)test(`${boundary} after journal entry keeps a late result from publishing success`,async()=>{
  const h=harness(),wait=deferred<unknown>();h.read(()=>wait.promise);h.review();h.confirm();await flush();assert.deepEqual(h.events,["authenticate","retry"]);
  if(boundary==="account")h.operations.setAccount("other");if(boundary==="background")h.operations.setAppState("background");if(boundary==="expired")h.expire();if(boundary==="cancel")h.cancel();
  wait.resolve({schemaVersion:2,accounts:[]});await flush();assert.deepEqual(h.events,["authenticate","retry"]);assert.equal(h.state.notice,null);assert.equal(h.state.manifest,null);
});
test("old cancelled callbacks cannot act on or clear a reopened review",async()=>{
  const h=harness(),wait=deferred<void>();h.authorize(()=>wait.promise);h.review();h.confirm();h.cancel();h.review();
  const current=h.controller.active();h.confirm(0);h.cancel(0);wait.resolve();await flush();assert.equal(h.controller.active(),current);assert.equal(h.state.busy,true);assert.equal(h.state.error,null);assert.deepEqual(h.events,["authenticate"]);h.cancel();
});
test("an original journal readback error is visible and cannot automatically start another mutation",async()=>{
  const h=harness();h.read(async()=>{throw Error("Original deletion journal readback uncertain")});h.review();h.confirm();await flush();assert.match(h.state.error!,/readback uncertain/);assert.equal(h.state.notice,null);assert.equal(h.state.busy,false);assert.equal(h.controller.active(),false);h.confirm();await flush();assert.deepEqual(h.events,["authenticate","retry"]);
});
test("original authentication refusal never opens the journal",async()=>{
  const h=harness();h.authorize(async()=>{throw Error("Original OS authorization cancelled")});h.review();h.confirm();await flush();assert.deepEqual(h.events,["authenticate"]);assert.match(h.state.error!,/authorization cancelled/);assert.equal(h.state.notice,null);assert.equal(h.state.busy,false);
});
test("readiness and existing operations prevent even a review dialog",()=>{
  for(const key of ["busy","appearanceBusy","ready"] as const){const h=harness();if(key==="ready")h.context.readyRef.current=false;else h.context[key]=true;h.review();assert.equal(h.dialogs.length,0);assert.deepEqual(h.events,[])}
  const h=harness(),lease=h.rootScope.begin({requireUnlocked:false});h.review();assert.equal(h.dialogs.length,0);assert.deepEqual(h.events,[]);lease.finish();
});
test("all twelve actual review and completion callbacks use the selected locale",async()=>{
  for(const locale of SUPPORTED_LOCALES){const h=harness(locale),copy=pendingRemovalCopy(locale);h.review();assert.equal(h.dialogs[0]!.title,copy.title);assert.equal(h.dialogs[0]!.body,copy.body);h.confirm();await flush();assert.equal(h.state.notice,copy.finished)}
  assert.throws(()=>pendingRemovalCopy("unknown" as WalletLocale),/Unsupported/);
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {parseWalletScan} from "./walletScan";
import {walletIdentity} from "@ynx-chain/wallet-auth";
import type {WalletScanResult} from "./walletScan";
import {WalletOperationLifecycle} from "../security/operationLifecycle";
import {WalletScanSession} from "./walletScanSession";
const source=readFileSync(new URL("./WalletScanner.tsx",import.meta.url),"utf8"),start=source.indexOf("export function WalletScanner("),end=source.indexOf("return <Modal",start);
const handler=source.slice(start,end).replace("export function","function")+"return {allowCamera,dismiss,cameraMountError,retryCamera,scanAgain,scanBarcode,cameraLive,cameraRevision};}\nreturn WalletScanner({locale:'en',accept:acceptHandler,close:closeHandler});";
function harness(granted=false,accept:(value:WalletScanResult)=>void=()=>{},initialAppState="active"){
  const state:unknown[]=[],refs:Array<{current:unknown}>=[],effects:Array<()=>void|(()=>void)>=[],cleanups:Array<()=>void>=[];let index=0,refIndex=0,calls=0,closed=0,mounted=false,resolve!:(value:unknown)=>void,reject!:(error:Error)=>void;
  const permission={granted,canAskAgain:true};
  const appState={currentState:initialAppState,listener:null as null|((state:string)=>void),addEventListener:(_event:string,listener:(state:string)=>void)=>{appState.listener=listener;return{remove:()=>{appState.listener=null}}}};
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no}),context={useMemo:(factory:()=>unknown)=>factory(),createStyles:()=>({}),isRTL:()=>false,useRef:(value:unknown)=>{const position=refIndex++;return refs[position]??(refs[position]={current:value})},useState:(initial:unknown)=>{const position=index++;if(!(position in state))state[position]=initial;return[state[position],(value:unknown)=>{state[position]=value}]},useEffect:(effect:()=>void|(()=>void))=>{if(!mounted)effects.push(effect)},useCameraPermissions:()=>[permission,()=>{calls++;return pending}],scannerCopy:()=>"",parseWalletScan};
  const compiled=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const invoke=new Function(...Object.keys(context),"AppState","closeHandler","acceptHandler",compiled);
  const render=()=>{index=0;refIndex=0;return invoke(...Object.values(context),appState,()=>{closed++},accept)};
  const ui=render();for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup)}mounted=true;
  return{ui,state,permission,render,resolve,reject,calls:()=>calls,closed:()=>closed,appState,transition:(next:string)=>{appState.currentState=next;appState.listener?.(next)},unmount:()=>cleanups.forEach(cleanup=>cleanup())};
}

test("inactive scanner retires native frames and resumes only with a fresh camera",()=>{
  const routed:WalletScanResult[]=[];const h=harness(true,value=>routed.push(value)),old=h.ui;
  h.transition("inactive");const paused=h.render();assert.equal(paused.cameraLive,false);
  old.scanBarcode(nativeAddress);old.cameraMountError();assert.equal(routed.length,0);
  h.transition("active");const fresh=h.render();assert.equal(fresh.cameraLive,true);
  old.scanBarcode(nativeAddress);paused.scanBarcode(nativeAddress);assert.equal(routed.length,0);
  fresh.scanBarcode(nativeAddress);assert.equal(routed.length,1);
});
test("background closes the scanner once and foreground cannot revive its frames or permission actions",async()=>{
  const h=harness(true,()=>assert.fail("background scanner routed")),old=h.ui;
  h.transition("background");h.transition("background");assert.equal(h.closed(),1);
  h.transition("active");old.scanBarcode(nativeAddress);old.cameraMountError();await old.allowCamera();
  assert.equal(h.render().cameraLive,false);assert.equal(h.calls(),0);
  h.unmount();assert.equal(h.appState.listener,null);
});
test("current OS state fences input even before the change listener runs",async()=>{
  const h=harness(true,()=>assert.fail("inactive frame routed"));h.appState.currentState="inactive";
  h.ui.scanBarcode(nativeAddress);h.ui.cameraMountError();assert.equal(h.state[1],false);
  const asking=harness(false);asking.appState.currentState="inactive";asking.resolve({granted:false});await asking.ui.allowCamera();assert.equal(asking.calls(),0);
});
test("permission prompt may resume but its old rejection cannot publish after an inactive epoch",async()=>{
  const h=harness(false),pending=h.ui.allowCamera();h.transition("inactive");h.transition("active");
  h.reject(Error("old permission failure"));await pending;
  assert.equal(h.state[2],false);assert.equal(h.state[3],false);
});
test("permission granted while inactive cannot start a camera until active; old frames remain retired",async()=>{
  const routed:WalletScanResult[]=[];const h=harness(false,value=>routed.push(value)),pending=h.ui.allowCamera();
  h.transition("inactive");h.permission.granted=true;h.resolve({granted:true});await pending;
  const paused=h.render();assert.equal(paused.cameraLive,false);
  h.transition("active");const fresh=h.render();assert.equal(fresh.cameraLive,true);
  paused.scanBarcode(nativeAddress);assert.equal(routed.length,0);fresh.scanBarcode(nativeAddress);assert.equal(routed.length,1);
});
test("background during permission request closes input and discards the late permission failure",async()=>{
  const h=harness(false),pending=h.ui.allowCamera();h.transition("background");const before=[...h.state];
  h.reject(Error("late background failure"));await pending;assert.deepEqual(h.state,before);
  h.transition("active");assert.equal(h.render().cameraLive,false);assert.equal(h.closed(),1);
});
for(const initial of ["inactive","background"])test(`scanner mounted ${initial} never starts a hardware camera`,()=>{
  const h=harness(true,()=>assert.fail("inactive input"),initial);assert.equal(h.ui.cameraLive,false);
  h.ui.scanBarcode(nativeAddress);
  h.transition("active");assert.equal(h.render().cameraLive,initial==="inactive");
  assert.equal(h.closed(),initial==="background"?1:0);
});
test("real account scan session plus camera retirement cannot route an old account frame after background and account switch",()=>{
  const operations=new WalletOperationLifecycle();operations.setAccount("account-a");
  const unlock=()=>{const lease=operations.scope().begin({requireUnlocked:false});operations.unlock(lease);lease.finish()};unlock();
  const session=new WalletScanSession(operations);session.open("account-a");let routed=0;
  const old=harness(true,result=>{session.accept(result,()=>routed++)});
  operations.setAppState("background");old.transition("background");session.cancel();
  operations.setAppState("active");operations.setAccount("account-b");unlock();session.open("account-b");
  const fresh=harness(true,result=>{session.accept(result,()=>routed++)});old.transition("active");old.ui.scanBarcode(nativeAddress);
  assert.equal(routed,0);fresh.ui.scanBarcode(nativeAddress);assert.equal(routed,1);fresh.ui.scanBarcode(nativeAddress);assert.equal(routed,1);
});
test("actual scanner permission handler rejects synchronous duplicate activation",async()=>{const h=harness(),first=h.ui.allowCamera(),second=h.ui.allowCamera();assert.equal(h.calls(),1);h.resolve({granted:true});await Promise.all([first,second]);assert.equal(h.state[3],false);h.unmount()});
for(const boundary of ["dismiss","unmount"]){test(`closed scanner cannot begin a new permission request or publish late denial after ${boundary}`,async()=>{const h=harness(),pending=h.ui.allowCamera();if(boundary==="dismiss")h.ui.dismiss();else h.unmount();await h.ui.allowCamera();assert.equal(h.calls(),1);const before=[...h.state];h.reject(Error("permission unavailable"));await pending;assert.deepEqual(h.state,before);if(boundary==="dismiss")assert.equal(h.closed(),1)})}

const nativeAddress=walletIdentity("01".padStart(64,"0")).account;
test("actual camera handler routes one production-parsed native address and stops scanning before navigation",()=>{
  const routed:WalletScanResult[]=[];const h=harness(true,value=>routed.push(value));
  h.ui.scanBarcode(nativeAddress);h.ui.scanBarcode(nativeAddress);h.ui.cameraMountError();
  assert.deepEqual(routed,[parseWalletScan(nativeAddress)]);assert.equal(h.render().cameraLive,false);
  assert.equal(h.state[0],false);assert.equal(h.state[1],false);
});

test("camera mount failure fences queued frames and duplicate errors; explicit retry remounts a new camera",()=>{
  const routed:WalletScanResult[]=[];const h=harness(true,value=>routed.push(value)),old=h.ui;
  old.cameraMountError();old.scanBarcode(nativeAddress);old.cameraMountError();assert.equal(routed.length,0);
  const failed=h.render();assert.equal(failed.cameraLive,false);assert.equal(h.state[1],true);
  failed.retryCamera();failed.retryCamera();const fresh=h.render();assert.equal(fresh.cameraLive,true);assert.equal(fresh.cameraRevision,2);
  old.scanBarcode(nativeAddress);old.cameraMountError();assert.equal(h.state[1],false);assert.equal(routed.length,0);
  fresh.scanBarcode(nativeAddress);assert.equal(routed.length,1);
});

test("invalid code stops camera; Scan again rejects old frames while the new camera accepts a Pay reference",()=>{
  const routed:WalletScanResult[]=[];const h=harness(true,value=>routed.push(value)),old=h.ui;
  old.scanBarcode("https://untrusted.example");assert.equal(h.state[0],true);assert.equal(h.render().cameraLive,false);
  const failed=h.render();failed.scanAgain();failed.scanAgain();const fresh=h.render();assert.equal(fresh.cameraRevision,2);
  old.scanBarcode(nativeAddress);old.cameraMountError();assert.equal(routed.length,0);assert.equal(h.state[1],false);
  fresh.scanBarcode("ynxpay://invoice/invoice-001");assert.deepEqual(routed,[{kind:"invoice",invoiceID:"invoice-001"}]);
});

test("recognized routing failure is not reported as invalid QR and never automatically reroutes",()=>{
  let calls=0;const h=harness(true,()=>{calls++;throw Error("route unavailable")});h.ui.scanBarcode(nativeAddress);
  assert.equal(h.state[0],false);assert.equal(h.state[4],true);assert.equal(h.render().cameraLive,false);
  h.ui.scanBarcode(nativeAddress);assert.equal(calls,1);
  const failed=h.render();failed.scanAgain();assert.equal(h.state[4],false);h.render().scanBarcode(nativeAddress);assert.equal(calls,2);
});

test("revoked permission invalidates a granted camera callback before effect cleanup and reenrollment cannot revive it",()=>{
  const routed:WalletScanResult[]=[];const h=harness(true,value=>routed.push(value)),old=h.ui;
  h.permission.granted=false;assert.equal(h.render().cameraLive,false);old.scanBarcode(nativeAddress);old.cameraMountError();
  h.permission.granted=true;const fresh=h.render();old.scanBarcode(nativeAddress);assert.equal(routed.length,0);
  fresh.scanBarcode(nativeAddress);assert.equal(routed.length,1);
});

for(const boundary of ["granted","permanently-denied"] as const)test(`queued permission button cannot ask again after permission became ${boundary}`,async()=>{
  const h=harness(false),old=h.ui;
  if(boundary==="granted")h.permission.granted=true;else h.permission.canAskAgain=false;
  const current=h.render();await old.allowCamera();await current.allowCamera();assert.equal(h.calls(),0);
});

test("late permission failure cannot replace the already-granted camera state",async()=>{
  const h=harness(false),pending=h.ui.allowCamera();h.permission.granted=true;const granted=h.render();
  h.reject(Error("late permission failure"));await pending;
  assert.equal(h.state[2],false);assert.equal(h.state[3],false);assert.equal(granted.cameraLive,true);
});

for(const boundary of ["dismiss","unmount"] as const)test(`late QR frame and retry actions after ${boundary} cannot mutate state or route into a reopened scanner`,()=>{
  let oldRoutes=0,newRoutes=0;const old=harness(true,()=>oldRoutes++);
  old.ui.scanBarcode("https://untrusted.example");const failed=old.render();
  if(boundary==="dismiss")failed.dismiss();else old.unmount();
  const before=[...old.state],fresh=harness(true,()=>newRoutes++);
  failed.scanAgain();failed.retryCamera();old.ui.scanBarcode(nativeAddress);old.ui.cameraMountError();
  assert.deepEqual(old.state,before);assert.equal(oldRoutes,0);fresh.ui.scanBarcode(nativeAddress);assert.equal(newRoutes,1);
});

test("cancel is synchronous and idempotent; no handler routes while camera permission is absent",()=>{
  let routed=0;const h=harness(false,()=>routed++);h.ui.scanBarcode(nativeAddress);h.ui.cameraMountError();
  assert.equal(routed,0);assert.equal(h.state[1],false);h.ui.dismiss();h.ui.dismiss();assert.equal(h.closed(),1);
});

test("actual JSX uses the guarded handlers and unmounts the hardware camera when stopped",()=>{
  assert.match(source,/cameraLive\?<CameraView key=\{cameraRevision\}/);
  assert.match(source,/onMountError=\{cameraMountError\}/);
  assert.match(source,/onBarcodeScanned=\{\(\{data\}\)=>scanBarcode\(data\)\}/);
  assert.match(source,/onPress=\{retryCamera\}/);assert.match(source,/onPress=\{scanAgain\}/);
  assert.match(source,/routeFailed\?"routeFailure":"invalid"/);
});

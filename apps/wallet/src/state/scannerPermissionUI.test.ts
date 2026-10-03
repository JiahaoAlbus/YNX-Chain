import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {parseWalletScan} from "./walletScan";
import {walletIdentity} from "@ynx-chain/wallet-auth";
import type {WalletScanResult} from "./walletScan";
const source=readFileSync(new URL("./WalletScanner.tsx",import.meta.url),"utf8"),start=source.indexOf("export function WalletScanner("),end=source.indexOf("return <Modal",start);
const handler=source.slice(start,end).replace("export function","function")+"return {allowCamera,dismiss,cameraMountError,retryCamera,scanAgain,scanBarcode,cameraLive,cameraRevision};}\nreturn WalletScanner({locale:'en',accept:acceptHandler,close:closeHandler});";
function harness(granted=false,accept:(value:WalletScanResult)=>void=()=>{}){
  const state:unknown[]=[],refs:Array<{current:unknown}>=[],effects:Array<()=>void|(()=>void)>=[],cleanups:Array<()=>void>=[];let index=0,refIndex=0,calls=0,closed=0,mounted=false,resolve!:(value:unknown)=>void,reject!:(error:Error)=>void;
  const permission={granted,canAskAgain:true};
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no}),context={useMemo:(factory:()=>unknown)=>factory(),createStyles:()=>({}),isRTL:()=>false,useRef:(value:unknown)=>{const position=refIndex++;return refs[position]??(refs[position]={current:value})},useState:(initial:unknown)=>{const position=index++;if(!(position in state))state[position]=initial;return[state[position],(value:unknown)=>{state[position]=value}]},useEffect:(effect:()=>void|(()=>void))=>{if(!mounted)effects.push(effect)},useCameraPermissions:()=>[permission,()=>{calls++;return pending}],scannerCopy:()=>"",parseWalletScan};
  const compiled=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const invoke=new Function(...Object.keys(context),"closeHandler","acceptHandler",compiled);
  const render=()=>{index=0;refIndex=0;return invoke(...Object.values(context),()=>{closed++},accept)};
  const ui=render();for(const effect of effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup)}mounted=true;
  return{ui,state,permission,render,resolve,reject,calls:()=>calls,closed:()=>closed,unmount:()=>cleanups.forEach(cleanup=>cleanup())};
}
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

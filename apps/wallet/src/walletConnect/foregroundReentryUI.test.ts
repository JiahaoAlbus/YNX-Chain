import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {WalletConnectViewOperations} from "./viewOperations";
const source=readFileSync(process.env.YNX_NATIVE_CONNECT_SOURCE??new URL("./WalletConnectModal.tsx",import.meta.url),"utf8");
const body=source.slice(source.indexOf("  const [snapshot, setSnapshot]"),source.indexOf("  return <Modal"));
const scanStart=source.indexOf('onPress={()=>{if(scanCurrent()&&AppState.currentState==="active")');
assert.notEqual(scanStart,-1);
const scan=source.slice(scanStart+"onPress={".length,source.indexOf("} style=",scanStart));
const scannerStart=source.indexOf("<WalletScanner key=");
const acceptStart=source.indexOf("accept={",scannerStart)+"accept={".length;
const accept=source.slice(acceptStart,source.indexOf("}/>",acceptStart));
const code=ts.transpileModule(`function render(){${body}\nreturn {scanCurrent,press:${scan},accept:${accept},viewOperations,scanning,uri,busy,restored,broadcast,requestReview,pair,cancelPair,closeSheet,startViewOperation,disconnect,rejectProposal,approveProposal,decideRequest,checkBroadcast,retryBroadcast,acknowledgeBroadcast,retryConnection};}\nglobalThis.render=render;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
// Minimal hook scheduler: equal state writes do not render; effects rerun only
// when their actual dependency arrays change. No SDK, React Native or camera.
function fixture(initialState="active",request:any=null){
 let cursor=0,dirty=true,current:any;const slots:any[]=[],effects:Array<()=>void>=[];
 const listeners=new Set<(state:string)=>void>();let restoreCalls=0,readCalls=0,reconcileCalls=0,pairCalls=0,cancelCalls=0,closeCalls=0;
 const snapshot={phase:"ready",sessions:[],request,proposal:null};
 const context:any={WalletConnectViewOperations,configError:null,account:{account:"account-a"},locale:"en",inbound:null,
  AppState:{currentState:initialState,addEventListener:(_name:string,fn:(state:string)=>void)=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)}}},
  useState:(init:any)=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof init==="function"?init():init};return[slots[i].value,(update:any)=>{const next=typeof update==="function"?update(slots[i].value):update;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}}]},
  useRef:(value:any)=>{const i=cursor++;if(!slots[i])slots[i]={current:value};return slots[i]},
  useMemo:(fn:any,deps:any[])=>{const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))slots[i]={value:fn(),deps};return slots[i].value},
  useEffect:(fn:any,deps:any[])=>{const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn()})}},
  evmAddressFromYNX:(a:string)=>a,clearInbound(){},message:(e:any)=>e.message,close:()=>{closeCalls++},parseWalletConnectPairingUri(){},
  walletConnectRuntime:{snapshot:()=>snapshot,subscribe:()=>()=>{},restore:async()=>{restoreCalls++},cancelPendingPair(){},pair:async()=>{pairCalls++},cancelPair:()=>{cancelCalls++}},
  walletConnectNativeOutbox:{read:async()=>{readCalls++;return null}},broadcastJournal:{read:async()=>null},
  securityStore:{reconcileActiveSessions:async(_s:any,_a:any,guard:any)=>{guard();reconcileCalls++;return{disconnectTopics:[],prunedTopics:[]}}},
 };
 runInNewContext(code,context);
 async function flush(){for(let i=0;i<12;i++){if(dirty){dirty=false;cursor=0;current=context.render();while(effects.length)effects.shift()!();}await new Promise(resolve=>setImmediate(resolve));if(!dirty&&!effects.length)return;}throw Error("hook fixture did not settle")}
 return{flush,context,view:()=>current,counts:()=>({restoreCalls,readCalls,reconcileCalls,pairCalls,cancelCalls,closeCalls}),transition(state:string){context.AppState.currentState=state;for(const fn of listeners)fn(state)},account(value:string){context.account={account:value};dirty=true},unmount(){for(const s of slots)s?.cleanup?.();listeners.clear();dirty=false;}};
}
test("idle background to foreground renders a fresh enabled Scan without reviving its old callback",async()=>{
 const h=fixture();await h.flush();const old=h.view();assert.equal(old.busy,false);assert.equal(old.scanning,false);assert.equal(old.uri,"");
 h.transition("background");await h.flush();h.transition("active");await h.flush();old.press();await h.flush();assert.equal(h.view().scanning,false);
 h.view().press();await h.flush();assert.equal(h.view().scanning,true);assert.equal(old.scanCurrent(),false);
});
test("foreground refresh restarts original-record, restore and session projection effects",async()=>{
 const h=fixture();await h.flush();const before=h.counts();h.transition("background");await h.flush();h.transition("active");await h.flush();const after=h.counts();
 assert.ok(after.restoreCalls>before.restoreCalls);assert.ok(after.readCalls>before.readCalls);assert.ok(after.reconcileCalls>before.reconcileCalls);assert.equal(after.pairCalls,0);
});
test("scanner result after background is discarded; fresh scan only fills URI without pairing",async()=>{
 const h=fixture();await h.flush();h.view().press();await h.flush();const old=h.view();h.transition("background");await h.flush();h.transition("active");await h.flush();
 old.accept({kind:"walletconnect",uri:"old URI"});await h.flush();assert.equal(h.view().uri,"");assert.equal(h.view().scanning,false);
 h.view().press();await h.flush();h.view().accept({kind:"walletconnect",uri:"fresh URI"});await h.flush();assert.equal(h.view().uri,"fresh URI");assert.equal(h.view().scanning,false);assert.equal(h.counts().pairCalls,0);
});
test("old scanner callbacks stay fenced across account switch and unmount",async()=>{
 const h=fixture();await h.flush();const old=h.view();h.account("account-b");await h.flush();old.press();old.accept({kind:"walletconnect",uri:"old account"});await h.flush();assert.equal(h.view().scanning,false);assert.equal(h.view().uri,"");
 const fresh=h.view();h.unmount();assert.equal(fresh.scanCurrent(),false);fresh.press();fresh.accept({kind:"walletconnect",uri:"closed"});assert.equal(h.view().scanning,false);assert.equal(h.view().uri,"");
});
test("inactive biometric return neither invalidates nor replaces an active operation",async()=>{
 const h=fixture();await h.flush();const before=h.view(),lease=before.viewOperations.begin("account-a"),counts=h.counts();h.transition("inactive");assert.equal(lease.isCurrent(),false);h.transition("active");await h.flush();assert.equal(h.view(),before);assert.equal(lease.isCurrent(),true);assert.deepEqual(h.counts(),counts);lease.finish();
});
test("mounting while background waits for a new foreground view",async()=>{
 const h=fixture("background");await h.flush();const old=h.view();h.transition("active");await h.flush();old.press();await h.flush();assert.equal(h.view().scanning,false);h.view().press();await h.flush();assert.equal(h.view().scanning,true);
});
test("all old operation-entry callbacks are inert after background return; fresh explicit Pair still works",async()=>{
 const h=fixture();await h.flush();const old=h.view();h.transition("background");await h.flush();h.transition("active");await h.flush();const before=h.counts();
 for(const name of ["pair","disconnect","rejectProposal","approveProposal","decideRequest","checkBroadcast","retryBroadcast","acknowledgeBroadcast","retryConnection"])await old[name]("old");
 old.cancelPair();old.closeSheet();assert.equal(old.startViewOperation(),null);await h.flush();assert.deepEqual(h.counts(),before);assert.equal(h.view().busy,false);
 h.view().accept({kind:"walletconnect",uri:"fresh URI"});await h.flush();await h.view().pair();await h.flush();assert.equal(h.counts().pairCalls,1);assert.equal(h.view().uri,"");assert.equal(h.view().busy,false);
});
test("cancel-pair refreshes passive ownership even when repeat cancellation has equal state values",async()=>{
 const h=fixture();await h.flush();for(let i=0;i<2;i++){const old=h.view();old.cancelPair();await h.flush();assert.equal(old.scanCurrent(),false);assert.equal(h.view().scanCurrent(),true);old.cancelPair();await h.flush();assert.equal(h.counts().cancelCalls,i+1);}h.view().press();await h.flush();assert.equal(h.view().scanning,true);
});
test("foreground reruns the same original request projection without an automatic response or signature",async()=>{
 const event={id:1,topic:"original"},h=fixture("active",event);let reviews=0;
 const review={method:"eth_chainId",topic:"original"};Object.assign(h.context.walletConnectRuntime,{requestRecovery:async()=>null,requestReviewTime:()=>new Date(),rememberReview:async()=>{reviews++}});
 h.context.reviewRecovery={remember(){},review:()=>review};h.context.securityStore.updateReplay=async(fn:any,guard:any)=>{guard();return fn({},[{topic:"original",account:"account-a"}])};h.context.isNativeSignIn=()=>false;
 await h.flush();assert.equal(h.view().requestReview,review);assert.equal(reviews,1);h.transition("background");await h.flush();h.transition("active");await h.flush();assert.equal(h.view().requestReview,review);assert.equal(reviews,2);assert.equal(h.counts().pairCalls,0);
});
test("old read-only operation completion cannot clear fresh same-account foreground operation state",async()=>{
 const h=fixture();await h.flush();let resolve!:(v:any)=>void;h.context.broadcastJournal.refresh=()=>new Promise(r=>{resolve=r});const old=h.view(),job=old.checkBroadcast();await h.flush();assert.equal(h.view().busy,true);
 h.transition("background");await h.flush();h.transition("active");await h.flush();const fresh=h.view().startViewOperation();assert.ok(fresh);await h.flush();assert.equal(h.view().busy,true);
 resolve({transactionHash:"old completion"});await job;await h.flush();assert.equal(h.view().broadcast,null);assert.equal(h.view().busy,true);assert.equal(fresh.isCurrent(),true);fresh.finish();
});
test("batched background return refreshes once; explicit close permanently retires that view",async()=>{
 const h=fixture();await h.flush();const old=h.view();h.transition("background");h.transition("active");await h.flush();assert.equal(old.scanCurrent(),false);assert.equal(h.view().scanCurrent(),true);
 const fresh=h.view();fresh.closeSheet();fresh.press();fresh.accept({kind:"walletconnect",uri:"closed scanner"});assert.equal(fresh.startViewOperation(),null);assert.equal(h.counts().closeCalls,1);assert.equal(fresh.scanCurrent(),false);assert.equal(h.view().uri,"");
});

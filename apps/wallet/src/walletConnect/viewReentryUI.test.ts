import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {WalletConnectViewOperations} from "./viewOperations";
const source=readFileSync(process.env.YNX_NATIVE_CONNECT_SOURCE??new URL("./WalletConnectModal.tsx",import.meta.url),"utf8");
const deferred=()=>{let resolve!:(v?:any)=>void,reject!:(e:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){
 const pending=deferred(),ops=new WalletConnectViewOperations();ops.setAccount("account-a");
 const view={busy:false,error:null as any,review:{id:1} as any,broadcast:null as any};const event={id:1,topic:"original"},review={topic:"original",account:"evm-a",method:"eth_chainId"};
 const context:any={responses:0,keyCalls:0,signatures:0,commits:0,viewOperations:ops,account:{account:"account-a"},evmAddress:"evm-a",snapshot:{proposal:event},proposalReview:{namespaces:{}},requestReview:review,reviewedEvent:{current:event},prepared:null,nativePrepared:null,
   setBusy:(v:boolean)=>{view.busy=v},setError:(v:any)=>{view.error=v},setProposalReview:(v:any)=>{view.review=v},setRequestReview:(v:any)=>{view.review=v},setPrepared(){},setNativePrepared(){},setBroadcast:(v:any)=>{view.broadcast=v},message:(e:any)=>e.message,walletConnectRejection:()=>({code:5000,message:"original rejection"}),
   walletConnectNativeOutbox:{read:async()=>null},setNativePending(){},broadcastJournal:{read:async()=>null,refresh:()=>pending.promise,retryOriginal:()=>pending.promise,acknowledgeTerminal:()=>pending.promise},withAccountSecret:async(_a:any,guard:any,use:any)=>{context.keyCalls++;guard();return use("not used",guard)},signPreparedEvmRequest:async()=>{context.signatures++;return{transactionHash:"original hash"}},
   revokeAndDisconnectWalletConnectSession:()=>pending.promise,securityStore:{},createPersistAndPublishWalletConnectSession:async()=>{},createWalletConnectSessionApproval:()=>({}),
   walletConnectRuntime:{snapshot:()=>({proposal:event,request:event}),rejectProposal:()=>pending.promise,approveProposal:()=>pending.promise,bindReviewedRequest:()=>({assertCurrent(){},respond:()=>{context.responses++;return pending.promise;},reject:async()=>{}}),requestRecovery:async()=>({state:"undecided"}),requestOutcomeUnconfirmed:async()=>{},decideReviewedRequest:async()=>{}},finalizeWalletConnectRequestReview:()=>({})};
 context.securityStore.updateReplay=async(fn:any)=>{context.commits++;return fn({},[{topic:review.topic,account:review.account,sessionBinding:undefined}]);};
 const start=source.indexOf("  const startViewOperation"),fallback=source.indexOf("  const disconnect ="),end=source.indexOf("  return <Modal",fallback);
 const js=ts.transpileModule(source.slice(start>=0?start:fallback,end)+"\nglobalThis.actions={disconnect,rejectProposal,approveProposal,decideRequest,checkBroadcast,retryBroadcast,acknowledgeBroadcast};",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 runInNewContext(js,context);return{context,pending,view,retire(){ops.cancel();ops.setAccount("account-b");view.error="fresh recovery notice";view.busy=true;view.review={id:2};view.broadcast={account:"evm-b"}}};
}
for(const name of ["disconnect","rejectProposal","approveProposal","checkBroadcast","retryBroadcast","acknowledgeBroadcast"])for(const fail of [false,true])test(`late ${name} ${fail?"failure":"success"} cannot change a recovered account's view`,async()=>{
 const h=fixture(),job=h.context.actions[name]("original");h.retire();if(fail)h.pending.reject(Error("old failure"));else h.pending.resolve({topic:"original"});await job;
 assert.equal(h.view.error,"fresh recovery notice");assert.equal(h.view.busy,true);assert.equal(h.view.review.id,2);assert.equal(h.view.broadcast.account,"evm-b");
});
test("view scope is single-flight and cannot authorize protected key access",()=>{
 const ops=new WalletConnectViewOperations();ops.setAccount("a");const lease=ops.begin("a");assert.throws(()=>ops.begin("a"),/already in progress/);ops.setAppState("background");assert.equal(lease.isCurrent(),false);ops.setAppState("active");ops.setAccount("b");assert.throws(()=>ops.begin("a"));const fresh=ops.begin("b");lease.finish();assert.equal(fresh.isCurrent(),true);fresh.finish();
});
for(const fail of [false,true])test(`original broadcast ${fail?"read failure":"unknown record"} blocks a new transfer before key access, decision or signature`,async()=>{
 const h=fixture();h.context.requestReview.method="eth_sendTransaction";h.context.prepared={method:"eth_sendTransaction"};h.context.broadcastJournal.read=async()=>{if(fail)throw Error("original unavailable");return{account:"evm-a",status:"uncertain",transactionHash:"original hash"};};
 await h.context.actions.decideRequest(true);assert.equal(h.context.keyCalls,0);assert.equal(h.context.signatures,0);assert.equal(h.context.commits,0);
});
test("late original request SDK response cannot clear a newer exact request review",async()=>{
 const h=fixture(),job=h.context.actions.decideRequest(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.context.responses,1);h.context.reviewedEvent.current={id:2,topic:"new"};h.view.review={id:2};h.view.error="new request notice";h.pending.resolve();await job;
 assert.equal(h.view.review.id,2);assert.equal(h.view.error,"new request notice");
});
test("unresolved native Send/Pay outbox blocks WalletConnect transfer before reading a key or signing again",async()=>{
 const h=fixture();h.context.requestReview.method="eth_sendTransaction";h.context.prepared={method:"eth_sendTransaction"};h.context.walletConnectNativeOutbox.read=async()=>({phase:"unknown",hash:"original native hash"});await h.context.actions.decideRequest(true);assert.equal(h.context.keyCalls,0);assert.equal(h.context.signatures,0);assert.equal(h.context.commits,0);
});
test("current explicit public request responds once and finishes its own UI without reading a secret",async()=>{
 const h=fixture(),job=h.context.actions.decideRequest(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.context.responses,1);h.pending.resolve();await job;assert.equal(h.view.review,null);assert.equal(h.view.busy,false);assert.equal(h.context.keyCalls,0);assert.equal(h.context.signatures,0);
});
test("duplicate native disconnect delivery shares one actual view operation",async()=>{
 const h=fixture();let calls=0;h.context.revokeAndDisconnectWalletConnectSession=()=>{calls++;return h.pending.promise;};const first=h.context.actions.disconnect("original"),second=h.context.actions.disconnect("original");assert.equal(calls,1);h.pending.resolve();await Promise.all([first,second]);assert.equal(h.view.busy,false);
});

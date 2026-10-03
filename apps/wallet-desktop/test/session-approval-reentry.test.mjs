import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ApprovalReviewQueue} from "../src/approval-review-queue.mjs";
const source=readFileSync(process.env.YNX_SESSION_RENDERER_SOURCE??new URL("../src/renderer.js",import.meta.url),"utf8");
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(type){
 const pending=deferred(),detail={textContent:""},panel={dataset:{}},queue=new ApprovalReviewQueue();
 const review={id:"original-review",account:"account-a",displayName:"App",expiresAt:new Date(Date.now()+60000).toISOString()};queue.enqueue(type,review);
 const context={approvalQueue:queue,creatingAuthorizationAccount:false,accountViewRevision:0,accountSecurityIntent:0,activeAccount:"account-a",keyState:{revision:1,locked:false},authorization:panel,authResult:detail,walletConnectDetail:detail,authorizationChoices:new Map(),document:{querySelector:()=>detail},errorText:()=>"old refusal",refreshWalletConnectSessions:async()=>{context.reads++},refreshTransactions:async()=>{context.journalReads++},journalReads:0,reads:0,window:{ynxWallet:{authorizationAction:()=>pending.promise,walletConnectProposalAction:()=>pending.promise,providerAction:()=>pending.promise,lock:async()=>{}}}};
 const functionName={authorization:"act",proposal:"proposalAction",provider:"providerAction"}[type];
 const start=source.indexOf(`async function ${functionName}(action)`);
 const end=source.indexOf(type==="authorization"?"function presentApproval()":`document.querySelector("#reject-${type}")`,start);
 runInNewContext(source.slice(start,end),context);
 return{context,pending,detail,panel,queue,review,act:()=>context[functionName]("approve")};
}
for(const type of ["authorization","proposal","provider"])for(const outcome of ["success","failure","throw"])test(`late ${type} ${outcome} cannot publish or finish a new reused-id review`,async()=>{
 const h=fixture(type),old=h.act();h.queue.clear();h.context.accountViewRevision++;h.context.accountSecurityIntent++;h.context.keyState.revision++;
 h.queue.enqueue(type,{...h.review,account:"account-b"});const fresh=h.queue.begin(h.queue.current.key);h.detail.textContent="fresh review notice";h.panel.dataset.resultCode="AWAITING_APPROVAL";
 if(outcome==="throw")h.pending.reject(Error("old interruption"));else h.pending.resolve(outcome==="success"?{ok:true,callbackEmitted:true,code:"APPROVED"}:{ok:false,code:"NO_PENDING_AUTHORIZATION",error:{code:"ACCOUNT_CHANGED"}});
 await old;assert.equal(h.detail.textContent,"fresh review notice");assert.equal(h.panel.dataset.resultCode,"AWAITING_APPROVAL");assert.equal(h.queue.current,fresh);assert.equal(h.queue.busy,true);assert.equal(h.context.reads,0);
});
for(const type of ["authorization","proposal","provider"])test(`current ${type} response completes its own review`,async()=>{
 const h=fixture(type),job=h.act();h.pending.resolve({ok:true,callbackEmitted:true,code:"APPROVED",value:{status:"success",responseDelivered:true}});await job;assert.equal(h.queue.count,0);assert.equal(h.queue.busy,false);assert.match(h.detail.textContent,/Returning to App|App connected|Your response was delivered/);
});

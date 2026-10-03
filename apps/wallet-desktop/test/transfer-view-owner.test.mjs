import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const source=readFileSync(process.env.YNX_TRANSFER_SOURCE??new URL("../src/renderer.js",import.meta.url),"utf8");
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
function harness(){
  const nodes=new Map(),preparations=[],actions=[];let refreshes=0;
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{value:"",textContent:"",disabled:false,hidden:false,open:false,children:[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn},append(...values){this.children.push(...values)},replaceChildren(){this.children=[]},close(){this.open=false},showModal(){this.open=true},focus(){}});return nodes.get(selector)};
  const document={querySelector:selector=>selector==="dialog[open]"?[...nodes.values()].find(node=>node.open)??null:get(selector),createElement:()=>({}),querySelectorAll:()=>[]};
  get("#send-sheet").open=true;get("#transfer-to").value="ynx1-public-recipient";get("#transfer-amount").value="1";
  const context={document,keyState:{locked:false,authenticating:false,revision:1},activeAccount:"account-a",accountViewRevision:0,accountState:{initialized:true},paymentDraftRevision:0,transferReview:null,transferInFlight:false,
    window:{ynxWallet:{prepareTransfer:()=>{const pending=deferred();preparations.push(pending);return pending.promise},transferAction:()=>{const pending=deferred();actions.push(pending);return pending.promise},lock:async()=>{context.keyState.locked=true}}},
    paymentRecipientUI:{invalidate(){}},recipientScanUI:{invalidate(){}},errorText:result=>result.error.message,formatApprovalReview:()=>"public transaction",refreshAssets(){refreshes++},refreshTransactions(){refreshes++}};
  const start=source.indexOf('document.querySelector("#transfer-form").addEventListener'),end=source.indexOf("\nfunction setView(name)",start);
  const entryStart=source.indexOf('document.querySelector("#open-send").addEventListener'),entryEnd=source.indexOf('\ndocument.querySelector("#send-sheet").addEventListener',entryStart);
  const ownerStart=source.indexOf("let accountSecurityIntent="),ownerEnd=source.indexOf('createAccount.addEventListener("click"',ownerStart);
  runInNewContext(source.match(/^function copyUI\([^\n]+/m)[0]+"\n"+source.match(/^function invalidatePaymentInput\([^\n]+/m)[0]+"\n"+source.slice(ownerStart,ownerEnd)+"\n"+source.slice(start,end)+"\n"+source.slice(entryStart,entryEnd),context);
  return{context,get,preparations,actions,refreshes:()=>refreshes,submit:()=>get("#transfer-form").listeners.submit({preventDefault(){}})};
}
const prepared=()=>({ok:true,value:{id:"review-a",account:"account-a",ynxFrom:"public-a",ynxTo:"public-b",amount:"1",maximumFee:"2",total:"3"}});
for(const outcome of ["failure","throw"])test(`old prepare ${outcome} cannot publish after lock/unlock or release a newer prepare button`,async()=>{
  const h=harness(),old=h.submit();h.context.keyState={locked:false,authenticating:false,revision:3};h.context.invalidatePaymentInput();
  const fresh=h.submit(),notice=h.get("#transfer-result").textContent;
  if(outcome==="throw")h.preparations[0].reject(Error("old failure"));else h.preparations[0].resolve({ok:false,error:{message:"old failure"}});
  await old;assert.equal(h.get("#prepare-transfer").disabled,true);assert.equal(h.get("#transfer-result").textContent,notice);
  h.preparations[1].resolve({ok:false,error:{message:"current failure"}});await fresh;
  assert.equal(h.get("#prepare-transfer").disabled,false);assert.equal(h.get("#transfer-result").textContent,"current failure");
});
test("late thrown preparation while locked is silent even if the old draft still matches",async()=>{
  const h=harness(),job=h.submit();h.context.keyState={locked:true,authenticating:false,revision:2};h.get("#transfer-result").textContent="new locked view";
  h.preparations[0].reject(Error("old failure"));await job;assert.equal(h.get("#transfer-result").textContent,"new locked view");
});
for(const outcome of ["success","failure","throw"])test(`old submitted transfer ${outcome} cannot overwrite a newer draft or close its review`,async()=>{
  const h=harness();h.get("#send-sheet").open=false;h.get("#transfer-review").open=true;h.context.transferReview={id:"old-review"};
  const job=h.context.actOnTransfer("approve");h.context.invalidatePaymentInput();h.context.transferReview={id:"new-review"};h.get("#transfer-result").textContent="new draft notice";
  if(outcome==="throw")h.actions[0].reject(Error("old response"));else h.actions[0].resolve(outcome==="success"?{ok:true,value:{hash:"public-original-hash"}}:{ok:false,error:{message:"old response"}});
  await job;assert.equal(h.get("#transfer-result").textContent,"new draft notice");assert.equal(h.get("#transfer-review").open,true);assert.equal(h.get("#send-sheet").open,false);
  assert.equal(h.context.transferReview.id,"new-review");assert.equal(h.context.transferInFlight,false);assert.ok(h.refreshes()>0,"journal readback remains available");
});
test("a submitted transfer receipt after account switch stays in the journal, not the new account notice",async()=>{
  const h=harness();h.context.transferReview={id:"old-review"};const job=h.context.actOnTransfer("approve");
  h.context.activeAccount="account-b";h.context.keyState={locked:false,authenticating:false,revision:3};h.get("#transfer-result").textContent="account-b notice";
  h.actions[0].resolve({ok:true,value:{hash:"original-hash"}});await job;
  assert.equal(h.get("#transfer-result").textContent,"account-b notice");assert.equal(h.refreshes(),1);
});
test("normal prepare/review/explicit approval shows original hash and refreshes balance and journal",async()=>{
  const h=harness(),preparing=h.submit();h.preparations[0].resolve(prepared());await preparing;
  assert.equal(h.get("#transfer-review").open,true);assert.equal(h.actions.length,0);
  const sending=h.context.actOnTransfer("approve");h.actions[0].resolve({ok:true,value:{hash:"original-hash"}});await sending;
  assert.match(h.get("#transfer-result").textContent,/original-hash/);assert.equal(h.refreshes(),2);assert.equal(h.get("#send-sheet").open,true);
});
test("submission completion cannot open Send over a newer password or backup dialog",async()=>{
  const h=harness();h.get("#send-sheet").open=false;h.get("#transfer-review").open=true;h.context.transferReview={id:"old-review"};
  const job=h.context.actOnTransfer("approve");h.get("#transfer-review").open=false;h.get("#password-sheet").open=true;
  h.actions[0].resolve({ok:true,value:{hash:"original-hash"}});await job;
  assert.equal(h.get("#send-sheet").open,false);assert.equal(h.get("#password-sheet").open,true);
});
test("editing a pending prepare immediately releases its button for a fresh draft, without releasing the newer request",async()=>{
  const h=harness(),old=h.submit();h.get("#transfer-amount").value="2";h.context.invalidatePaymentInput();
  assert.equal(h.get("#prepare-transfer").disabled,false);const fresh=h.submit();
  h.preparations[0].reject(Error("old error"));await old;assert.equal(h.get("#prepare-transfer").disabled,true);
  h.preparations[1].resolve({ok:false,error:{message:"new draft error"}});await fresh;assert.equal(h.get("#prepare-transfer").disabled,false);
});
test("closing and explicitly reopening the same Send draft cannot revive its previous prepare",async()=>{
  const h=harness(),old=h.submit();h.get("#send-sheet").close();h.get("#open-send").listeners.click();
  h.preparations[0].resolve(prepared());await old;
  assert.equal(h.get("#transfer-review").open,false);assert.equal(h.get("#send-sheet").open,true);assert.equal(h.get("#prepare-transfer").disabled,false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {evmAddressFromYNX} from "@ynx-chain/wallet-auth";
import {DesktopKeyLifecycle} from "../src/key-lifecycle.mjs";
import {DesktopWalletVault} from "../src/desktop-wallet-vault.mjs";
import {FileTransactionIntentStore} from "../src/transaction-intent-store.mjs";
import {createDesktopPayService,installDesktopPayIPC} from "../src/wallet-pay-service.mjs";
import {createDesktopPayUI,mountDesktopPayUI} from "../src/wallet-pay-ui.mjs";
import {desktopPayIdempotencyKey} from "../src/wallet-pay-settlement.mjs";
import {CANONICAL_RPC_URL} from "../src/rpc.mjs";
import {assertWalletIPC} from "../src/wallet-ipc-policy.mjs";
import {payTestSecret,signedPayFixture} from "./fixture-signed-pay.mjs";
import {fixtureKeyAuthorization} from "./fixture-key-authorization.mjs";
import {fileInputDOM} from "./fixture-file-input-dom.mjs";
const literal=JSON.parse(await readFile(new URL("./fixtures/transaction-durability/native-json-contract-fixture.json",import.meta.url),"utf8"));

for(const boundary of ["reopen","account","key","lock","locked-entry"])test(`old open cancellation cannot capture a new ${boundary} epoch or clear its review`,async()=>{
  const context={open:true,account:"original",keyRevision:1,locked:false},views=[];let cancelCalls=0,resolveOld,statusCalls=0,restoreCalls=0;
  const api={payCancel:()=>++cancelCalls===2?new Promise(resolve=>resolveOld=resolve):{ok:true},payStatus:async()=>{statusCalls++;return {ok:true,value:{available:true,paymentAuthorized:false}}},payRestore:async()=>{restoreCalls++;return {ok:true,value:{kind:"original",original:null}}},payReview:async()=>({ok:true,value:{kind:"review",review:{account:context.account,id:"new-review",invoiceId:"inv_"+"a".repeat(20),merchant:"merchant",recipient:"payee",amount:25,fee:1,total:26,intentDigest:"a".repeat(64),expiresAt:"2026-10-03T23:00:00Z",paymentAuthorized:false}}})};
  const ui=createDesktopPayUI({api,getContext:()=>({...context}),render:view=>views.push(view)});
  await ui.open();if(boundary==="locked-entry")context.locked=true;const pending=ui.open();await Promise.resolve();assert.equal(typeof resolveOld,"function");
  if(boundary==="reopen"){context.open=false;await ui.clear();context.open=true}
  if(boundary==="account")context.account="new-account";if(boundary==="key")context.keyRevision++;if(boundary==="lock"){context.locked=true;await ui.clear();context.locked=false;context.keyRevision++}
  if(boundary==="locked-entry"){context.locked=false;context.keyRevision++}
  await ui.open();await ui.review("inv_"+"a".repeat(20));assert.equal(views.at(-1).review.id,"new-review");const last=views.at(-1),counts=[statusCalls,restoreCalls];
  resolveOld({ok:true});await pending;assert.equal(views.at(-1),last);assert.equal(views.at(-1).review.id,"new-review");assert.deepEqual([statusCalls,restoreCalls],counts,'old cancellation must perform no fresh-epoch reads');
});

test("actual mounted picker cancellation awaiting IPC cannot erase a new reopened service review",async()=>{
  const f=await harness(),nodes=new Map();let cancelCalls=0,resolveOld;
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{open:false,value:"",hidden:false,disabled:false,textContent:"",children:[],listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn)},emit(type,event={}){return this.listeners.get(type)?.(event)},showModal(){this.open=true},close(){this.open=false;this.listeners.get("close")?.()},focus(){},replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}});return nodes.get(selector)};
  const api={...f.api,payCancel:async()=>{const call=++cancelCalls,result=await f.api.payCancel();if(call===3)await new Promise(resolve=>resolveOld=resolve);return result}};
  mountDesktopPayUI({document:{querySelector:selector=>fileInputDOM(get(selector),next=>nodes.set(selector,next)),createElement:()=>({textContent:""})},api,getContext:()=>({account:f.identity.account,keyRevision:f.lifecycle.status().revision,locked:f.lifecycle.status().locked})});
  const tick=()=>new Promise(resolve=>setImmediate(resolve)),until=async condition=>{for(let i=0;i<1000;i++){if(condition())return;await tick()}assert.fail("Mounted service did not reach its controlled boundary")};get("#open-protected-pay").emit("click");await until(()=>!get("#protected-pay-review").disabled);const qr=get("#protected-pay-qr");qr.emit("click");await tick();const pending=qr.emit("cancel");await until(()=>typeof resolveOld==="function");
  get("#protected-pay-sheet").close();get("#open-protected-pay").emit("click");await until(()=>!get("#protected-pay-review").disabled);get("#protected-pay-reference").value=f.input.rawInvoice.id;get("#protected-pay-form").emit("submit",{preventDefault(){}});await until(()=>!get("#protected-pay-approve").hidden);
  const facts=get("#protected-pay-facts").children.map(node=>node.textContent),before=f.calls.length;resolveOld();await pending;await tick();
  assert.equal(get("#protected-pay-approve").hidden,false);assert.deepEqual(get("#protected-pay-facts").children.map(node=>node.textContent),facts);assert.equal(f.calls.length,before);assert.equal(f.decryptions(),0);assert.equal(f.posts(),0);assert.equal(f.submits(),0);get("#protected-pay-sheet").close();f.lifecycle.lock();
});

for(const cancellation of ["cancel","change"])test(`mounted Pay ${cancellation} restores current controls without review, key, or payment`,async()=>{
  const f=await harness(),nodes=new Map();let decodes=0;
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{open:false,value:"",hidden:false,disabled:false,textContent:"",children:[],listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn)},emit(type,event={}){return this.listeners.get(type)?.(event)},showModal(){this.open=true},close(){this.open=false;this.listeners.get("close")?.()},focus(){},replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}});return nodes.get(selector)};
  mountDesktopPayUI({document:{querySelector:selector=>fileInputDOM(get(selector),next=>nodes.set(selector,next)),createElement:()=>({textContent:""})},api:{...f.api,invoiceReferenceQR:async()=>{decodes++;throw Error("No decoding")}},getContext:()=>({account:f.identity.account,keyRevision:f.lifecycle.status().revision,locked:f.lifecycle.status().locked})});
  get("#open-protected-pay").emit("click");await new Promise(resolve=>setImmediate(resolve));
  const qr=get("#protected-pay-qr");get("#protected-pay-reference").value="preserved-reference";qr.emit("click");await new Promise(resolve=>setImmediate(resolve));
  assert.equal(get("#protected-pay-review").disabled,true);await qr.emit(cancellation);await new Promise(resolve=>setImmediate(resolve));assert.equal(get("#protected-pay-review").disabled,false);assert.equal(get("#protected-pay-reference").value,"preserved-reference");
  const statuses=f.calls.filter(c=>c.channel==="wallet:pay-status").length;await qr.emit("cancel");assert.equal(f.calls.filter(c=>c.channel==="wallet:pay-status").length,statuses);
  qr.emit("click");get("#protected-pay-sheet").close();const before=f.calls.length;await qr.emit("cancel");assert.equal(f.calls.length,before);
  assert.equal(decodes,0);assert.equal(f.decryptions(),0);assert.equal(f.posts(),0);assert.equal(f.submits(),0);assert.equal(f.calls.filter(c=>c.channel==="wallet:pay-review").length,0);f.lifecycle.lock();
});

for(const boundary of ["lock","account"])test(`mounted Pay stale cancellation after ${boundary} never starts current status or decoding`,async()=>{
  const f=await harness(),nodes=new Map();
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{open:false,value:"",hidden:false,disabled:false,textContent:"",children:[],listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn)},emit(type,event={}){return this.listeners.get(type)?.(event)},showModal(){this.open=true},close(){this.open=false;this.listeners.get("close")?.()},focus(){},replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}});return nodes.get(selector)};
  mountDesktopPayUI({document:{querySelector:selector=>fileInputDOM(get(selector),next=>nodes.set(selector,next)),createElement:()=>({textContent:""})},api:{...f.api,invoiceReferenceQR:async()=>{throw Error("No decoding")}},getContext:()=>({account:f.lifecycle.status().account,keyRevision:f.lifecycle.status().revision,locked:f.lifecycle.status().locked})});
  get("#open-protected-pay").emit("click");await new Promise(resolve=>setImmediate(resolve));const old=get("#protected-pay-qr");old.emit("click");
  if(boundary==="lock")f.lifecycle.lock();else f.lifecycle.setAccount("0x"+"3".repeat(40));await new Promise(resolve=>setImmediate(resolve));
  const before=f.calls.length;await old.emit("cancel");old.files=[];await old.emit("change");assert.equal(f.calls.length,before);assert.equal(f.posts(),0);assert.equal(f.decryptions(),0);assert.equal(f.submits(),0);get("#protected-pay-sheet").close();f.lifecycle.lock();
});
async function harness({configured=true}={}){
  const f=signedPayFixture(5),directory=await mkdtemp(join(tmpdir(),"ynx-desktop-pay-service-"));let decryptions=0,posts=0,submits=0;
  const lifecycle=new DesktopKeyLifecycle({now:f.input.now,authorizer:{available:()=>true,authenticate:async()=>{},method:"controlled-test-only"},schedule:()=>null,unschedule:()=>{}});lifecycle.setFocused(true);
  const vault=new DesktopWalletVault({authorization:fixtureKeyAuthorization,filePath:join(directory,"vault.json"),randomSecret:()=>payTestSecret,safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).reverse(),decryptStringAsync:async bytes=>{decryptions++;return {result:Buffer.from(bytes).reverse().toString()}}}});
  await vault.createAccount();vault.authorization=lifecycle;lifecycle.setAccount(evmAddressFromYNX(f.identity.account));await lifecycle.unlock();
  const store=new FileTransactionIntentStore({filePath:join(directory,"journal.json")}),state={quote:null,broadcast:null,submit:null};
  const client={...f.input.client,origin:CANONICAL_RPC_URL,broadcast:async(payload,transaction,hash)=>{posts++;if(state.broadcast)return state.broadcast();const retained=await store.signedPayProgress(f.identity.account,f.input.policy,()=>{});assert.equal(payload,retained.record.transfer.payload);assert.equal(retained.broadcastAttempted,true);return {hash,durabilityConfirmed:false}},checkTransferDurability:async(transaction,hash,guard)=>{guard();return {status:"durable",evidence:{version:1,origin:CANONICAL_RPC_URL,chainId:"0x1917",capability:literal.capability,receipt:{...literal.durableReceipt,transactionHash:hash,from:transaction.from,to:transaction.to,ynxDurability:{...literal.durableReceipt.ynxDurability,transactionHash:hash},ynxNativeTransaction:{type:"transfer",amountYNXT:"25",feeYNXT:"1",nonce:"0x2"}}}}}};
  f.authority.verifyOriginalBinding=async()=>{};
  const response=record=>({...record.invoice,status:"committed",settlement:{id:"receipt-controlled",chainId:"ynx_6423-1",transactionHash:record.transfer.hash,blockNumber:99,finality:"committed",payer:record.account,payee:record.invoice.payoutAddress,payoutAddress:record.invoice.payoutAddress,amount:25,asset:"YNXT",invoiceId:record.invoice.id,centralInvoiceId:record.invoice.centralInvoiceId,intentId:record.invoice.intentId,intentDigest:record.paymentResult.intentDigest,requestNonce:record.intent.requestId,idempotencyKey:desktopPayIdempotencyKey(record),receiptId:"receipt-controlled",status:"committed",auditHash:"a".repeat(64),auditId:"aud_"+"b".repeat(20),committedAt:"2026-10-03T01:00:01Z",source:"authoritative-central-pay-api",sourceAsOf:"2026-10-03T01:00:01Z",sourceVersion:1,confidence:"authoritative"}});
  const integration={policy:f.input.policy,authorityForReview:async()=>f.authority,authorityForOriginal:async()=>f.authority,quoteProvider:{reviewInvoice:async(id,{guard})=>{guard();if(state.quote)return state.quote();return {rawInvoice:f.input.rawInvoice,rawIntent:f.input.rawIntent}}},settlementTransport:{submitOriginal:async args=>{args.guard();submits++;if(state.submit)return state.submit(args);return response(args.record)},readOriginal:async args=>{args.guard();return response(args.record)}}};
  const service=createDesktopPayService({getContext:()=>({...lifecycle.status(),focused:true,changing:false}),getIdentity:()=>vault.status(),getRuntime:()=>({store,lifecycle,vault,client}),now:f.input.now});
  if(configured)service.compose(integration);
  const handlers=new Map(),calls=[],url="file:///installed/wallet/index.html",frame={url},contents={mainFrame:frame,isDestroyed:()=>false},event={sender:contents,senderFrame:frame};
  const safeIPC=async fn=>{try{return {ok:true,value:await fn()}}catch(error){return {ok:false,error:{code:error.data?.code??error.code??error.message}}}};
  installDesktopPayIPC({service,safeIPC,handleWalletIPC:(channel,fn)=>handlers.set(channel,(input,source=event)=>safeIPC(async()=>{assertWalletIPC(source,contents,url);const result=await fn(source,input);if(!result.ok)throw Object.assign(Error(result.error.code),{code:result.error.code});return result.value}))});
  const invoke=(channel,input)=>{calls.push({channel,input});return handlers.get(channel)(input)};
  const securityListeners=[];lifecycle.subscribe(state=>{for(const listener of securityListeners)listener(state)});
  const api={payStatus:()=>invoke("wallet:pay-status"),payReview:reference=>invoke("wallet:pay-review",reference),payAction:input=>invoke("wallet:pay-action",input),payRestore:()=>invoke("wallet:pay-restore"),payHistory:cursor=>invoke("wallet:pay-history",cursor),payCancel:()=>invoke("wallet:pay-cancel"),invoiceReferenceQR:async()=>({ok:true,value:{invoiceID:f.input.rawInvoice.id,decodedLocally:true,uploaded:false}}),onSecurityState:fn=>securityListeners.push(fn),onAccountStatus:()=>{}};
  return {...f,service,integration,store,lifecycle,vault,state,api,calls,handlers,frame,contents,event,decryptions:()=>decryptions,posts:()=>posts,submits:()=>submits};
}
test("Desktop normal IPC service never accepts renderer quote/authority or exposes original signed bytes/session",async()=>{
  const f=await harness(),review=await f.api.payReview(f.input.rawInvoice.id);assert.equal(review.ok,true);assert.equal(review.value.kind,"review");assert.equal(f.decryptions(),0);assert.equal(f.posts(),0);
  const token=review.value.review.id;const injected=await f.api.payAction({action:"approve",id:token,rawInvoice:f.input.rawInvoice,session:f.authority.session});assert.equal(injected.ok,false);assert.equal(f.decryptions(),0);
  const approved=await f.api.payAction({action:"approve",id:token});assert.equal(approved.ok,true);assert.equal(approved.value.original.checkpointVerified,false);
  for(const key of ["record","transfer","payload","raw","session","paymentResult","intent","signature","privateKey"])assert.equal(key in approved.value.original,false);
  assert.equal(f.decryptions(),1);assert.equal(f.posts(),1);assert.equal((await f.api.payAction({action:"approve",id:token})).ok,false);f.lifecycle.lock();
});
test("Desktop default normal service reports unavailable; IPC cannot configure it with a fake ready flag",async()=>{
  const f=await harness({configured:false});assert.deepEqual((await f.api.payStatus()).value,{available:false,reason:"PAY_PROTECTED_INTEGRATION_UNAVAILABLE",paymentAuthorized:false});
  assert.equal((await f.api.payReview(f.input.rawInvoice.id)).ok,false);assert.equal((await f.api.payAction({action:"approve",id:"fake"})).ok,false);assert.equal(f.handlers.has("wallet:pay-compose"),false);assert.equal(f.posts(),0);
  assert.throws(()=>f.service.compose({quoteProvider:{reviewInvoice:async()=>({})}}));f.service.compose(f.integration);assert.throws(()=>f.service.compose(f.integration));f.lifecycle.lock();
});
for(const change of ["cancel","lock","account","expiry"])test(`Desktop ${change} invalidates main-held quote before approval`,async()=>{
  const f=await harness(),review=(await f.api.payReview(f.input.rawInvoice.id)).value.review;
  if(change==="cancel")await f.api.payCancel();if(change==="lock")f.lifecycle.lock();if(change==="account")f.lifecycle.setAccount("0x"+"3".repeat(40));if(change==="expiry")f.setNow(f.input.now()+60_000);
  assert.equal((await f.api.payAction({action:"approve",id:review.id})).ok,false);assert.equal(f.decryptions(),0);assert.equal(f.posts(),0);f.lifecycle.lock();
});
test("Desktop cancel while quote provider awaits prevents a late review from resurrecting",async()=>{
  const f=await harness();let finish;f.state.quote=()=>new Promise(resolve=>finish=resolve);const pending=f.api.payReview(f.input.rawInvoice.id);
  while(!finish)await new Promise(resolve=>setImmediate(resolve));await f.api.payCancel();finish({rawInvoice:f.input.rawInvoice,rawIntent:f.input.rawIntent});assert.equal((await pending).ok,false);assert.equal(f.decryptions(),0);f.lifecycle.lock();
});
test("Desktop cancel during outward await retains original and fences late UI without a new lifecycle/vault",async()=>{
  const f=await harness(),review=(await f.api.payReview(f.input.rawInvoice.id)).value.review;
  let finish;f.state.broadcast=async()=>{await new Promise(resolve=>finish=resolve);return {hash:"irrelevant",durabilityConfirmed:false}};
  const pending=f.api.payAction({action:"approve",id:review.id});while(!finish)await new Promise(resolve=>setImmediate(resolve));await f.api.payCancel();finish();assert.equal((await pending).ok,false);
  assert.equal(f.posts(),1);assert.equal(f.decryptions(),1);const restored=await f.api.payRestore();assert.equal(restored.ok,true);assert.equal(restored.value.original.status,"transfer_unconfirmed");f.lifecycle.lock();
});
test("Desktop every new channel rejects remote/subframe/stale sender before policy, key or network",async()=>{
  const f=await harness();for(const [channel,handler] of f.handlers){const result=await handler(channel==="wallet:pay-review"?f.input.rawInvoice.id:{action:"approve",id:"fake"},{sender:f.contents,senderFrame:{url:f.frame.url}});assert.equal(result.ok,false);assert.equal(result.error.code,"UNTRUSTED_WALLET_FRAME")}
  assert.equal(f.decryptions(),0);assert.equal(f.posts(),0);f.lifecycle.lock();
});
test("Desktop cancellation after protected key await prevents journal publication and any POST",async()=>{
  const f=await harness(),review=(await f.api.payReview(f.input.rawInvoice.id)).value.review,withSecret=f.vault.withSecret.bind(f.vault);let finish;
  f.vault.withSecret=async action=>{const result=await withSecret(action);await new Promise(resolve=>finish=resolve);return result};
  const pending=f.api.payAction({action:"approve",id:review.id});while(!finish)await new Promise(resolve=>setImmediate(resolve));await f.api.payCancel();finish();assert.equal((await pending).ok,false);assert.equal(f.posts(),0);assert.equal(f.decryptions(),1);assert.equal(await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{}),null);f.lifecycle.lock();
});
test("Desktop renderer state machine explicit review → approve → check → settle → Done → history uses real service",async()=>{
  const f=await harness(),views=[],context={open:true,account:f.identity.account,keyRevision:f.lifecycle.status().revision,locked:false},ui=createDesktopPayUI({api:f.api,getContext:()=>({...context}),render:view=>views.push(view)});
  await ui.open();await ui.review(f.input.rawInvoice.id);assert.ok(views.at(-1).review);assert.equal(f.posts(),0);await ui.approve();assert.equal(views.at(-1).original.status,"transfer_unconfirmed");
  await ui.action("settle");assert.equal(f.submits(),0);await ui.action("check");assert.equal(views.at(-1).original.checkpointVerified,true);await ui.action("settle");assert.equal(views.at(-1).original.status,"settled");await ui.action("done");assert.equal(views.at(-1).original.status,"archived");
  const history=await ui.history();assert.equal(history.length,1);assert.equal(history[0].status,"archived");assert.equal(f.decryptions(),1);assert.equal(f.posts(),1);assert.equal(f.submits(),1);await ui.clear();f.lifecycle.lock();
});
test("Desktop service same known hash Done is idempotent after active record release",async()=>{
  const f=await harness(),review=(await f.api.payReview(f.input.rawInvoice.id)).value.review,approved=(await f.api.payAction({action:"approve",id:review.id})).value.original;
  for(const action of ["check","settle","done"])assert.equal((await f.api.payAction({action,id:approved.hash})).ok,true);
  const repeated=await f.api.payAction({action:"done",id:approved.hash});assert.equal(repeated.ok,true);assert.equal(repeated.value.kind,"archived");assert.equal((await f.api.payHistory(null)).value.records.length,1);assert.equal(f.posts(),1);f.lifecycle.lock();
});
test("Desktop paid invoice review returns original archived receipt, never another approval token",async()=>{
  const f=await harness(),review=(await f.api.payReview(f.input.rawInvoice.id)).value.review,approved=(await f.api.payAction({action:"approve",id:review.id})).value.original;
  for(const action of ["check","settle","done"])await f.api.payAction({action,id:approved.hash});const result=await f.api.payReview(f.input.rawInvoice.id);
  assert.equal(result.ok,true);assert.equal(result.value.kind,"archived");assert.equal(result.value.original.hash,approved.hash);assert.equal("review" in result.value,false);assert.equal(f.posts(),1);assert.equal(f.decryptions(),1);f.lifecycle.lock();
});
for(const change of ["close","edit","account","lock"])test(`Desktop renderer discards late approval after ${change}, retained original remains restorable`,async()=>{
  const f=await harness(),views=[],context={open:true,account:f.identity.account,keyRevision:1,locked:false},ui=createDesktopPayUI({api:f.api,getContext:()=>({...context}),render:view=>views.push(view)});await ui.open();await ui.review(f.input.rawInvoice.id);
  let finish;f.state.broadcast=()=>new Promise(resolve=>finish=resolve);const pending=ui.approve();while(!finish)await new Promise(resolve=>setImmediate(resolve));
  if(change==="close")context.open=false;if(change==="account")context.account="another";if(change==="lock")context.locked=true;await ui.clear();const last=views.at(-1);finish({hash:"irrelevant"});await pending;assert.equal(views.at(-1),last);
  assert.ok(await f.store.signedPayProgress(f.identity.account,f.input.policy,()=>{}));assert.equal(f.posts(),1);f.lifecycle.lock();
});
test("Desktop renderer lost acknowledgement offers restore, never automatic reapproval or settlement",async()=>{
  const f=await harness(),views=[],ui=createDesktopPayUI({api:f.api,getContext:()=>({open:true,account:f.identity.account,keyRevision:1,locked:false}),render:view=>views.push(view)});await ui.open();await ui.review(f.input.rawInvoice.id);f.state.broadcast=async()=>{throw Error("lost ACK")};await ui.approve();assert.match(views.at(-1).error,/Do not pay again/);
  await ui.approve();assert.equal(f.posts(),1);await ui.restore();assert.equal(views.at(-1).original.status,"transfer_unconfirmed");await ui.review(f.input.rawInvoice.id);assert.equal(f.decryptions(),1);assert.equal(f.submits(),0);f.lifecycle.lock();
});
test("Desktop renderer lost settlement disables repeat submission until original receipt read, never blind retry",async()=>{
  const f=await harness(),views=[],ui=createDesktopPayUI({api:f.api,getContext:()=>({open:true,account:f.identity.account,keyRevision:1,locked:false}),render:view=>views.push(view)});await ui.open();await ui.review(f.input.rawInvoice.id);await ui.approve();await ui.action("check");f.state.submit=async()=>{throw Error("lost settlement ACK")};
  await ui.action("settle");assert.equal(views.at(-1).settleBlocked,true);await ui.action("settle");assert.equal(f.submits(),1);await ui.action("receipt");assert.equal(views.at(-1).original.settlementVerified,true);await ui.action("done");assert.equal(views.at(-1).original.status,"archived");f.lifecycle.lock();
});
test("Desktop Pay history paging rejects wrong-account, duplicate, pending and forged-finality rows",async()=>{
  const f=await harness(),views=[],context={open:true,account:f.identity.account,keyRevision:1,locked:false};
  const record={account:context.account,hash:"0x"+"1".repeat(64),invoiceId:f.input.rawInvoice.id,merchant:"<script>merchant</script>",recipient:f.input.rawInvoice.payoutAddress,amount:25,fee:1,total:26,status:"archived",checkpointVerified:true,settlementVerified:true,settlementAttempted:true,broadcastAttempted:true,consensusFinality:false};
  let page={account:context.account,records:[record],nextCursor:record.hash};const cursors=[],api={...f.api,payHistory:async cursor=>{cursors.push(cursor);return {ok:true,value:page}}},ui=createDesktopPayUI({api,getContext:()=>({...context}),render:view=>views.push(view)});await ui.open();assert.equal((await ui.history()).length,1);
  page={account:context.account,records:[{...record,hash:"0x"+"2".repeat(64)}],nextCursor:null};assert.equal((await ui.history(true)).length,2);assert.deepEqual(cursors,[null,record.hash]);assert.equal(views.at(-1).historyCursor,null);
  for(const patch of [{account:"other"},{status:"transfer_unconfirmed",settlementVerified:false,checkpointVerified:false},{consensusFinality:true},{payload:"signed-original"}]){page={account:context.account,records:[{...record,...patch}],nextCursor:null};assert.equal(await ui.history(),null);assert.ok(views.at(-1).error)}
  page={account:context.account,records:[record,record],nextCursor:null};assert.equal(await ui.history(),null);f.lifecycle.lock();
});
test("Desktop actual modal mounts service workflow, escaped facts, retained hash controls and paid history",async()=>{
  const f=await harness(),html=await readFile(new URL("../src/index.html",import.meta.url),"utf8"),ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1])),nodes=new Map();
  const get=selector=>{assert.ok(ids.has(selector.slice(1)),`Mounted HTML ${selector}`);if(!nodes.has(selector))nodes.set(selector,{open:false,value:"",hidden:false,disabled:false,textContent:"",children:[],listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn)},async emit(type,event={}){await this.listeners.get(type)?.(event);await new Promise(resolve=>setImmediate(resolve))},showModal(){this.open=true},close(){this.open=false;this.listeners.get("close")?.()},focus(){},replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}});return nodes.get(selector)};
  const querySelector=selector=>fileInputDOM(get(selector),next=>nodes.set(selector,next));
  const document={querySelector,createElement:()=>({textContent:""})};mountDesktopPayUI({document,api:f.api,getContext:()=>({account:f.identity.account,keyRevision:f.lifecycle.status().revision,locked:f.lifecycle.status().locked})});
  await get("#open-protected-pay").emit("click");await new Promise(resolve=>setTimeout(resolve,20));assert.equal(get("#protected-pay-sheet").open,true);assert.equal(f.posts(),0);
  get("#protected-pay-reference").value=f.input.rawInvoice.id;await get("#protected-pay-form").emit("submit",{preventDefault(){}});while(get("#protected-pay-review").disabled)await new Promise(resolve=>setImmediate(resolve));assert.equal(get("#protected-pay-approve").hidden,false);
  await get("#protected-pay-approve").emit("click");while(get("#protected-pay-restore").disabled)await new Promise(resolve=>setImmediate(resolve));assert.equal(get("#protected-pay-done").disabled,true);
  await get("#protected-pay-check").emit("click");while(get("#protected-pay-restore").disabled)await new Promise(resolve=>setImmediate(resolve));assert.equal(get("#protected-pay-settle").disabled,false);
  await get("#protected-pay-settle").emit("click");while(get("#protected-pay-restore").disabled)await new Promise(resolve=>setImmediate(resolve));assert.equal(get("#protected-pay-done").disabled,false);
  await get("#protected-pay-done").emit("click");while(get("#protected-pay-restore").disabled)await new Promise(resolve=>setImmediate(resolve));await get("#protected-pay-history").emit("click");assert.match(get("#protected-pay-history-list").children[0].textContent,/verified Pay settlement/);assert.equal(f.posts(),1);assert.equal(f.decryptions(),1);
  get("#protected-pay-sheet").close();assert.equal(get("#protected-pay-facts").children.length,0);f.lifecycle.lock();
});
test("Desktop mounted QR is local reference-only and fences same-account close/reopen before decoding",async()=>{
  const f=await harness(),nodes=new Map();let decodes=0;
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{open:false,value:"",hidden:false,disabled:false,textContent:"",children:[],listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn)},emit(type,event={}){return this.listeners.get(type)?.(event)},showModal(){this.open=true},close(){this.open=false;this.listeners.get("close")?.()},focus(){},replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}});return nodes.get(selector)};
  const api={...f.api,invoiceReferenceQR:async input=>{decodes++;assert.equal(input.bytes.byteLength,1);return f.api.invoiceReferenceQR(input)}};
  mountDesktopPayUI({document:{querySelector:selector=>fileInputDOM(get(selector),next=>nodes.set(selector,next)),createElement:()=>({textContent:""})},api,getContext:()=>({account:f.identity.account,keyRevision:f.lifecycle.status().revision,locked:f.lifecycle.status().locked})});
  get("#protected-pay-sheet").showModal();const qr=get("#protected-pay-qr");
  qr.files=[{type:"image/png",size:1,arrayBuffer:async()=>new ArrayBuffer(1)}];await qr.emit("change");assert.equal(decodes,0);
  qr.emit("click");let finish;qr.files=[{type:"image/png",size:1,arrayBuffer:()=>new Promise(resolve=>finish=resolve)}];const pending=qr.emit("change");
  get("#protected-pay-sheet").close();get("#open-protected-pay").emit("click");get("#protected-pay-reference").value="current-input";finish(new ArrayBuffer(1));await pending;assert.equal(decodes,0);assert.equal(get("#protected-pay-reference").value,"current-input");
  const fresh=get("#protected-pay-qr");assert.notEqual(fresh,qr);fresh.emit("click");qr.files=[{type:"image/png",size:1,arrayBuffer:async()=>{throw Error("Old chooser must not read")}}];await qr.emit("change");assert.equal(decodes,0);
  fresh.files=[{type:"image/png",size:1,arrayBuffer:async()=>new ArrayBuffer(1)}];fresh.value="chosen";await fresh.emit("change");assert.equal(fresh.value,"");assert.equal(decodes,1);assert.equal(get("#protected-pay-reference").value,f.input.rawInvoice.id);
  assert.equal(f.calls.filter(call=>call.channel==="wallet:pay-review").length,0);assert.equal(f.posts(),0);assert.equal(f.decryptions(),0);get("#protected-pay-sheet").close();f.lifecycle.lock();
});

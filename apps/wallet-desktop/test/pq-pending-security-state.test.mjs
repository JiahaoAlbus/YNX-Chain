import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {projectPendingTransactions} from '../src/transaction-resolution-display.mjs';
import {appendPQBroadcastActions} from '../src/wallet-pq-broadcast-ui.mjs';
const account='0x'+'11'.repeat(20),other='0x'+'22'.repeat(20),hash='0x'+'33'.repeat(32);
const row={hash,account,kind:'pq-transfer',operationId:'PUBLIC-original',status:'pq-submission-unknown',canRetryExact:false,resultStorageConfirmed:true,resultHeldInMemory:false};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
function fixture(source){
 const nodes=new Map(),reads=[],query=[];class Element{constructor(doc){this.ownerDocument=doc;this.children=[];this.textContent='';this.hidden=false;this.disabled=false;this.dataset={};this.style={};this.listeners={};}append(...v){this.children.push(...v)}replaceChildren(...v){this.children=v}addEventListener(name,fn){this.listeners[name]=fn}close(){}}
 const doc={querySelector(name){if(!nodes.has(name))nodes.set(name,new Element(doc));return nodes.get(name)},querySelectorAll:()=>[],createElement(){return new Element(doc)}};
 const api={pendingTransactions:()=>{const g=gate();reads.push(g);return g.promise},queryPQSubmission:async h=>{query.push(h);return {ok:false,error:{code:'PUBLIC'}}}};
 const noop=()=>{},ctx={document:doc,window:{ynxWallet:api},activeAccount:account,accountState:{initialized:true},accountStatusObserved:false,transactionRevision:0,transactionActionRevision:0,securityViewRevision:0,accountSecurityIntent:0,keyState:{account,revision:1,locked:false,authenticating:false,unlockAvailable:true},projectPendingTransactions,
  appendPQOriginalRecoveryActions:noop,appendPQProgressActions:noop,appendPQBroadcastActions:options=>appendPQBroadcastActions({...options,document:doc}),copyUI:(n,t)=>n.textContent=t,renderKeyDetail:noop,updateOriginalAdmissionSecurity:noop,renderDeviceCreationStatus:noop,refreshDeviceCreationStatus:noop,invalidatePaymentInput:noop,clearInvoiceInput:noop,invalidateWalletConnectSessions:noop,clearAssetBalance:noop,clearTransactionResolution:null,showAccountError:noop,presentApproval:noop,
  desktopUI:null,nativePayProductUI:null,desktopHistoryUI:null,transactionHistoryUI:{refresh:noop},transferReviewSummaryUI:null,aiTaskReviewObserver:{invalidate:noop},contractUI:{clear:noop},accountOperationOwners:new Map(),accountOperationCurrent:()=>false,accountSelectionPendingCurrent:()=>false,multichainUI:null,familyUI:null,ideIdentityUI:null,projectControlUI:null,passwordUI:null,deviceRegistrationUI:null,approvalQueue:{clear:noop,suspend:noop},authorizationChoices:{clear:noop},signingShort:new Element(doc),transferReview:null};
 const a=source.indexOf('function clearTransactionResolution()'),b=source.indexOf('\ndocument.querySelector("#refresh-pending-transactions")',a),c=source.indexOf('function renderKeyState(state)'),d=source.indexOf('\npasswordUI = createPasswordVaultUI',c);assert(a>=0&&b>a&&c>=0&&d>c);
 runInNewContext(source.slice(a,b)+'\n'+source.slice(c,d),ctx);return{ctx,nodes,reads,query,api};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
const findQuery=f=>f.nodes.get('#pending-transactions').children.flatMap(r=>r.children).find(n=>n.textContent.includes('Query the same PQ submission'));
test('PUBLIC lock and unlock refresh original recovery controls without extra query or signing',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),f=fixture(source);const first=f.ctx.refreshTransactions();f.reads[0].resolve({ok:true,value:[row]});await first;assert.equal(findQuery(f).disabled,false);const retired=findQuery(f);
 f.ctx.renderKeyState({account,revision:2,locked:true,authenticating:false,unlockAvailable:true});assert.equal(f.reads.length,2);f.reads[1].resolve({ok:true,value:[row]});await settled();assert.equal(findQuery(f).disabled,true);await retired.listeners.click();assert.deepEqual(f.query,[]);
 f.ctx.renderKeyState({account,revision:3,locked:false,authenticating:false,unlockAvailable:true});assert.equal(f.reads.length,3);f.reads[2].resolve({ok:true,value:[row]});await settled();assert.equal(findQuery(f).disabled,false);assert.deepEqual(f.query,[]);
});
test('PUBLIC late old security snapshot cannot republish after lock or account switch',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),f=fixture(source);const old=f.ctx.refreshTransactions();f.ctx.renderKeyState({account,revision:2,locked:true,authenticating:false,unlockAvailable:true});assert.equal(f.reads.length,2);f.reads[1].resolve({ok:true,value:[row]});await settled();f.reads[0].resolve({ok:true,value:[]});await old;assert.equal(findQuery(f).disabled,true);
 f.ctx.renderKeyState({account:other,revision:3,locked:true,authenticating:false,unlockAvailable:true});assert.equal(f.nodes.get('#pending-transactions').children.length,0);assert.equal(f.reads.length,2);assert.deepEqual(f.query,[]);
});

test('PUBLIC unchanged security state makes no extra read; account view alignment reads only its own pending original',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),f=fixture(source);f.ctx.renderKeyState({account,revision:1,locked:false,authenticating:false,unlockAvailable:true});assert.equal(f.reads.length,0);
 f.ctx.renderKeyState({account:other,revision:2,locked:true,authenticating:false,unlockAvailable:true});assert.equal(f.reads.length,0);f.ctx.activeAccount=other;const fresh=f.ctx.refreshTransactions(),newRow={...row,account:other,hash:'0x'+'44'.repeat(32)};f.reads[0].resolve({ok:true,value:[newRow]});await fresh;const button=findQuery(f);assert(button.disabled);assert(f.nodes.get('#pending-transactions').children[0].children[0].textContent.includes(newRow.hash));assert(!f.nodes.get('#pending-transactions').children[0].children[0].textContent.includes(hash));assert.deepEqual(f.query,[]);
});

test('PUBLIC late original read acknowledgement after lock cannot update the new session or repeat the query',async()=>{
 const source=await readFile(new URL('../src/renderer.js',import.meta.url),'utf8'),f=fixture(source);const first=f.ctx.refreshTransactions();f.reads[0].resolve({ok:true,value:[row]});await first;const original=findQuery(f),pending=gate();let checks=0;f.api.queryPQSubmission=h=>{checks++;assert.equal(h,hash);return pending.promise};const action=original.listeners.click();assert.equal(checks,1);
 f.ctx.renderKeyState({account,revision:2,locked:true,authenticating:false,unlockAvailable:true});f.reads[1].resolve({ok:true,value:[row]});await settled();pending.resolve({ok:true,value:{account,hash,kind:'pq-transfer',status:'inclusion-observed',consensusFinality:false,canRetry:false,clearsOriginal:false}});await action;assert.equal(checks,1);assert.equal(findQuery(f).disabled,true);assert.equal(f.nodes.get('#transaction-resolution-result').textContent,'');assert.equal(f.reads.length,2);
});

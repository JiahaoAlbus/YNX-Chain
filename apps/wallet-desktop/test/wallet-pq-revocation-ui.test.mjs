import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
import {createPQRevocationReviewUI} from '../src/wallet-pq-revocation-ui.mjs';
import {formatApprovalReview} from '../src/approval-review-display.mjs';
function fixture(prepare){
 const nodes=[],section={append(...items){this.children=items;}},state={account:'0x'+'11'.repeat(20),revision:1,locked:false,authenticating:false},calls=[];
 const document={querySelector:selector=>{assert.equal(selector,'#backup-section');return section;},createElement(tag){const node={tag,checked:false,disabled:false,textContent:'',handlers:new Map(),setAttribute(){},append(...children){this.children=children;},addEventListener(event,fn){this.handlers.set(event,fn);}};nodes.push(node);return node;}};
 const ui=createPQRevocationReviewUI({document,getKeyState:()=>state,api:{preparePQRevocation:async input=>{calls.push(input);return prepare?prepare(input):{ok:true,value:{requestId:'QA-review',submitted:false}};}}});
 const [form,help,label,ack,button,result]=nodes;return {ui,form,help,label,ack,button,result,state,calls,submit:()=>form.handlers.get('submit')({preventDefault(){}}),acknowledge(){ack.checked=true;ack.handlers.get('change')();}};
}
test('revocation UI initializes without reading uninitialized renderer state; requires acknowledgement and unlock',async()=>{
 let ready=false;const nodes=[],doc={querySelector:()=>({append(){}}),createElement:()=>{const n={append(){},setAttribute(){},addEventListener(){}};nodes.push(n);return n;}};
 createPQRevocationReviewUI({document:doc,getKeyState:()=>{assert.equal(ready,true);return {locked:false};},api:{}});ready=true;
 const f=fixture();f.ui.render();assert.equal(f.button.disabled,true);await f.submit();assert.equal(f.calls.length,0);f.acknowledge();assert.equal(f.button.disabled,false);
 f.state.locked=true;f.ui.render();assert.equal(f.button.disabled,true);await f.submit();assert.equal(f.calls.length,0);
});
test('revocation UI sends empty review request only, not key/policy/nonce/sign/send input',async()=>{
 const f=fixture();f.ui.render();f.acknowledge();await f.submit();assert.deepEqual(f.calls,[{}]);assert.match(f.result.textContent,/尚未签名或发送/);assert.match(f.help.textContent,/所有已登记待生效/);
});
test('revocation UI suppresses late account or lock response and does not auto retry',async()=>{
 let release;const f=fixture(()=>new Promise(resolve=>{release=resolve;}));f.ui.render();f.acknowledge();const running=f.submit();await f.submit();assert.equal(f.calls.length,1);
 f.state.revision++;f.state.locked=true;f.ui.invalidate();assert.equal(f.ack.checked,false);release({ok:true,value:{requestId:'late',submitted:false}});await running;assert.equal(f.result.textContent,'');assert.equal(f.calls.length,1);assert.equal(f.button.disabled,true);
});
test('revocation main and preload actual handlers connect only review into existing approval queue',async()=>{
 const main=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),start=main.indexOf("handleWalletIPC('wallet:pq-revocation-review'"),end=main.indexOf('\nhandleWalletIPC("wallet:transaction-history"',start),handlers=new Map(),events=[],calls=[];
 assert.ok(start>=0&&end>start);const request={id:'QA-pending',method:'ynx_signPQRevocation'};
 const account='0x'+'11'.repeat(20),guard={account,assert(){}};
 runInNewContext(main.slice(start,end),{handleWalletIPC:(name,fn)=>handlers.set(name,fn),sensitiveIPC:fn=>fn(),walletAuthority:{async requestPQRevocation(input){calls.push(input);return {request};},async accountStatus(){return {account};},transactionSender:{submissions:{async recoverPQOriginal(...args){return args;}}}},keyAccess:{current:()=>guard},mainWindow:{webContents:{send:(...args)=>events.push(args)}}});
 const response=await handlers.get('wallet:pq-revocation-review')({},{});assert.equal(response.requestId,'QA-pending');assert.equal(response.submitted,false);assert.equal(events[0][0],'wallet:provider-request');assert.equal(events[0][1],request);assert.equal(calls.length,1);
 let api;const invoked=[];runInNewContext(readFileSync(new URL('../src/preload.cjs',import.meta.url),'utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:(...args)=>{invoked.push(args);}}};}});
 api.preparePQRevocation({});assert.equal(invoked[0][0],'wallet:pq-revocation-review');assert.equal(Object.keys(invoked[0][1]).length,0);
 const hash='0x'+'01'.repeat(32),saved=await handlers.get('wallet:pq-original-save')({},hash),reconciled=await handlers.get('wallet:pq-original-reconcile')({},hash);
 assert.equal(saved[0],hash);assert.equal(saved[1],account);assert.equal(saved[2],guard);assert.equal(saved.length,3);assert.equal(reconciled[3].readOnly,true);
 api.savePQOriginal(hash);api.reconcilePQOriginal(hash);assert.equal(invoked[1][0],'wallet:pq-original-save');assert.equal(invoked[2][0],'wallet:pq-original-reconcile');
});
test('approval review names terminal scope and exact u64 heights without numerical coercion',()=>{
 const formatted=formatApprovalReview({title:'Revocation',authorizingRevision:'1',throughRevision:'2',executionHeight:'9007199254740994',revokeAt:'9007199254740995',nonce:'9007199254740996',warning:'Save only; no broadcast.'});
 for(const text of ['Current signing key revision: 1','Revoke through pending revision: 2','9007199254740994','9007199254740995','9007199254740996','no broadcast'])assert.ok(formatted.includes(text));
 const renderer=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8');assert.match(renderer,/createPQRevocationReviewUI\(\{api:window\.ynxWallet/);assert.match(renderer,/if\(securityChanged\)pqRevocationReviewUI\.invalidate\(\)/);
});

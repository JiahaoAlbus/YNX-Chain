import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
import {appendPQProgressActions} from '../src/wallet-pq-progress-ui.mjs';
function fixture(perform){
 const row={children:[],append(...items){this.children.push(...items);}},state={account:'0x'+'11'.repeat(20),revision:1,locked:false,authenticating:false},record={account:state.account,hash:'0x'+'01'.repeat(32),kind:'pq-transfer',status:'pq-inclusion-observed',resultStorageConfirmed:false,resultHeldInMemory:true},calls=[],messages=[];let refresh=0;
 const document={createElement:tag=>({tag,textContent:'',addEventListener(_name,fn){this.click=fn;}})},api={readPQProgress:async hash=>{calls.push(['read',hash]);return perform?perform():{ok:true,value:{account:record.account,hash,status:'inclusion-observed',storageConfirmed:false,retryAuthorized:false,clearsOriginal:false,consensusFinality:false}};},flushPQProgressResult:async hash=>{calls.push(['flush',hash]);return {ok:true,value:{account:record.account,hash,status:'inclusion-observed',stored:true,retryAuthorized:false,clearsOriginal:false,consensusFinality:false}};}};
 appendPQProgressActions({row,record,api,getKeyState:()=>state,isCurrent:()=>true,onResult:text=>messages.push(text),onRefresh:()=>{refresh++;},document});
 return {row,state,record,calls,messages,buttons:row.children.filter(node=>node.tag==='button'),refresh:()=>refresh};
}
test('held response UI warns storage is unconfirmed; separate clicks only read or save same local result',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.match(f.row.children[0].textContent,/尚未确认持久化/);await f.buttons[0].click();assert.deepEqual(f.calls,[['read',f.record.hash]]);assert.match(f.messages[0],/尚未确认持久化/);await f.buttons[1].click();assert.deepEqual(f.calls,[['read',f.record.hash],['flush',f.record.hash]]);assert.match(f.messages[1],/没有发送交易/);assert.equal(f.refresh(),2);
});
test('progress UI lock/account switch fences local actions and late results without automatic flush',async()=>{
 const locked=fixture();locked.state.locked=true;await locked.buttons[1].click();assert.equal(locked.calls.length,0);
 let release;const f=fixture(()=>new Promise(resolve=>{release=resolve;})),work=f.buttons[0].click();await f.buttons[1].click();assert.equal(f.calls.length,1);f.state.revision++;f.state.account='0x'+'22'.repeat(20);release({ok:true,value:{account:f.record.account,hash:f.record.hash,storageConfirmed:true,retryAuthorized:false,clearsOriginal:false,consensusFinality:false}});await work;assert.equal(f.messages.length,0);assert.equal(f.refresh(),0);assert.equal(f.calls.length,1);
});
test('durable result with pending diagnostics remains distinguishable and offers only a local save',async()=>{
 const row={children:[],append(...items){this.children.push(...items);}},record={account:'0x'+'11'.repeat(20),hash:'0x'+'01'.repeat(32),status:'pq-inclusion-observed',resultStorageConfirmed:true,resultHeldInMemory:true},document={createElement:tag=>({tag,textContent:'',addEventListener(){}})};
 appendPQProgressActions({row,record,api:{},getKeyState:()=>({locked:false}),isCurrent:()=>true,onResult(){},onRefresh(){},document});assert.match(row.children[0].textContent,/诊断元数据仅保留在内存/);assert.equal(row.children.filter(node=>node.tag==='button').length,2);
});
test('actual renderer distinguishes all PQ progress states and does not label an entered submission unsubmitted',()=>{
 const source=readFileSync(new URL('../src/renderer.js',import.meta.url),'utf8'),start=source.indexOf("      if(['pq-transfer','pq-migration','pq-revocation'].includes(record.kind))"),end=source.indexOf('\n      copyUI(description',start);assert.ok(start>=0&&end>start);
 for(const [status,expected] of [['pq-submission-unknown','Original submission entered; outcome unknown'],['pq-inclusion-observed','Inclusion of the same original observed'],['pq-rejection-observed','Original submission rejection observed']]){
  const rows=[],document={createElement:()=>({children:[],append(...items){this.children.push(...items);},addEventListener(){},textContent:''})},record={account:'0x'+'11'.repeat(20),hash:'0x'+'01'.repeat(32),kind:'pq-transfer',operationId:'QA',status,resultStorageConfirmed:true,resultHeldInMemory:false};
  runInNewContext('for(const record of records){const row=document.createElement("div"),description=document.createElement("p");'+source.slice(start,end)+'}',{records:[record],document,list:{append:r=>rows.push(r)},keyState:{locked:false},window:{ynxWallet:{}},current:()=>true,appendPQOriginalRecoveryActions(){},appendPQProgressActions(){}});
  const text=rows[0].children.map(node=>node.textContent).join(' ');assert.ok(text.includes(expected));assert.equal(text.includes('Signed result saved locally, not submitted.'),false);
 }
});
test('actual progress main/preload exposes only selected-account local read/flush, never result DTO or submission entry',async()=>{
 const main=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8'),start=main.indexOf("handleWalletIPC('wallet:pq-progress-read'"),end=main.indexOf('\nhandleWalletIPC("wallet:transaction-history"',start),handlers=new Map(),calls=[],account='0x'+'11'.repeat(20),guard={account,assert(){}};assert.ok(start>=0&&end>start);
 runInNewContext(main.slice(start,end),{handleWalletIPC:(name,fn)=>handlers.set(name,fn),sensitiveIPC:fn=>fn(),keyAccess:{current:()=>guard},walletAuthority:{accountStatus:async()=>({account}),transactionSender:{submissions:{intentStore:{readPQProgress:async(...args)=>calls.push(['read',...args]),flushPQProgressResult:async(...args)=>calls.push(['flush',...args])}}}}});
 const hash='0x'+'01'.repeat(32);await handlers.get('wallet:pq-progress-read')({},hash);await handlers.get('wallet:pq-progress-flush')({},hash);assert.equal(calls[0][0],'read');assert.equal(calls[1][0],'flush');assert.equal(calls[0][1],account);assert.equal(calls[0][2],hash);assert.equal(typeof calls[0][3],'function');
 let api;const invoked=[];runInNewContext(readFileSync(new URL('../src/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:(...args)=>invoked.push(args)}})});api.readPQProgress(hash);api.flushPQProgressResult(hash);assert.deepEqual(invoked[0],['wallet:pq-progress-read',hash]);assert.deepEqual(invoked[1],['wallet:pq-progress-flush',hash]);assert.equal('beginPQSubmission' in api,false);assert.equal('savePQSubmissionResult' in api,false);
});

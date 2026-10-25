import test from 'node:test';
import assert from 'node:assert/strict';
import {appendPQBroadcastActions} from '../../wallet-pq-broadcast-ui.mjs';
const account='0x'+'12'.repeat(20),hash='0x'+'34'.repeat(32);
function fixture({status='pq-submission-unknown',response,query,locked=false,authenticating=false,selectedAccount=account,current=true}={}){
 const children=[],calls=[],messages=[],state={account:selectedAccount,locked,authenticating,revision:1};let refreshes=0,live=current;
 const row={append:el=>children.push(el)},doc={createElement(tag){return{tag,type:'',textContent:'',disabled:false,listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}}}},record={account,hash,kind:'pq-account-initial',status};
 const api={async queryPQSubmission(value){calls.push(['query',value]);return query?query():response??{ok:true,value:{account,hash,kind:'pq-account-initial',consensusFinality:false,canRetry:false,clearsOriginal:false}};},preparePQBroadcast(){calls.push(['ordinary-approval']);throw Error('NO_APPROVAL');},preparePQAccountInitialBroadcast(){calls.push(['initial-approval']);throw Error('NO_APPROVAL');}};
 appendPQBroadcastActions({row,record,api,getKeyState:()=>state,isCurrent:()=>live,onResult:text=>messages.push(text),onRefresh:()=>{refreshes++;},document:doc});
 return{children,calls,messages,state,record,refreshes:()=>refreshes,setCurrent:v=>{live=v},click:()=>children.find(c=>c.tag==='button')?.listeners.click()};
}
test('initial UNKNOWN, inclusion and rejection rows expose only the original read-only query',async()=>{
 for(const status of ['pq-submission-unknown','pq-inclusion-observed','pq-rejection-observed']){
  const f=fixture({status}),before={...f.record};assert.equal(f.children.length,1);assert.match(f.children[0].textContent,/Query the same PQ submission/);
  await f.click();assert.deepEqual(f.calls,[['query',hash]]);assert.match(f.messages[0],/Same submission read/);assert.equal(f.refreshes(),1);assert.deepEqual(f.record,before);
 }
});
test('initial unsubmitted or unconfirmed-save rows never gain the generic broadcast button',()=>{
 for(const status of ['pq-signed-unsubmitted','pq-save-unconfirmed','pq-finality-save-unknown','pq-finalized-succeeded'])assert.equal(fixture({status}).children.length,0);
});
test('initial query binds account, native hash, kind and false retry/finality flags before displaying success',async()=>{
 const good={account,hash,kind:'pq-account-initial',consensusFinality:false,canRetry:false,clearsOriginal:false};
 for(const change of [{account:'0x'+'22'.repeat(20)},{hash:'0x'+'56'.repeat(32)},{kind:'pq-transfer'},{canRetry:true},{clearsOriginal:true},{consensusFinality:true}]){
  const f=fixture({response:{ok:true,value:{...good,...change}}});await f.click();assert.deepEqual(f.calls,[['query',hash]]);assert.match(f.messages[0],/Original submission unverified/);assert.equal(f.messages.some(m=>/Same submission read/.test(m)),false);
 }
});
test('initial query refuses locked, authenticating, stale or different-account UI before IPC',async()=>{
 for(const options of [{locked:true},{authenticating:true},{selectedAccount:'0x'+'22'.repeat(20)},{current:false}]){const f=fixture(options);assert.equal(f.children.length,1);await f.click();assert.equal(f.calls.length,0);assert.equal(f.messages.length,0);}
});
test('initial query late callback is discarded and duplicate click never becomes approval or POST',async()=>{
 let release;const pending=new Promise(r=>{release=r}),f=fixture({query:()=>pending}),first=f.click();await f.click();assert.deepEqual(f.calls,[['query',hash]]);f.state.revision++;release({ok:true,value:{account,hash,kind:'pq-account-initial',consensusFinality:false,canRetry:false,clearsOriginal:false}});await first;assert.equal(f.messages.length,0);assert.equal(f.refreshes(),0);assert.equal(f.children[0].disabled,true);
});
test('initial query IPC failure keeps the single query consumed without automatic retry',async()=>{
 const f=fixture({query:()=>{throw false;}});await f.click();await f.click();assert.deepEqual(f.calls,[['query',hash]]);assert.match(f.messages[0],/Operation unconfirmed/);assert.equal(f.children[0].disabled,true);
});

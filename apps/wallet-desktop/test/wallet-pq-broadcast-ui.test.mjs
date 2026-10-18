import test from 'node:test';
import assert from 'node:assert/strict';
import {appendPQBroadcastActions} from '../src/wallet-pq-broadcast-ui.mjs';
const account='0x'+'11'.repeat(20),hash='0x'+'22'.repeat(32);
function fixture(status,api){let button;const messages=[],state={account,revision:1,locked:false},row={append:b=>{button=b;}};
 const document={createElement:()=>({addEventListener(_name,fn){this.click=fn;}})};
 appendPQBroadcastActions({row,record:{kind:'pq-transfer',account,hash,status},api,getKeyState:()=>state,isCurrent:()=>true,onResult:text=>messages.push(text),onRefresh(){},document});return{button,state,messages};}
test('broadcast button requests separate review once, and lost IPC does not enable another click',async()=>{
 let calls=0;const f=fixture('pq-signed-unsubmitted',{preparePQBroadcast:async value=>{assert.equal(value,hash);calls++;throw Error('PUBLIC ACK lost');}});
 await f.button.click();await f.button.click();assert.equal(calls,1);assert.equal(f.button.disabled,true);assert.match(f.messages[0],/unconfirmed/);
});
test('query accepts actual closed progress flags without claiming finality or granting retry',async()=>{
 let calls=0;const f=fixture('pq-submission-unknown',{queryPQSubmission:async()=>{calls++;return{ok:true,value:{account,hash,consensusFinality:false,canRetry:false,clearsOriginal:false}};}});
 await f.button.click();assert.equal(calls,1);assert.match(f.messages[0],/Same submission read/);
});
test('late lock suppresses stale approval feedback',async()=>{
 const f=fixture('pq-signed-unsubmitted',{preparePQBroadcast:async()=>{f.state.locked=true;return{ok:true,value:{requestId:'PUBLIC',submitted:false}};}});
 await f.button.click();assert.equal(f.messages.length,0);
});

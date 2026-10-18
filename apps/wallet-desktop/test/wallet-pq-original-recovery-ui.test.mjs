import test from 'node:test';import assert from 'node:assert/strict';
import {appendPQOriginalRecoveryActions} from '../src/wallet-pq-original-recovery-ui.mjs';
function fixture(perform){
 const buttons=[],calls=[],results=[],state={locked:false,authenticating:false,account:'0x'+'11'.repeat(20),revision:1},record={account:state.account,hash:'0x'+'01'.repeat(32),kind:'pq-revocation',status:'pq-save-unconfirmed'};let refresh=0;
 const document={createElement:()=>({addEventListener(_event,fn){this.click=fn;}})},row={append:button=>buttons.push(button)};
 const api={savePQOriginal:async hash=>{calls.push(['save',hash]);return perform?.()??{ok:true,value:{account:record.account,hash,savedLocally:true,submitted:false,confirmed:false}};},reconcilePQOriginal:async hash=>{calls.push(['read',hash]);return {ok:true,value:{account:record.account,hash,savedLocally:true,submitted:false,confirmed:false}};}};
 appendPQOriginalRecoveryActions({row,record,api,getKeyState:()=>state,isCurrent:()=>true,onResult:text=>results.push(text),onRefresh:()=>{refresh++;},document});
 return {buttons,calls,results,state,record,refresh:()=>refresh};
}
test('PQ original recovery buttons require explicit separate save or readonly reconciliation clicks',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.buttons.length,2);await f.buttons[0].click();assert.deepEqual(f.calls,[['save',f.record.hash]]);assert.match(f.results[0],/没有重新签名或发送/);
 await f.buttons[1].click();assert.deepEqual(f.calls,[['save',f.record.hash],['read',f.record.hash]]);assert.equal(f.refresh(),2);
});
test('PQ original recovery locked or changed-account action does not call main',async()=>{
 const f=fixture();f.state.locked=true;await f.buttons[0].click();f.state.locked=false;f.state.account='0x'+'22'.repeat(20);await f.buttons[1].click();assert.equal(f.calls.length,0);
});
test('PQ original recovery stale result does not display success or launch another action',async()=>{
 let release;const f=fixture(()=>new Promise(resolve=>{release=resolve;})),running=f.buttons[0].click();await f.buttons[1].click();assert.equal(f.calls.length,1);
 f.state.locked=true;f.state.revision++;release({ok:true,value:{account:f.record.account,hash:f.record.hash,savedLocally:true,submitted:false,confirmed:false}});await running;assert.equal(f.results.length,0);assert.equal(f.refresh(),0);assert.equal(f.calls.length,1);
});

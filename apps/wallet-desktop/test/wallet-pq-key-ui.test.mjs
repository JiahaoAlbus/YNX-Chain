import test from 'node:test';
import assert from 'node:assert/strict';
import {createPQKeyPreparationUI} from '../src/wallet-pq-key-ui.mjs';
class Element{
 children=[];listeners={};disabled=false;open=false;
 append(...nodes){this.children.push(...nodes);}setAttribute(){}
 addEventListener(type,listener){this.listeners[type]=listener;}
 showModal(){this.open=true;}close(){this.open=false;}
 click(){this.listeners.click?.();}
}
function fixture(){
 const panel=new Element(),doc={querySelector:()=>panel,createElement:()=>new Element()};
 let state={account:'TEST-A',revision:1,locked:false,authenticating:false},generates=0,reads=0,reconciles=0;
 const api={generatePQKeys:async()=>{generates++;return {ok:true,value:{persisted:true,phase:'saved'}};},pqKeyPreparationStatus:async()=>{reads++;return {ok:true,value:{phase:'save-unknown',persistenceAttempted:true,persisted:false}};},reconcilePQKeys:async()=>{reconciles++;return {ok:true,value:{persisted:true,phase:'saved'}};}};
 const ui=createPQKeyPreparationUI({api,getKeyState:()=>state,document:doc});ui.render();
 const [title,help,prepare,check,result,dialog]=panel.children[0].children,[notice,confirm,cancel]=dialog.children;
 return {ui,prepare,check,result,dialog,confirm,cancel,lock:()=>state={...state,revision:2,locked:true},counts:()=>({generates,reads,reconciles})};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('PQ preparation UI requires modal confirmation; cancel does not generate',async()=>{
 const f=fixture();f.prepare.click();assert.equal(f.dialog.open,true);assert.equal(f.counts().generates,0);
 f.cancel.click();assert.equal(f.dialog.open,false);assert.equal(f.counts().generates,0);
 f.prepare.click();f.confirm.click();await settled();assert.equal(f.counts().generates,1);assert.equal(f.prepare.disabled,true);assert.match(f.result.textContent,/尚非独立备份/);
});
test('PQ modal approval is invalidated by lock and cannot generate late',async()=>{
 const f=fixture();f.prepare.click();f.lock();f.ui.invalidate();f.confirm.click();await settled();
 assert.equal(f.dialog.open,false);assert.equal(f.counts().generates,0);assert.equal(f.prepare.disabled,true);
});
test('PQ original-result button reconciles unknown save without generating',async()=>{
 const f=fixture();f.check.click();await settled();assert.deepEqual(f.counts(),{generates:0,reads:1,reconciles:1});assert.equal(f.prepare.disabled,true);
});

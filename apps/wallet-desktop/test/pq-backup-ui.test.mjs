import test from 'node:test';
import assert from 'node:assert/strict';
import {createPQBackupUI} from '../src/pq-backup-ui.mjs';
class Element{children=[];listeners={};open=false;value='';disabled=false;append(...nodes){this.children.push(...nodes);}setAttribute(){}addEventListener(type,fn){this.listeners[type]=fn;}showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}click(){return this.listeners.click?.();}}
function fixture(){
 const root=new Element(),document={querySelector:()=>root,createElement:()=>new Element()};let state={account:'TEST-account',revision:1,locked:false,authenticating:false},exports=0,verifications=0;
 const api={exportPQBackup:async()=>{exports++;return {ok:true,value:{saved:true,verified:true,walletChanged:false,credential:'A'.repeat(43)}};},verifyPQBackup:async()=>{verifications++;return {ok:true,value:{saved:false,verified:true,walletChanged:false,credential:'B'.repeat(43)}};}};
 const ui=createPQBackupUI({api,getKeyState:()=>state,document});ui.render();const [heading,help,save,verify,result,dialog]=root.children[0].children,[notice,secret,show,confirm,close]=dialog.children;
 return {ui,api,save,verify,result,dialog,secret,show,confirm,close,lock(){state={...state,revision:2,locked:true};ui.invalidate();},counts:()=>({exports,verifications})};
}
test('PQ backup requires explicit confirmation and reveals masked separate credential only after verified file',async()=>{
 const f=fixture();f.save.click();assert.equal(f.dialog.open,true);assert.equal(f.counts().exports,0);assert.equal(f.secret.value,'');await f.confirm.click();
 assert.equal(f.counts().exports,1);assert.equal(f.secret.value,'A'.repeat(43));assert.equal(f.secret.type,'password');f.show.click();assert.equal(f.secret.type,'text');f.close.click();assert.equal(f.secret.value,'');
});
test('PQ verify is read-only API and security invalidation clears credential and stale modal',async()=>{
 const f=fixture();f.verify.click();await f.confirm.click();assert.deepEqual(f.counts(),{exports:0,verifications:1});f.lock();assert.equal(f.secret.value,'');assert.equal(f.dialog.open,false);assert.equal(f.save.disabled,true);
});
test('PQ late credential after lock is not put in the DOM',async()=>{
 const f=fixture();let resolve;f.api.exportPQBackup=()=>new Promise(r=>resolve=r);f.save.click();const pending=f.confirm.click();f.lock();resolve({ok:true,value:{saved:true,verified:true,walletChanged:false,credential:'C'.repeat(43)}});await pending;assert.equal(f.secret.value,'');assert.equal(f.dialog.open,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRegisteredPQRestoreUI} from '../src/wallet-pq-restore-ui.mjs';
class Element{children=[];listeners={};open=false;value='';disabled=false;append(...v){this.children.push(...v);}setAttribute(){}addEventListener(k,fn){this.listeners[k]=fn;}showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}click(){return this.listeners.click?.();}}
function fixture(){
 const root=new Element(),document={querySelector:()=>root,createElement:()=>new Element()};let state={account:'0x'+'1'.repeat(40),revision:1,locked:false,authenticating:false},imports=0,reads=0;
 const api={restoreRegisteredPQ:async input=>{assert.deepEqual(input,{credential:'A'.repeat(43)});imports++;return {ok:true,value:{phase:'saved',persisted:true,sourceClosed:true,cleanupDebt:false}};},recoverRegisteredPQ:async()=>{reads++;return {ok:true,value:{phase:'prepare-unknown',persisted:false,preparationUnknown:true,cleanupDebt:false}};}};
 const ui=createRegisteredPQRestoreUI({api,getKeyState:()=>state,document});ui.render();const [title,help,open,check,result,dialog]=root.children[0].children,[notice,credential,show,confirm,cancel]=dialog.children;
 return {ui,api,open,check,result,dialog,credential,show,confirm,cancel,lock(){state={...state,revision:2,locked:true};ui.invalidate();},counts:()=>({imports,reads})};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('registered restore requires explicit secret entry and confirmation, clears input before IPC and never sends a path or expected keys',async()=>{
 const f=fixture();f.open.click();assert.equal(f.dialog.open,true);assert.equal(f.credential.type,'password');assert.equal(f.counts().imports,0);f.credential.value='A'.repeat(43);f.show.click();assert.equal(f.credential.type,'text');f.confirm.click();assert.equal(f.credential.value,'');await settled();assert.equal(f.counts().imports,1);assert.equal(f.open.disabled,true);
});
test('registered restore cancel or lock clears draft and cannot submit late credential',async()=>{
 const f=fixture();f.open.click();f.credential.value='A'.repeat(43);f.cancel.click();assert.equal(f.credential.value,'');assert.equal(f.counts().imports,0);f.open.click();f.credential.value='A'.repeat(43);f.lock();f.confirm.click();await settled();assert.equal(f.counts().imports,0);assert.equal(f.dialog.open,false);
});
test('known wrong credential stays a pre-import refusal with explicit retry; no hidden retry or query',async()=>{
 const f=fixture();f.api.restoreRegisteredPQ=async()=>({ok:false,error:{code:'PQ_RESTORE_CREDENTIAL_MISMATCH',data:{code:'PQ_RESTORE_CREDENTIAL_MISMATCH',phase:'failed',persisted:false,cleanupDebt:false}}});f.open.click();f.credential.value='A'.repeat(43);f.confirm.click();await settled();assert.match(f.result.textContent,/尚未写入/);assert.equal(f.open.disabled,false);assert.equal(f.counts().reads,0);
});
test('registered restore local-result check is readonly and never repeats an unresolved import',async()=>{
 const f=fixture();f.check.click();await settled();assert.deepEqual(f.counts(),{imports:0,reads:1});assert.equal(f.open.disabled,true);
});
test('registered restore normal main uses frozen original factory and only protected local methods',async()=>{
 const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await readFile(new URL('../src/preload.cjs',import.meta.url),'utf8');
 assert.ok(main.includes('pqRegisteredRestore=createRegisteredPQRestore('));assert.ok(main.includes('acquire:acquireOriginalWalletRegisteredBinding,isOriginal:isOriginalWalletRegisteredBinding'));assert.ok(main.includes("handleWalletIPC('wallet:pq-restore',(_event,input)=>safeIPC(()=>pqRegisteredRestore.restore(input)))"));assert.ok(preload.includes("restoreRegisteredPQ:input=>ipcRenderer.invoke('wallet:pq-restore',input)"));assert.equal(preload.includes('RegisteredBindingResourceKernel'),false);assert.equal(preload.includes('withPQBackup'),false);
});

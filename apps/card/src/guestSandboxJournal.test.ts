import test from 'node:test';
import assert from 'node:assert/strict';
import {locales} from './i18n';
import {GUEST_SANDBOX_KEY,GuestSandboxJournal,guestSandboxStorageText,validGuestSandbox} from './guestSandboxJournal';
function storage(raw:string|null=null){return {raw,getItem(key:string){assert.equal(key,GUEST_SANDBOX_KEY);return this.raw},setItem(key:string,value:string){assert.equal(key,GUEST_SANDBOX_KEY);this.raw=value}}}
function record(journal:GuestSandboxJournal){return {...journal.snapshot,controls:{frozen:true,online:false,international:true},events:[{id:1,label:'Simulate authorization',detail:'Authorization decision prepared locally'}]}}
test('browser journal restores only explicitly local demo controls and whitelist audit events',()=>{
 const store=storage(),first=new GuestSandboxJournal(store);
 assert.equal(first.save(record(first)),true);
 const restored=new GuestSandboxJournal(store);
 assert.deepEqual(restored.snapshot,record(first));assert.equal(restored.status,'local');
 assert.doesNotMatch(store.raw!,/account|balance|transactionHash|PAN|CVV/);
});
test('malformed or foreign storage remains byte-for-byte preserved without an overwrite',()=>{
 for(const raw of ['{',JSON.stringify({account:'private'}),'x'.repeat(65_537)]){
  const store=storage(raw),journal=new GuestSandboxJournal(store);
  assert.equal(journal.status,'preserved');assert.equal(journal.save(record(journal)),false);assert.equal(store.raw,raw);
 }
});
test('same-browser concurrent writer does not overwrite a newer saved demo history',()=>{
 const store=storage(),one=new GuestSandboxJournal(store),two=new GuestSandboxJournal(store);
 assert.equal(one.save(record(one)),true);const saved=store.raw;
 assert.equal(two.save({...record(two),events:[]}),false);assert.equal(two.status,'preserved');assert.equal(store.raw,saved);
});
test('unavailable, denied or unconfirmed storage never claims saved recovery',()=>{
 const memory=new GuestSandboxJournal();assert.equal(memory.save(record(memory)),false);assert.equal(memory.status,'temporary');
 const denied=new GuestSandboxJournal({getItem:()=>null,setItem:()=>{throw Error('quota')}});
 assert.equal(denied.save(record(denied)),false);assert.equal(denied.status,'preserved');
 const silent=new GuestSandboxJournal({getItem:()=>null,setItem:()=>{}});
 assert.equal(silent.save(record(silent)),false);assert.equal(silent.status,'preserved');
});
test('untrusted extra fields, arbitrary audit content, duplicate IDs and excessive history are refused',()=>{
 const j=new GuestSandboxJournal(),valid=record(j);
 for(const value of [
  {...valid,account:'private'}, {...valid,simulation:false},
  {...valid,controls:{...valid.controls,account:'private'}},
  {...valid,events:[{id:1,label:'approved account',detail:'private'}]},
  {...valid,events:[{...valid.events[0],detail:'remote message'}]},
  {...valid,events:[valid.events[0],valid.events[0]]},
  {...valid,events:Array.from({length:101},(_,index)=>({...valid.events[0],id:index+1}))},
 ])assert.equal(validGuestSandbox(value),false);
 const store=storage(),saved=new GuestSandboxJournal(store);assert.equal(saved.save(valid),true);
 const original=store.raw;assert.equal(saved.save({...valid,events:Array.from({length:101},(_,index)=>({...valid.events[0]!,id:index+1}))}),false);assert.equal(store.raw,original);
});
test('storage feedback is localized and never suggests an account or chain operation succeeded',()=>{
 for(const locale of locales)for(const status of ['local','temporary','preserved'] as const){
  const text=guestSandboxStorageText(locale,status);assert.ok(text.length>20);
  if(locale==='en')assert.doesNotMatch(text,/[\u3400-\u9fff]/);
 }
});

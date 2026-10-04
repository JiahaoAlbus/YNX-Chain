import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperRiskController} from '../web/paper-risk-intents.js';
import {paperRiskCopy} from '../web/paper-session-copy.js';
function fixture(){let current={status:'connected',ready:true,account:'native-A',epoch:1},writes=[];const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};const request=async(path,opt)=>{writes.push({path,...opt});const body=JSON.parse(opt.body);return {action:path.split('/').at(-1),idempotencyKey:body.idempotencyKey,requestDigest:'a'.repeat(64),paper:{KillSwitch:true,ReconciliationDelta:1}};};const make=override=>createPaperRiskController({session:()=>current,storage,uuid:()=> '11111111-1111-4111-8111-111111111111',request:override||request});return {make,writes,values,storage,set:v=>{current=v},request};}
test('native risk preview/cancel is readonly; confirmation is coalesced and receipt clears exact journal',async()=>{
 const f=fixture(),c=f.make();c.preview('kill',{reason:'Confirmed user halt'});assert.equal(f.writes.length,0);c.invalidate();const draft=c.preview('reconcile',{cash:10,position:3}),first=c.confirm(draft);assert.equal(c.confirm(draft),first);await first;assert.equal(f.writes.length,1);assert.equal(f.values.size,0);
});
test('unknown native risk survives reload; changed action/body conflicts and exact explicit retry uses original bytes',async()=>{
 const f=fixture(),c=f.make(async()=>{throw Error('controlled unavailable')}),draft=c.preview('kill',{reason:'Confirmed user halt'});await assert.rejects(c.confirm(draft));const raw=[...f.values.values()][0],next=f.make();assert.throws(()=>next.preview('reconcile',{cash:10,position:3}));const retry=next.preview('kill',{reason:'Confirmed user halt'});await next.confirm(retry);assert.deepEqual(JSON.parse(raw).body,JSON.parse(f.writes[0].body));
});
test('native risk owner retirement before dispatch makes no HTTP; old owner pending record retained',async()=>{
 const f=fixture(),c=f.make(),draft=c.preview('kill',{reason:'Confirmed user halt'}),flight=c.confirm(draft);f.set({status:'connected',ready:true,account:'native-B',epoch:2});await assert.rejects(flight);assert.equal(f.writes.length,0);assert.equal(f.values.size,1);assert.equal(c.pending(),null);
});
test('unsafe reference and silent storage failure cannot write',async()=>{
 const f=fixture(),c=f.make();assert.throws(()=>c.preview('reconcile',{cash:Number.MAX_SAFE_INTEGER+1,position:0}));f.storage.setItem=()=>{};const draft=c.preview('kill',{reason:'Confirmed user halt'});assert.throws(()=>c.confirm(draft));assert.equal(f.writes.length,0);
});
test('all twelve native risk boundaries are localized and distinguish independent references from balance reset',()=>{
 const languages=['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id'];for(const language of languages){const copy=paperRiskCopy(language);assert.equal(Object.keys(copy).length,6);assert.ok(Object.values(copy).every(value=>value.length>3));if(language!=='en')assert.notEqual(copy.boundary,paperRiskCopy('en').boundary);}assert.match(paperRiskCopy('en').boundary,/does not reset balances/);
});
test('late risk receipt cannot retire a replaced, missing or corrupt journal or claim resolution',async()=>{
 for(const replacement of ['missing','corrupt','new-intent']){
  const f=fixture();let release,arrived=false;
  const c=f.make((path,opt)=>{arrived=true;return new Promise(resolve=>{release=()=>f.request(path,opt).then(resolve);});});
  const draft=c.preview('kill',{reason:'Confirmed original halt'}),flight=c.confirm(draft);
  while(!arrived)await new Promise(resolve=>setTimeout(resolve,0));
  const key='ynx.quant.native-paper.risk.v1:native-A';
  if(replacement==='missing')f.values.delete(key);
  else f.values.set(key,replacement==='corrupt'?'{invalid':JSON.stringify({action:'reconcile',body:{cash:30,position:2,idempotencyKey:'quant-native-risk-22222222-2222-4222-8222-222222222222'}}));
  const retained=f.values.get(key);release();await assert.rejects(flight,{code:'PAPER_PENDING_MISMATCH'});
  assert.equal(f.values.get(key),retained);assert.equal(f.writes.length,1);
 }
});
test('risk receipt cannot retire UNKNOWN after same-owner permission/readiness loss',async()=>{
 const f=fixture();let release,arrived=false;const c=f.make((path,opt)=>{arrived=true;return new Promise(resolve=>{release=()=>f.request(path,opt).then(resolve);});});
 const draft=c.preview('kill',{reason:'Confirmed original halt'}),flight=c.confirm(draft);
 while(!arrived)await new Promise(resolve=>setTimeout(resolve,0));const raw=[...f.values.values()][0];
 f.set({account:'native-A',epoch:1,status:'connected',ready:false});release();
 await assert.rejects(flight,{code:'PRIVATE_OPERATION_SUPERSEDED'});assert.equal([...f.values.values()][0],raw);
});

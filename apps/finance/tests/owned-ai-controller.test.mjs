import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const start=source.slice(source.indexOf('let ownedAIGeneration='),source.indexOf('function renderAIJob()'));
const poll=source.slice(source.indexOf('function pollAI()'),source.indexOf('const deleteAIButton='));
const actions=source.slice(source.indexOf('async function decideOwnedAI('),source.indexOf("$('#ai-start').addEventListener('click',startAI)"));
const job=(id,status='running')=>({id,kind:'summarize_activity',status});
function fixture(){
  const elements=new Map(['ai-start','ai-kind','ai-consent','ai-status','ai-actions'].map(id=>[id,{disabled:false,value:id==='ai-kind'?'summarize_activity':'',checked:true,classList:{add(){}},setAttribute(){},removeAttribute(){}}]));
  const calls=[],notices=[],rendered=[],timers=new Map();let next=0;
  const scope={state:{context:1,aiJob:null,aiTimer:null},browserSSOIntentGeneration:1,$:s=>elements.get(s.slice(1)),$$:s=>s==='#ai-actions button'?[]:[{value:'owned-record'}],
    financeText:k=>k,notifyFailure:()=>notices.push('failed'),notifyKnownOrFailure:()=>notices.push('failed'),notify:k=>notices.push(k),
    renderAIJob:()=>rendered.push(scope.state.aiJob),api:(path,options)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject})),
    setInterval:callback=>{timers.set(++next,callback);return next},clearInterval:id=>timers.delete(id),window:{confirm:()=>true},load:async()=>{},
  };
  runInNewContext(start+poll+actions+'globalThis.startOwned=startAI;globalThis.pollOwned=pollAI;globalThis.decideOwned=decideOwnedAI;globalThis.retireOwned=retireOwnedAIView;',scope);
  return {scope,elements,calls,notices,rendered,timers,start:()=>scope.startOwned(),tick:()=>timers.get(scope.state.aiTimer)?.(),decide:decision=>scope.decideOwned({target:{dataset:{ai:decision}}})};
}
test('AI start coalesces and a retired account cannot publish result, error or unlock a newer start',async()=>{
  for(const reject of [false,true]){
    const f=fixture(),old=f.start();await f.start();assert.equal(f.calls.length,1);
    f.scope.state.context++;f.scope.retireOwned();const next=f.start();assert.equal(f.calls.length,2);
    if(reject)f.calls[0].reject(Error('old account'));else f.calls[0].resolve(job('old'));
    await old;assert.equal(f.scope.state.aiJob,null);assert.equal(f.elements.get('ai-start').disabled,true);assert.deepEqual(f.notices,[]);
    f.calls[1].resolve(job('current','ready'));await next;assert.equal(f.scope.state.aiJob.id,'current');assert.equal(f.elements.get('ai-start').disabled,false);assert.equal(f.timers.size,0);
  }
});
test('malformed or wrong-kind AI creation never becomes an observed draft',async()=>{
  for(const value of [null,{},job(''),{...job('wrong'),kind:'other'},{...job('unknown'),status:'success'}]){
    const f=fixture(),start=f.start();f.calls[0].resolve(value);await start;assert.equal(f.scope.state.aiJob,null);assert.deepEqual(f.rendered,[]);assert.deepEqual(f.notices,['failed']);assert.equal(f.timers.size,0);
  }
});
test('AI polling serializes reads and binds id/kind without erasing a ready result',async()=>{
  const f=fixture();f.scope.state.aiJob=job('one');f.scope.pollOwned();const first=f.tick();await f.tick();assert.equal(f.calls.length,1);
  f.calls[0].resolve({...job('one','ready'),result:{summary:'Observed result'}});await first;
  assert.equal(f.scope.state.aiJob.result.summary,'Observed result');assert.equal(f.timers.size,0);
  f.scope.pollOwned();assert.equal(f.timers.size,0);assert.equal(f.calls.length,1);
  for(const value of [job('foreign'),{...job('one'),kind:'other'},{}]){
    const rejected=fixture();const original=job('one');rejected.scope.state.aiJob=original;rejected.scope.pollOwned();const pending=rejected.tick();rejected.calls[0].resolve(value);await pending;
    assert.equal(rejected.scope.state.aiJob,original);assert.deepEqual(rejected.rendered,[]);assert.deepEqual(rejected.notices,['failed']);
  }
});
test('old poll completion cannot overwrite a newer job or stop its timer even for the same account',async()=>{
  for(const reject of [false,true]){
    const f=fixture();f.scope.state.aiJob=job('old');f.scope.pollOwned();const old=f.tick();
    const newer=f.start();f.calls[1].resolve(job('new'));await newer;const timer=f.scope.state.aiTimer;
    if(reject)f.calls[0].reject(Error('old poll'));else f.calls[0].resolve(job('old','ready'));await old;
    assert.equal(f.scope.state.aiJob.id,'new');assert.equal(f.scope.state.aiTimer,timer);assert.ok(f.timers.has(timer));assert.deepEqual(f.notices,[]);
  }
});
test('cancel is coalesced and accepted request is not displayed as cancelled until exact readback',async()=>{
  const f=fixture(),original=job('one');f.scope.state.aiJob=original;
  const cancel=f.decide('cancel');await f.decide('cancel');assert.equal(f.calls.length,1);f.calls[0].resolve(null);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].path,'/api/ai/jobs/one');assert.equal(f.scope.state.aiJob.status,'running');
  f.calls[1].resolve(job('one','cancelled'));await cancel;assert.equal(f.scope.state.aiJob.status,'cancelled');assert.equal(f.timers.size,0);
});
test('late delete/decision cannot remove or replace a newer draft; wrong receipt remains unconfirmed',async()=>{
  for(const decision of ['delete','apply','reject']){
    const f=fixture();f.scope.state.aiJob=job('old','ready');const action=f.decide(decision);const newer=f.start();f.calls[1].resolve(job('new','ready'));await newer;
    f.calls[0].resolve(decision==='delete'?null:job('old',decision==='apply'?'applied':'rejected'));await action;
    assert.equal(f.scope.state.aiJob.id,'new');assert.deepEqual(f.notices,[]);
  }
  const f=fixture(),original=job('one','ready');f.scope.state.aiJob=original;const action=f.decide('apply');f.calls[0].resolve(job('foreign','applied'));await action;assert.equal(f.scope.state.aiJob,original);assert.deepEqual(f.notices,['failed']);
});

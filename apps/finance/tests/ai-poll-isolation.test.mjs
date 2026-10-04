import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function pollAI()'),app.indexOf('\nconst deleteAIButton='));
assert.ok(source.startsWith('function pollAI()'));

function fixture(){
  let revision=0,nextTimer=0;
  const state={context:0,aiTimer:null,aiJob:{id:'job-a',status:'running'}},timers=new Map(),requests=[],renders=[],notices=[];
  const context={state,window:{YNXFinanceWallet:{getRevision:()=>revision}},setInterval(callback){const id=++nextTimer;timers.set(id,callback);return id},clearInterval(id){timers.delete(id)},
    api(path){return new Promise((resolve,reject)=>requests.push({path,resolve,reject}))},renderAIJob(){renders.push(state.aiJob.id)},notifyFailure(error,key){notices.push({error,key})},Error};
  vm.runInNewContext(source,context,{filename:'app.js:pollAI'});
  return {state,timers,requests,renders,notices,start:()=>context.pollAI(),tick:id=>timers.get(id)(),changeRevision(){revision++}};
}

test('late failure for previous account cannot stop new account polling or display its error',async()=>{
  const f=fixture();f.start();const old=f.state.aiTimer,pending=f.tick(old);
  f.state.context++;f.changeRevision();f.state.aiJob={id:'job-b',status:'running'};f.start();const current=f.state.aiTimer;
  f.requests[0].reject(new Error('FINANCE_CONTEXT_CHANGED'));await pending;
  assert.ok(f.timers.has(current));assert.equal(f.state.aiTimer,current);assert.deepEqual(f.notices,[]);
});

test('late success cannot replace another account or a replacement job',async()=>{
  for(const accountChange of [false,true]){
    const f=fixture();f.start();const pending=f.tick(f.state.aiTimer);
    if(accountChange){f.state.context++;f.changeRevision()}
    f.state.aiJob={id:'job-b',status:'running'};f.start();const current=f.state.aiTimer;
    f.requests[0].resolve({id:'job-a',status:'ready'});await pending;
    assert.equal(f.state.aiJob.id,'job-b');assert.ok(f.timers.has(current));assert.deepEqual(f.renders,[]);
  }
});

test('interval ticks cannot overlap requests for the same job',async()=>{
  const f=fixture();f.start();const timer=f.state.aiTimer,pending=f.tick(timer);f.tick(timer);
  assert.equal(f.requests.length,1);f.requests[0].resolve({id:'job-a',status:'running'});await pending;
  const second=f.tick(timer);assert.equal(f.requests.length,2);f.requests[1].resolve({id:'job-a',status:'ready'});await second;
  assert.deepEqual(f.renders,['job-a','job-a']);assert.equal(f.timers.size,0);assert.equal(f.state.aiTimer,null);
});

test('revision change, cancellation and deletion discard outstanding results',async()=>{
  for(const change of [f=>f.changeRevision(),f=>{f.state.aiJob.status='cancelled'},f=>{f.state.aiJob=null}]){
    const f=fixture();f.start();const pending=f.tick(f.state.aiTimer);change(f);
    f.requests[0].resolve({id:'job-a',status:'ready'});await pending;
    assert.deepEqual(f.renders,[]);assert.deepEqual(f.notices,[]);assert.equal(f.timers.size,0);
  }
});

test('current job failure stops only its own timer and reports once',async()=>{
  const f=fixture();f.start();const pending=f.tick(f.state.aiTimer);
  f.requests[0].reject(new Error('private service unavailable'));await pending;
  assert.equal(f.timers.size,0);assert.equal(f.state.aiTimer,null);assert.equal(f.notices.length,1);assert.equal(f.notices[0].key,'aiDraftFailed');
});

test('wrong job response fails closed and terminal jobs do not issue polling requests',async()=>{
  const f=fixture();f.start();const pending=f.tick(f.state.aiTimer);
  f.requests[0].resolve({id:'other-job',status:'ready'});await pending;
  assert.equal(f.state.aiJob.id,'job-a');assert.deepEqual(f.renders,[]);assert.equal(f.notices.length,1);
  const ready=fixture();ready.state.aiJob.status='ready';ready.start();await ready.tick(ready.state.aiTimer);
  assert.equal(ready.requests.length,0);assert.equal(ready.timers.size,0);
});

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const start=app.slice(app.indexOf('let aiStartOperation='),app.indexOf('\nfunction renderAIJob('));
const action=app.slice(app.indexOf('async function handleAIAction('),app.indexOf("\n$('#ai-start').addEventListener"));
assert.ok(start.includes('async function startAI()'));assert.ok(action.startsWith('async function handleAIAction('));

function fixture(){
  let revision=0;
  const state={context:0,aiJob:{id:'job-a',status:'running'},aiTimer:41},requests=[],notices=[],renders=[],cleared=[];
  let polls=0,loads=0;
  const button={disabled:false,textContent:'aiRequestDraft'},status={textContent:'current job'},actions={classList:{add(){}}};
  const context={state,window:{YNXFinanceWallet:{getRevision:()=>revision},confirm:()=>true},encodeURIComponent,
    $:selector=>({'#ai-start':button,'#ai-kind':{value:'categorize'},'#ai-consent':{checked:true},'#ai-status':status,'#ai-actions':actions}[selector]),
    $$:()=>[{value:'owned-record'}],financeText:key=>key,HTMLFormElement:class{},FormData:class{},
    api(path,options){return new Promise((resolve,reject)=>requests.push({path,options,resolve,reject}))},
    notifyKnownOrFailure(error){notices.push(error)},notify(){},renderAIJob(){renders.push(state.aiJob)},pollAI(){polls++},async load(){loads++},clearInterval(id){cleared.push(id)},location:{hash:''},
  };
  vm.runInNewContext(`${start}\n${action}`,context,{filename:'app.js:ai-actions'});
  return {state,requests,notices,renders,cleared,button,status,start:()=>context.startAI(),action:decision=>context.handleAIAction({target:{dataset:{ai:decision}}}),get polls(){return polls},get loads(){return loads},change(kind='context'){if(kind==='context')state.context++;else revision++;context.resetAIDraftRequest()}};
}

test('retired create success/failure cannot overwrite a new job or unlock its pending button',async()=>{
  for(const kind of ['context','revision'])for(const rejected of [false,true]){
    const f=fixture(),old=f.start();f.change(kind);f.state.aiJob={id:'job-b',status:'running'};const current=f.start();
    if(rejected)f.requests[0].reject(new Error('FINANCE_CONTEXT_CHANGED'));else f.requests[0].resolve({id:'old-created',status:'running'});
    await old;assert.equal(f.state.aiJob.id,'job-b');assert.equal(f.button.disabled,true);assert.deepEqual(f.notices,[]);assert.deepEqual(f.renders,[]);
    const job={id:'new-created',status:'running'};f.requests[1].resolve(job);await current;
    assert.equal(f.state.aiJob,job);assert.equal(f.button.disabled,false);assert.equal(f.polls,1);
  }
});

test('current create is single-flight and current failure restores the button',async()=>{
  const f=fixture(),pending=f.start();await f.start();assert.equal(f.requests.length,1);
  f.requests[0].reject(new Error('private service unavailable'));await pending;
  assert.equal(f.button.disabled,false);assert.equal(f.notices.length,1);assert.equal(f.polls,0);
});

test('retired cancel/delete/apply/reject successes do not change the replacement job',async()=>{
  for(const decision of ['cancel','delete','apply','reject'])for(const kind of ['context','revision','job']){
    const f=fixture(),pending=f.action(decision);if(kind!=='job')f.change(kind);
    const replacement={id:'job-b',status:'running'};f.state.aiJob=replacement;
    f.requests[0].resolve({id:'job-a',status:'applied'});await pending;
    assert.equal(f.state.aiJob,replacement);assert.equal(f.state.aiJob.status,'running');assert.deepEqual(f.renders,[]);assert.deepEqual(f.notices,[]);assert.deepEqual(f.cleared,[]);assert.equal(f.loads,0);assert.equal(f.status.textContent,'current job');
  }
});

test('retired action errors stay silent and cannot release a newer action gate',async()=>{
  const f=fixture(),old=f.action('apply');f.change();f.state.aiJob={id:'job-b',status:'ready'};
  const current=f.action('apply');f.requests[0].reject(new Error('old error'));await old;
  await f.action('apply');assert.equal(f.requests.length,2);assert.deepEqual(f.notices,[]);
  f.requests[1].resolve({id:'job-b',status:'applied'});await current;assert.equal(f.loads,1);assert.equal(f.renders.length,1);
});

test('current action failure permits a later explicit retry; wrong returned job fails closed',async()=>{
  const f=fixture(),pending=f.action('reject');f.requests[0].reject(new Error('current error'));await pending;
  assert.equal(f.notices.length,1);
  const retry=f.action('reject');f.requests[1].resolve({id:'other-job',status:'rejected'});await retry;
  assert.equal(f.state.aiJob.id,'job-a');assert.equal(f.notices.length,2);assert.deepEqual(f.renders,[]);
});

test('current cancel and delete preserve their real behavior and delete stops its own poll',async()=>{
  const f=fixture(),cancel=f.action('cancel');assert.equal(f.requests[0].path,'/api/ai/jobs/job-a/cancel');f.requests[0].resolve(null);await cancel;
  assert.equal(f.state.aiJob.status,'cancelled');assert.equal(f.renders.length,1);
  const deletion=f.action('delete');assert.equal(f.requests[1].options.method,'DELETE');f.requests[1].resolve(null);await deletion;
  assert.equal(f.state.aiJob,null);assert.equal(f.state.aiTimer,null);assert.deepEqual(f.cleared,[41]);assert.equal(f.status.textContent,'aiDraftDeleted');
});

test('unknown UI action never submits an API operation',async()=>{
  const f=fixture();await f.action('unregistered-action');assert.equal(f.requests.length,0);
});

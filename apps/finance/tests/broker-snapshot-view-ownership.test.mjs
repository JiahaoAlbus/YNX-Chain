import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

// Execute the actual ordinary display function; no fabricated authority grant.
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('let brokerSnapshotRevision='),app.indexOf('let brokerCallbackInFlight='));
const reply=account=>({schema:'ynx-finance-broker-snapshot-v1',snapshot:{provider:'alpaca_broker',environment:'sandbox',account:{currency:'USD',providerAccountId:account},positions:[],orders:[]}});
function fixture(){
  const requests=[],renders=[];
  const context=vm.createContext({state:{context:1,connected:true},brokerSnapshotState:{kind:'guest'},renderBrokerSnapshot(){renders.push(context.brokerSnapshotState)},api(){return new Promise((resolve,reject)=>requests.push({resolve,reject}))}});
  vm.runInContext(source,context);
  return {context,requests,renders,run:()=>vm.runInContext('refreshBrokerSnapshot()',context)};
}
test('late old-account success and rejection cannot replace the new-account broker view',async()=>{
  for(const fail of [false,true]){
    const f=fixture(),old=f.run();f.context.state.context++;const next=f.run();
    f.requests[1].resolve(reply('new-account'));await next;
    if(fail)f.requests[0].reject(Error('FINANCE_CONTEXT_CHANGED'));else f.requests[0].resolve(reply('old-account'));
    await old;
    assert.equal(f.context.brokerSnapshotState.snapshot.account.providerAccountId,'new-account');assert.equal(f.renders.length,1);
  }
});
test('newer refresh owns both data and unavailable state even within the same account',async()=>{
  for(const oldFails of [false,true]){
    const f=fixture(),old=f.run(),next=f.run();f.requests[1].resolve(reply('fresh'));await next;
    if(oldFails)f.requests[0].reject(Error('old read failed'));else f.requests[0].resolve(reply('obsolete'));await old;
    assert.equal(f.context.brokerSnapshotState.snapshot.account.providerAccountId,'fresh');assert.equal(f.renders.length,1);
  }
  const f=fixture(),old=f.run(),next=f.run();f.requests[1].reject(Error('current source unavailable'));await next;f.requests[0].resolve(reply('obsolete'));await old;
  assert.equal(f.context.brokerSnapshotState.kind,'unavailable');assert.equal(f.renders.length,1);
});
test('signed-out view remains guest despite a pending read, with no new request',async()=>{
  const f=fixture(),old=f.run();f.context.state.context++;f.context.state.connected=false;await f.run();f.requests[0].reject(Error('old read failed'));await old;
  assert.equal(f.context.brokerSnapshotState.kind,'guest');assert.equal(f.requests.length,1);assert.equal(f.renders.length,1);
});
test('current malformed broker snapshot is unavailable, not a confirmed empty account',async()=>{
  const f=fixture(),pending=f.run();f.requests[0].resolve({schema:'unknown',snapshot:reply('unverified').snapshot});await pending;
  assert.equal(f.context.brokerSnapshotState.kind,'unavailable');assert.equal(f.renders.length,1);
});

test('actual Chrome keeps new broker display when an older account read fails',{timeout:15000},async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent('<output id="broker-view"></output>');
    await page.addScriptTag({content:`const state={context:1,connected:true};let brokerSnapshotState={kind:'guest'};window.requests=[];function renderBrokerSnapshot(){document.getElementById('broker-view').textContent=brokerSnapshotState.kind==='data'?brokerSnapshotState.snapshot.account.providerAccountId:brokerSnapshotState.kind}function api(){return new Promise((resolve,reject)=>requests.push({resolve,reject}))}${source}window.startRead=()=>refreshBrokerSnapshot();window.changeAccount=()=>state.context++;`});
    await page.evaluate(()=>{window.oldRead=startRead();changeAccount();window.newRead=startRead()});
    await page.evaluate(async value=>{requests[1].resolve(value);await newRead},reply('current-controlled-account'));
    assert.equal(await page.locator('#broker-view').textContent(),'current-controlled-account');
    await page.evaluate(async()=>{requests[0].reject(Error('FINANCE_CONTEXT_CHANGED'));await oldRead});
    assert.equal(await page.locator('#broker-view').textContent(),'current-controlled-account');
    await page.evaluate(async()=>{window.pendingRead=startRead();changeAccount();state.connected=false;await startRead();requests[2].reject(Error('old read failed'));await pendingRead});
    assert.equal(await page.locator('#broker-view').textContent(),'guest');
    assert.equal(await page.evaluate(()=>requests.length),3);
  }finally{await browser.close()}
});

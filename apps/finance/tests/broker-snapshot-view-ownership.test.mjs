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

test('workspace old-account and same-account late errors cannot erase current orders',async()=>{
  const workspaceSource=app.slice(app.indexOf('let brokerWorkspaceRevision='),app.indexOf('async function createBrokerApproval('));
  for(const switchAccount of [false,true])for(const oldFails of [false,true]){
    const requests=[],renders=[];let view;
    const context=vm.createContext({state:{context:1,connected:true},brokerWorkspaceUnavailable:false,renderBrokerWorkspace:value=>{view=value;renders.push(value)},api:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))});
    vm.runInContext(workspaceSource,context);const old=vm.runInContext('refreshBrokerWorkspace()',context);if(switchAccount)context.state.context++;
    const next=vm.runInContext('refreshBrokerWorkspace()',context);const expected={serverTime:'2026-10-03T00:00:00Z',orders:[{id:'current'}]};requests[1].resolve({schema:'ynx-finance-broker-workspace-v1',workspace:expected});await next;
    if(oldFails)requests[0].reject(Error('old error'));else requests[0].resolve({schema:'ynx-finance-broker-workspace-v1',workspace:{...expected,orders:[{id:'old'}]}});assert.equal(await old,null);
    assert.equal(view,expected);assert.equal(context.brokerWorkspaceUnavailable,false);assert.equal(renders.length,1);
  }
});

test('quote responses and failures cannot cross account or edited symbol boundaries',async()=>{
  const quoteSource=app.slice(app.indexOf('async function refreshBrokerQuote('),app.indexOf('function renderBrokerQuote('));
  for(const boundary of ['account','symbol','invalid-new-read'])for(const fail of [false,true]){
    let resolve,reject;const form={symbol:'TEST'},renders=[];
    const context=vm.createContext({state:{context:1,brokerSelectedAsset:{symbol:'TEST'}},AbortController,setTimeout,clearTimeout,FormData:class{constructor(value){this.value=value}get(){return this.value.symbol}},$:()=>form,renderBrokerQuote:()=>renders.push(vm.runInContext('brokerQuoteDisplay.kind',context)),fetch:()=>new Promise((a,b)=>{resolve=a;reject=b})});
    vm.runInContext(quoteSource,context);const old=vm.runInContext('refreshBrokerQuote()',context);
    if(boundary==='account')context.state.context++;else form.symbol='OTHER';
    if(boundary==='invalid-new-read')await vm.runInContext('refreshBrokerQuote()',context);
    if(fail)reject(Error('old quote failed'));else resolve({ok:true,json:async()=>({schema:'ynx-finance-broker-quote-v1',source:'alpaca_market_data_sandbox',officialSandboxVerified:false,quoteState:'sample',quote:{symbol:'TEST',bidPrice:'1',askPrice:'2',feed:'sample',timestamp:'2026-10-03T00:00:00Z'}})});
    await old;assert.equal(renders.length,boundary==='invalid-new-read'?1:0);assert.equal(vm.runInContext('brokerQuoteDisplay.kind',context),boundary==='invalid-new-read'?'unavailable':'none');
  }
});

test('late public asset-search failure cannot clear a new-account selected asset or draft',async()=>{
  const searchSource=app.slice(app.indexOf('async function searchBrokerAssets('),app.indexOf('function renderBrokerWatchlist('));
  for(const fail of [false,true]){
    let resolve,reject;const selected={symbol:'CURRENT'},form={elements:{assetId:{value:'current-id'},symbol:{value:'CURRENT'}}},renders=[];
    const context=vm.createContext({state:{context:1,brokerSelectedAsset:selected},AbortController,setTimeout,clearTimeout,FormData:class{get(){return 'query'}},$:()=>form,brokerAssetSearchRevision:0,brokerAssetSearchController:null,brokerQuoteRevision:0,brokerQuoteController:null,brokerQuoteDisplay:{kind:'none'},brokerApprovalDisplay:null,financeText:key=>key,notify:()=>renders.push('notice'),renderBrokerQuote:()=>renders.push('quote'),renderBrokerAssets:()=>renders.push('assets'),fetch:()=>new Promise((a,b)=>{resolve=a;reject=b})});
    vm.runInContext(searchSource,context);const old=vm.runInContext('searchBrokerAssets()',context);context.state.context++;
    if(fail)reject(Error('old search failed'));else resolve({ok:true,json:async()=>({schema:'ynx-finance-broker-assets-v1',assets:[]})});await old;
    assert.equal(context.state.brokerSelectedAsset,selected);assert.equal(form.elements.assetId.value,'current-id');assert.equal(form.elements.symbol.value,'CURRENT');assert.deepEqual(renders,[]);
  }
});

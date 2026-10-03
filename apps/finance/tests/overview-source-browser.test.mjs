import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8'),html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const start=app.indexOf('function validateFinanceOverview(')>=0?app.indexOf('function validateFinanceOverview('):app.indexOf('function render(data)');
const views=app.slice(start,app.indexOf('const formSaves='));
const formatters=app.slice(app.indexOf('const fmt='),app.indexOf('\n\nconst wait='));
const overview=()=>({portfolio:{account:'owned-render-fixture',balanceYnxt:0,stakedYnxt:0,asOf:'2026-10-04T00:00:00Z',activity:[],payReceipts:[],explorerStatus:{available:true},payStatus:{available:true}},profile:{categories:[],budgets:[],reminders:[],privacy:{includePayInStatements:false,allowAiActivityContext:false,alertsEnabled:true}},alerts:[],budgetProgress:[],support:{}});
test('actual Finance views never normalize impossible or locale-dependent source timestamps into observed dates',async()=>{
  const f=await fixture();try{
    for(const timestamp of ['2026-02-30T00:00:00Z','2025-02-29T00:00:00Z','2026-04-31T00:00:00Z','10/04/2026',0,1,['2026-10-04T00:00:00Z'],'2026-10-04','2026-10-04T00:00:00']){
      const value=overview();value.portfolio.asOf=timestamp;value.portfolio.activity=[{id:'controlled-record',type:'transfer',direction:'incoming',amountYnxt:1,feeYnxt:0,timestamp}];value.portfolio.payReceipts=[{id:'controlled-pay',amountYnxt:1,createdAt:timestamp}];
      await f.page.evaluate(value=>overviewQA.render(value),value);
      assert.match(await f.page.locator('#balance-source').textContent(),/dateUnavailable/);assert.match(await f.page.locator('#activity-body').textContent(),/dateUnavailable/);assert.match(await f.page.locator('#recent-receipts').textContent(),/dateUnavailable/);
    }
    for(const timestamp of ['2024-02-29T00:00:00Z','2026-10-04T08:00:00+08:00','2026-10-04T00:00:00.123456789Z']){
      const value=overview();value.portfolio.asOf=timestamp;await f.page.evaluate(value=>overviewQA.render(value),value);assert.doesNotMatch(await f.page.locator('#balance-source').textContent(),/dateUnavailable/);
    }
    assert.deepEqual(f.errors,[]);assert.equal(f.requests(),0);assert.equal(f.context.pages().length,1);
  }finally{await f.browser.close()}
});
test('actual statement controller binds owner and selected period before rendering and recovers on retry',async()=>{
  const f=await fixture();try{
    const controller=app.slice(app.indexOf('function renderStatement('),app.indexOf("$('#statement-form').addEventListener"));
    await f.page.addScriptTag({content:`let browserSSOIntentGeneration=1;state.overview={portfolio:{account:'owned-render-fixture'}};const statementCalls=[];function formDraft(form){return JSON.stringify(Array.from(new FormData(form)))}function api(path){return new Promise(resolve=>statementCalls.push({path,resolve}))}${controller}\nwindow.statementQA={read:()=>loadStatement($('#statement-form')),reply(patch={}){const call=statementCalls.at(-1),url=new URL(call.path,'https://finance.invalid');call.resolve({schemaVersion:'finance-statement-v2',account:state.overview.portfolio.account,network:'ynx_6423-1',symbol:'YNXT',from:url.searchParams.get('from'),toExclusive:url.searchParams.get('to'),activity:[],totals:{incomingYnxt:null,outgoingYnxt:null,feesYnxt:null},coverageComplete:false,openingBalance:'unavailable',...patch})},inspect:()=>({calls:statementCalls.length,statement:state.statement,error:state.statementError})};`});
    await f.page.locator('#statement-form [name=from]').fill('2026-09-01');await f.page.locator('#statement-form [name=to]').fill('2026-09-30');
    for(const patch of [{account:'other-owner'},{toExclusive:'2026-09-30T00:00:00Z'},
      {calculationStatus:'partial',observedTotals:{incomingYnxt:1,outgoingYnxt:0,feesYnxt:0}},
      {calculationStatus:'partial',observedTotals:{incomingYnxt:0,outgoingYnxt:0,feesYnxt:9007199254740992}},
      {calculationStatus:'partial',activity:[{id:'bad-date',direction:'incoming',amountYnxt:1,feeYnxt:0,timestamp:'2026-02-30T00:00:00Z'}],observedTotals:{incomingYnxt:1,outgoingYnxt:0,feesYnxt:0}},
      ...[
        {direction:'sideways'}, {timestamp:'2026-10-01T00:00:00Z'},
        {amountYnxt:-1}, {amountYnxt:'1'}, {feeYnxt:-1}
      ].map(change=>({calculationStatus:'partial',activity:[{id:'controlled-row',direction:'incoming',amountYnxt:1,feeYnxt:0,timestamp:'2026-09-01T00:00:00Z',...change}],observedTotals:{incomingYnxt:1,outgoingYnxt:0,feesYnxt:0}}))
    ]){
      await f.page.evaluate(()=>{window.statementPending=statementQA.read()});await f.page.evaluate(patch=>statementQA.reply(patch),patch);await f.page.evaluate(()=>statementPending);
      assert.equal(await f.page.locator('#statement').textContent(),'unavailable');assert.equal((await f.page.evaluate(()=>statementQA.inspect())).statement,null);
    }
    await f.page.evaluate(()=>{window.statementPending=statementQA.read();statementQA.reply()});await f.page.evaluate(()=>statementPending);
    assert.match(await f.page.locator('#statement').textContent(),/fullPeriodTotals: unknown/);assert.equal((await f.page.evaluate(()=>statementQA.inspect())).statement.account,'owned-render-fixture');assert.equal(await f.page.locator('#statement').getAttribute('aria-busy'),null);
    const valid={calculationStatus:'partial',activity:[
      {id:'controlled-in',direction:'incoming',amountYnxt:7,feeYnxt:1,timestamp:'2026-09-01T08:00:00+08:00'},
      {id:'controlled-out',direction:'outgoing',amountYnxt:2,feeYnxt:1,timestamp:'2026-09-30T23:59:59.999Z'}
    ],observedTotals:{incomingYnxt:7,outgoingYnxt:2,feesYnxt:2}};
    await f.page.evaluate(patch=>{window.statementPending=statementQA.read();statementQA.reply(patch)},valid);await f.page.evaluate(()=>statementPending);
    const text=await f.page.locator('#statement').textContent();
    assert.match(text,/observedIncoming7 YNXT/);assert.match(text,/observedOutgoing2 YNXT/);assert.match(text,/observedFees2 YNXT/);
    assert.match(text,/fullPeriodTotals: unknown/);assert.doesNotMatch(text,/dateUnavailable/);
    assert.deepEqual((await f.page.evaluate(()=>statementQA.inspect())).statement.activity,valid.activity);
    assert.deepEqual(f.errors,[]);assert.equal(f.requests(),0);assert.equal(f.context.pages().length,1);
  }finally{await f.browser.close()}
});
async function fixture(){
  const browser=await chromium.launch(await financeBrowserLaunchOptions()),context=await browser.newContext(),page=await context.newPage();
  const errors=[];let requests=0;page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{requests++;return route.abort()});
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  await page.addScriptTag({content:`const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],financeText=k=>k,esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');const state={context:1},formUncommittedDrafts=new WeakMap();let ownedFormAccount=null;const sources=[];function sourceStatus(...v){sources.push(v)}function rememberOwnedFormDrafts(){}function restoreOwnedFormDrafts(){}function refreshBrokerSnapshot(){}async function refreshBrokerWorkspace(){return null}async function restoreBrokerApproval(){}async function completeBrokerCallback(){}function notifyFailure(){}function route(){};${formatters}\n${views}\nwindow.overviewQA={render,sources};`});
  return {browser,page,context,errors,requests:()=>requests};
}
test('actual complete overview handles unavailable source metadata and malformed alerts without losing planning or safe support',async()=>{
  const f=await fixture();try{
    const value=overview();value.profile.categories=[{id:'cat',name:'Owned category',color:'#002fa7'}];value.profile.budgets=[{id:'budget',name:'Owned budget',period:'monthly',limitYnxt:0}];value.support={helpUrl:'javascript:alert(1)'};
    for(const status of [null,{},[],{available:'true'},{available:1}]){
      value.portfolio.explorerStatus=status;value.portfolio.payStatus=status;value.alerts=[null,{title:'Valid warning',detail:'Existing source observation',severity:'warning'},{}];
      await f.page.evaluate(value=>overviewQA.render(value),value);
      assert.equal(await f.page.locator('#balance').textContent(),'unavailable');assert.equal(await f.page.locator('#staked').textContent(),'unavailable');
      assert.match(await f.page.locator('#categories').textContent(),/Owned category/);assert.match(await f.page.locator('#budgets').textContent(),/Owned budget/);
      assert.match(await f.page.locator('#alerts').textContent(),/Valid warning/);assert.match(await f.page.locator('#alerts').textContent(),/unavailable/);assert.equal(await f.page.locator('#support-links a').count(),0);
      assert.equal(await f.page.evaluate(()=>overviewQA.sources.at(-1)[0]),'sourcesUnavailable');
    }
    value.portfolio.explorerStatus={available:true};value.portfolio.payStatus=null;
    await f.page.evaluate(value=>overviewQA.render(value),value);assert.equal(await f.page.locator('#balance').textContent(),'0 YNXT');assert.equal(await f.page.evaluate(()=>overviewQA.sources.at(-1)[0]),'explorerLivePayUnavailable');
    value.portfolio.payStatus={available:true};value.alerts=[];
    await f.page.evaluate(value=>overviewQA.render(value),value);assert.equal(await f.page.evaluate(()=>overviewQA.sources.at(-1)[0]),'sourcesLive');assert.match(await f.page.locator('#alerts').textContent(),/noAlerts/);
    value.alerts=null;await f.page.evaluate(value=>overviewQA.render(value),value);assert.match(await f.page.locator('#alerts').textContent(),/unavailable/);assert.doesNotMatch(await f.page.locator('#alerts').textContent(),/noAlerts/);
    assert.deepEqual(f.errors,[]);assert.equal(f.requests(),0);assert.equal(f.context.pages().length,1);assert.equal(f.page.url(),'about:blank');
  }finally{await f.browser.close()}
});

test('invalid overview envelope or privacy receipt rejects before any displayed values or saved privacy are replaced',async()=>{
  const f=await fixture();try{
    await f.page.evaluate(value=>overviewQA.render(value),overview());
    const previous=await f.page.locator('#workspace').innerHTML();
    for(const value of [null,[],{}, {...overview(),portfolio:null},{...overview(),profile:null},{...overview(),portfolio:{account:''}}, {...overview(),profile:{privacy:null}}, {...overview(),profile:{privacy:{includePayInStatements:'false',allowAiActivityContext:false,alertsEnabled:true}}}]){
      const failure=await f.page.evaluate(value=>{try{overviewQA.render(value);return null}catch(error){return error.code}},value);
      assert.equal(failure,'FINANCE_OVERVIEW_INVALID');assert.equal(await f.page.locator('#workspace').innerHTML(),previous);
    }
    assert.deepEqual(f.errors,[]);assert.equal(f.requests(),0);
  }finally{await f.browser.close()}
});

test('actual overview loader validates before ready/owner reconciliation and recovers only from an explicit fresh read',async()=>{
  const f=await fixture();try{
    const loader=app.slice(app.indexOf('const dataDisabledControls='),app.indexOf('async function reconnect('));
    await f.page.addScriptTag({content:`const formSaves=new WeakMap();let returnedOverview=null,readCalls=0,reconciles=0;window.YNXFinanceWallet={ready:Promise.resolve(),connected:()=>true,session:()=>({account:'owned-render-fixture'}),reportPrivateFailure(){throw Error('Malformed UI source must not revoke Wallet')}};function renderBrowserWalletIdentity(){return true}function reconcileOpaqueBrokerOwner(){reconciles++}async function api(){readCalls++;return returnedOverview}${loader}\nwindow.loaderQA={read:load,set(value){returnedOverview=value},inspect(){return {readCalls,reconciles,overview:state.overview,dataState:$('#workspace').dataset.dataState,submitDisabled:$('#privacy-form button').disabled}}};`});
    await f.page.evaluate(()=>loaderQA.read());
    let view=await f.page.evaluate(()=>loaderQA.inspect());assert.equal(view.readCalls,1);assert.equal(view.reconciles,0);assert.equal(view.overview,null);assert.equal(view.dataState,'unavailable');assert.equal(view.submitDisabled,true);
    await f.page.evaluate(value=>loaderQA.set(value),overview());await f.page.evaluate(()=>loaderQA.read({fresh:true}));
    view=await f.page.evaluate(()=>loaderQA.inspect());assert.equal(view.readCalls,2);assert.equal(view.reconciles,1);assert.equal(view.dataState,'ready');assert.equal(view.submitDisabled,false);assert.equal(view.overview.portfolio.account,'owned-render-fixture');
    assert.equal(await f.page.locator('#balance').textContent(),'0 YNXT');assert.deepEqual(f.errors,[]);assert.equal(f.requests(),0);
  }finally{await f.browser.close()}
});

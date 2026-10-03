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

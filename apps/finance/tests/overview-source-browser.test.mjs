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
test('real locale event retains source-bound Explorer links and full references in both activity views',async()=>{
  const f=await fixture();try{
    const value=overview(),hash='0x'+'b'.repeat(64);
    value.portfolio.activity=[{id:hash,type:'transfer',direction:'incoming',amountYnxt:1,feeYnxt:0,timestamp:value.portfolio.asOf,source:'ynx-explorerd:indexed-transaction'}];
    value.portfolio.explorerStatus={available:true,source:'https://explorer.example.invalid'};
    await f.page.evaluate(value=>{state.connected=true;state.overview=value;overviewQA.render(value)},value);
    const listener=app.split('\n').find(line=>line.startsWith("document.addEventListener('finance:localechange'"));
    await f.page.addScriptTag({content:`function renderBrokerConfigurationStatus(){}function renderBrokerDiagnostics(){}function renderWalletIdentity(){}function renderBrokerSnapshot(){}function renderSourceStatus(){}function renderBrokerQuote(){}function renderBrokerWorkspace(){}const brokerWorkspaceDisplay=null,brokerApprovalDisplay=null,brokerApprovalMessageKey=null,brokerAssetResults=null;${listener}`});
    await f.page.addScriptTag({content:await readFile(new URL('../web/finance-locale.js',import.meta.url),'utf8')});
    for(const locale of await f.page.evaluate(()=>YNXFinanceLocale.supported)){
      await f.page.locator('#finance-language').selectOption(locale);
      for(const view of ['#activity-body','#recent-activity']){
        assert.equal(await f.page.locator(view+' a').getAttribute('href'),'https://explorer.example.invalid/tx/'+hash);
        assert.equal(await f.page.locator(view+' code').textContent(),hash);
      }
      assert.deepEqual(await f.page.evaluate(()=>state.overview),value);
    }
    assert.deepEqual(f.errors,[]);assert.equal(f.requests(),0);assert.equal(f.context.pages().length,1);
  }finally{await f.browser.close()}
});
test('indexed Finance activity exposes exact escaped reference and only contract-bound Explorer links',async()=>{
  const f=await fixture();try{
    const value=overview(),hash='0x'+'a'.repeat(64);
    value.portfolio.activity=[{id:hash,type:'transfer',direction:'incoming',amountYnxt:1,feeYnxt:0,timestamp:'2026-10-04T00:00:00Z',source:'ynx-explorerd:indexed-transaction'}];
    value.portfolio.explorerStatus={available:true,source:'https://explorer.example.invalid'};
    await f.page.evaluate(value=>overviewQA.render(value),value);
    assert.equal(await f.page.locator('#activity-body a').getAttribute('href'),'https://explorer.example.invalid/tx/'+hash);
    await f.page.locator('#activity-body summary').click();assert.equal(await f.page.locator('#activity-body code').textContent(),hash);
    for(const source of ['javascript:alert(1)','http://explorer.example.invalid','https://user:secret@explorer.example.invalid','https://explorer.example.invalid/api/txs','https://explorer.example.invalid/?redirect=x','//explorer.example.invalid']){
      value.portfolio.explorerStatus.source=source;await f.page.evaluate(value=>overviewQA.render(value),value);assert.equal(await f.page.locator('#activity-body a').count(),0);
    }
    value.portfolio.explorerStatus.source='https://explorer.example.invalid';
    for(const row of [{id:'internal-order-1',source:'ynx-explorerd:indexed-transaction'},{id:hash,source:'internal-order'},{id:'<img src=x onerror=alert(1)>',source:'ynx-explorerd:indexed-transaction'}]){
      Object.assign(value.portfolio.activity[0],row);await f.page.evaluate(value=>overviewQA.render(value),value);assert.equal(await f.page.locator('#activity-body a,#activity-body img').count(),0);assert.equal(await f.page.locator('#activity-body code').textContent(),row.id);
    }
    value.portfolio.activity[0].id=hash;value.portfolio.explorerStatus.available=false;await f.page.evaluate(value=>overviewQA.render(value),value);assert.equal(await f.page.locator('#activity-body a').count(),0);
    assert.deepEqual(f.errors,[]);assert.equal(f.requests(),0);assert.equal(f.context.pages().length,1);
  }finally{await f.browser.close()}
});
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
      ...[false,true].map(conflict=>({calculationStatus:'partial',activity:[
        {id:'same-source-record',direction:'incoming',amountYnxt:7,feeYnxt:1,timestamp:'2026-09-01T00:00:00Z'},
        {id:'same-source-record',direction:conflict?'outgoing':'incoming',amountYnxt:conflict?2:7,feeYnxt:1,timestamp:'2026-09-01T00:00:00Z'}
      ],observedTotals:{incomingYnxt:conflict?7:14,outgoingYnxt:conflict?2:0,feesYnxt:2}})),
      ...[
        {direction:'sideways'}, {timestamp:'2026-10-01T00:00:00Z'},
        {amountYnxt:-1}, {amountYnxt:'1'}, {feeYnxt:-1},
        {id:null}, {id:''}, {id:' controlled-row '}, {id:1}
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
    const exactSameAmounts={calculationStatus:'partial',activity:[
      {id:'distinct-source-one',direction:'incoming',amountYnxt:7,feeYnxt:1,timestamp:'2026-09-01T00:00:00Z'},
      {id:'distinct-source-two',direction:'incoming',amountYnxt:7,feeYnxt:1,timestamp:'2026-09-01T00:00:00Z'}
    ],observedTotals:{incomingYnxt:14,outgoingYnxt:0,feesYnxt:2}};
    await f.page.evaluate(patch=>{window.statementPending=statementQA.read();statementQA.reply(patch)},exactSameAmounts);await f.page.evaluate(()=>statementPending);
    assert.match(await f.page.locator('#statement').textContent(),/observedIncoming14 YNXT/);
    assert.equal((await f.page.evaluate(()=>statementQA.inspect())).statement.activity.length,2);
    assert.equal(await f.page.evaluate(()=>{
      const before=document.querySelector('#statement').innerHTML;
      const candidate={...state.statement,activity:[state.statement.activity[0],state.statement.activity[0]]};
      let rejected=false;try{renderStatement(candidate)}catch{rejected=true}
      return rejected&&document.querySelector('#statement').innerHTML===before;
    }),true,'direct rendering must reject duplicate references before replacing a verified display');
    assert.deepEqual(f.errors,[]);assert.equal(f.requests(),0);assert.equal(f.context.pages().length,1);
  }finally{await f.browser.close()}
});
async function fixture(){
  const browser=await chromium.launch(await financeBrowserLaunchOptions()),context=await browser.newContext(),page=await context.newPage();
  const errors=[];let requests=0;page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{requests++;return route.abort()});
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  await page.addScriptTag({content:`const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],financeText=k=>window.YNXFinanceLocale?.text(k)??k,esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');const state={context:1},formUncommittedDrafts=new WeakMap();let ownedFormAccount=null;const sources=[];function sourceStatus(...v){sources.push(v)}function rememberOwnedFormDrafts(){}function restoreOwnedFormDrafts(){}function refreshBrokerSnapshot(){}async function refreshBrokerWorkspace(){return null}async function restoreBrokerApproval(){}async function completeBrokerCallback(){}function notifyFailure(){}function route(){};${formatters}\n${views}\nwindow.overviewQA={render,sources};`});
  return {browser,page,context,errors,requests:()=>requests};
}
test('statement returned records reconcile exact amounts and references without borrowing overview authority',async()=>{
  const f=await fixture();try{
    const controller=app.slice(app.indexOf('function renderStatement('),app.indexOf('let statementOperation='));
    await f.page.addScriptTag({content:controller+app.slice(app.indexOf('function validateStatementObservation('),app.indexOf('function loadStatement('))});
    const hash='0x'+'c'.repeat(64),unsafe='<img src=x onerror=alert(1)>',value={schemaVersion:'finance-statement-v2',account:'owned-render-fixture',network:'YNX Testnet',symbol:'YNXT',from:'2026-09-01T00:00:00Z',toExclusive:'2026-10-01T00:00:00Z',coverageComplete:false,calculationStatus:'partial',totals:{incomingYnxt:null,outgoingYnxt:null,feesYnxt:null},observedTotals:{incomingYnxt:7,outgoingYnxt:2,feesYnxt:1},openingBalance:'unavailable',activity:[{id:hash,type:'transfer',direction:'incoming',amountYnxt:7,feeYnxt:0,timestamp:'2026-09-01T00:00:00Z',source:'ynx-explorerd:indexed-transaction'},{id:unsafe,type:unsafe,direction:'outgoing',amountYnxt:2,feeYnxt:1,timestamp:'2026-09-30T23:59:59Z'}]};
    await f.page.evaluate(value=>{state.overview={portfolio:{explorerStatus:{available:true,source:'https://wrong-overview.invalid'}}};renderStatement(value)},value);
    assert.equal(await f.page.locator('.statement-records .row').count(),2);
    assert.deepEqual(await f.page.locator('.statement-records code').allTextContents(),[hash,unsafe]);
    assert.deepEqual(await f.page.locator('.statement-records .row-value').allTextContents(),['+7 YNXTfeeLabel 0','-2 YNXTfeeLabel 1']);
    assert.equal(await f.page.locator('.statement-records a,.statement-records img').count(),0);
    value.sourceStatus={explorer:{available:true,source:'https://statement-explorer.invalid'}};
    await f.page.evaluate(value=>renderStatement(value),value);
    assert.equal(await f.page.locator('.statement-records a').getAttribute('href'),'https://statement-explorer.invalid/tx/'+hash);
    await f.page.addStyleTag({content:await readFile(new URL('../web/styles.css',import.meta.url),'utf8')});
    await f.page.setViewportSize({width:390,height:844});
    await f.page.evaluate(()=>{document.querySelector('#workspace').classList.remove('hidden');document.querySelector('#statements').classList.add('active');document.querySelector('#statement .statement-records summary').click()});
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'expanded full reference must fit mobile layout');
    await f.page.addScriptTag({content:await readFile(new URL('../web/finance-locale.js',import.meta.url),'utf8')});
    for(const locale of await f.page.evaluate(()=>YNXFinanceLocale.supported)){
      await f.page.locator('#finance-language').selectOption(locale);await f.page.evaluate(value=>renderStatement(value),value);
      assert.equal(await f.page.locator('.statement-records h3').textContent(),await f.page.evaluate(()=>YNXFinanceLocale.text('returnedRecords')));
      assert.deepEqual(await f.page.locator('.statement-records code').allTextContents(),[hash,unsafe]);
    }
    await f.page.evaluate(value=>renderStatement({...value,calculationStatus:'unknown',observedTotals:null}),value);
    assert.equal(await f.page.locator('.statement-records').count(),0,'unreconciled observations must not look verified');
    await f.page.evaluate(value=>renderStatement({...value,activity:[],observedTotals:{incomingYnxt:0,outgoingYnxt:0,feesYnxt:0}}),value);
    assert.equal(await f.page.locator('.statement-records .row').count(),0);
    assert.equal(await f.page.locator('.statement-records .empty').count(),1);
    const clear=app.slice(app.indexOf('function clearPrivateView('),app.indexOf('async function logout('));
    await f.page.addScriptTag({content:`function hideBrokerApproval(){}function renderBrokerWorkspace(){}function renderBrokerSnapshot(){}function renderSignedOut(){}let brokerSnapshotState,brokerWorkspaceUnavailable;${clear}`});
    await f.page.evaluate(value=>{state.statement=value;renderStatement(value);clearPrivateView({clearOpaquePending:false})},value);
    assert.equal(await f.page.locator('#statement').textContent(),'—');
    assert.equal(await f.page.locator('#statement code,#statement a').count(),0);
    assert.equal(await f.page.evaluate(()=>state.statement),null);
    assert.deepEqual(f.errors,[]);assert.equal(f.requests(),0);assert.equal(f.context.pages().length,1);
  }finally{await f.browser.close()}
});
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

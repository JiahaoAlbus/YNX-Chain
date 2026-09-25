import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

const web=new URL('../web/',import.meta.url);
const orderId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const walletStub=`window.YNXFinanceWallet={ready:Promise.resolve(),connected:()=>true,session:()=>({account:window.__financeTestAccount||'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80'}),getRevision:()=>0,requireProof:async()=>({proofHeader:'TEST_ONLY',requestId:'req_test_finance_broker_0001'}),connect:async()=>{},disconnect:async()=>({status:'disconnected'}),reportPrivateFailure:()=>{}};`;
const orderWalletStub=`window.__orderWalletFixture=Object.assign({authorityChecks:0,authorityAllowed:false,beginCalls:0,callbackCalls:0,clearCalls:0,resumeCalls:0,pending:null,callbackResult:null},window.__initialOrderWalletFixture||{});const assertAuthority=async()=>{window.__orderWalletFixture.authorityChecks++;if(window.__orderWalletFixture.authorityAllowed)return {fixture:true};throw new Error('PRIVATE_SERVICE_DEGRADED: Wallet Gateway=PENDING; Finance Product Session=PENDING.')};window.YNXFinanceOrderWallet={pending:()=>window.__orderWalletFixture.pending,clear:()=>{window.__orderWalletFixture.clearCalls++;window.__orderWalletFixture.pending=null},assertAuthority,begin:async unsigned=>{window.__orderWalletFixture.beginCalls++;const request={kind:'finance_order_approval_request',route:'ynxwallet://finance-order-approval',version:'1',unsigned},route={approved:false,expired:false,request,url:'https://wallet.example/review?request='+encodeURIComponent(unsigned.requestId)};window.__orderWalletFixture.pending=route;return route},resume:async()=>{window.__orderWalletFixture.resumeCalls++;return window.__orderWalletFixture.pending},parseReturn:async()=>{window.__orderWalletFixture.callbackCalls++;return JSON.stringify(window.__orderWalletFixture.callbackResult)}};`;
let server,browser,base,executionRequests,challengeRequests,opaqueIssueRequests,callbackRequests,opaqueExchangeRequests,executionStatusRequests,reconcileRequests,aiRequests,outboxStatus,callbackFailure,challengeSuccess;

function json(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
function workspace(){return {orders:[{requestId:'request-fixture',approvalState:'consumed',state:'submitting',order:{orderId,symbol:'ACME',side:'buy',qty:'1',maxCost:'10'}}],outbox:[{orderId,status:outboxStatus,attempts:0}],journal:[],watchlist:[],serverTime:'2026-09-19T11:00:00.000Z'};}

test.before(async()=>{
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/health')return json(res,200,{ok:true,chainId:'ynx_6423-1',portfolio:'read-only'});
    if(url.pathname==='/wallet-auth.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(walletStub);}
    if(url.pathname==='/order-wallet.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(orderWalletStub);}
    if(url.pathname==='/api/overview')return json(res,200,{portfolio:{account:'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',balanceYnxt:0,stakedYnxt:0,asOf:'2026-09-19T11:00:00.000Z',activity:[],payReceipts:[],explorerStatus:{available:false,error:'Indexer unavailable'},payStatus:{available:false}},profile:{categories:[],budgets:[],reminders:[],privacy:{includePayInStatements:false,allowAiActivityContext:true,alertsEnabled:true}},budgetProgress:[],alerts:[],support:{helpUrl:'https://support.example/help',privacyUrl:'https://support.example/privacy',disputeUrl:'https://support.example/disputes'}});
    if(url.pathname==='/api/broker/status')return json(res,200,{schema:'ynx-finance-broker-status-v1',status:{enabled:true,tradingEnvironment:'sandbox',chainEnvironment:'testnet',submissionEnabled:true,state:'CONFIGURED_NOT_VERIFIED'},walletOrderApproval:'frozen_contract_with_owner_scoped_execution_request',durableOrderJournal:'implemented_state_v2'});
    if(url.pathname==='/api/broker/assets')return json(res,200,{schema:'ynx-finance-broker-assets-v1',assets:[{id:'11111111-2222-4333-8444-555555555555',symbol:'ACME',name:'ACME fixture asset',status:'active',tradable:true}],source:'alpaca_broker_sandbox',officialSandboxVerified:false});
    if(url.pathname==='/api/ai/jobs'&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      aiRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return json(res,202,{id:'ai-broker-click-fixture',kind:'draft_broker_order',status:'ready',provider:'isolated-browser-fixture',model:'strict-schema-fixture',estimatedCost:'unverified',progress:'structured draft',result:{schemaVersion:'finance.ai.broker-order-draft.v1',draftOnly:true,orderDraft:{symbol:'ACME',side:'buy',qty:'2',limitPrice:'10.25',timeInForce:'day',warnings:['Review only']}}});
    }
    if(url.pathname==='/api/ai/jobs/ai-broker-click-fixture')return json(res,200,{id:'ai-broker-click-fixture',kind:'draft_broker_order',status:'ready',provider:'isolated-browser-fixture',model:'strict-schema-fixture',estimatedCost:'unverified',progress:'structured draft',result:{schemaVersion:'finance.ai.broker-order-draft.v1',draftOnly:true,orderDraft:{symbol:'ACME',side:'buy',qty:'2',limitPrice:'10.25',timeInForce:'day',warnings:['Review only']}}});
    if(url.pathname==='/api/broker/snapshot')return json(res,200,{schema:'ynx-finance-broker-snapshot-v1',snapshot:{provider:'alpaca_broker',environment:'sandbox',account:{providerAccountId:'11111111-2222-4333-8444-555555555555',currency:'USD',cash:'100',buyingPower:'100'},positions:[],orders:[]}});
    if(url.pathname==='/api/broker/orders'&&req.method==='GET')return json(res,200,{schema:'ynx-finance-broker-workspace-v1',workspace:workspace(),providerWriteAttempted:false});
    if(url.pathname==='/api/broker/challenges'&&req.method==='POST'){
      challengeRequests.push(url.pathname);
      if(!challengeSuccess)return json(res,500,{error:'authority gate bypassed'});
      return json(res,201,{schema:'ynx-finance-order-approval-challenge-v1',challenge:{serverTime:'2026-09-19T11:00:00.000Z',unsigned:{requestId:'request_concurrent_singleflight',expiresAt:'2026-09-19T11:05:00.000Z',order:{side:'buy',qty:'1',symbol:'ACME',limitPrice:'10',maxCost:'10',maxFee:'1'}}},providerWriteAttempted:false});
    }
    if(url.pathname==='/api/broker/order-handoff/issue'&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      opaqueIssueRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if(!challengeSuccess)return json(res,500,{error:'authority gate bypassed'});
      return json(res,201,{version:'2',ticket:'ticket_0123456789abcdefghijklmnopqrst',challenge:{account:'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',requestId:'request_11111111-2222-4333-8444-555555555555',expiresAt:'2026-09-19T11:05:00.000Z',order:{side:'buy',qty:'1',symbol:'ACME',limitPrice:'10',maxCost:'10',maxFee:'1'}},providerWriteAttempted:false});
    }
    if(url.pathname==='/api/broker/callback'&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      callbackRequests.push(Buffer.concat(chunks).toString('utf8'));
      if(callbackFailure)return json(res,500,{error:'isolated callback outage'});
      return json(res,200,{schema:'ynx-finance-order-approval-consume-v1',status:'revoked',result:{approvalState:'revoked'},providerWriteAttempted:false});
    }
    if(url.pathname==='/api/broker/order-handoff/exchange'&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      opaqueExchangeRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return json(res,200,{version:'2',status:'approved',result:{providerWriteAttempted:false}});
    }
    if(url.pathname===`/api/broker/orders/${orderId}/execution-status`&&req.method==='GET'){
      executionStatusRequests.push(url.pathname);
      return json(res,200,{schema:'ynx-finance-broker-execution-status-v1',outbox:{orderId,status:outboxStatus,attempts:0},providerWriteAttempted:false});
    }
    if(url.pathname==='/api/broker/reconcile'&&req.method==='POST'){
      reconcileRequests.push(url.pathname);
      return json(res,500,{error:'status refresh must not reconcile provider state'});
    }
    if(url.pathname===`/api/broker/orders/${orderId}/execution-request`&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      executionRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      outboxStatus='execution_requested';
      return json(res,202,{schema:'ynx-finance-broker-execution-request-v1',outbox:{orderId,status:outboxStatus},providerWriteAttempted:false,next:'controlled_worker_dispatch_once'});
    }
    const file=url.pathname==='/'||url.pathname==='/wallet-auth/callback'?'index.html':url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/.test(file)){res.writeHead(404);return res.end();}
    try{const bytes=await readFile(new URL(file,web));res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(bytes);}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch(await financeBrowserLaunchOptions());
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});

test('guest Finance workbench is English by default, switches Chinese and fits a 390px viewport',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await page.goto(base);
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(await page.locator('#markets-heading').textContent(),'Choose what you want to do');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
    assert.equal(await page.locator('#markets-heading').textContent(),'选择你要办理的事项');
    await page.waitForFunction(()=>document.querySelector('#broker-cash')?.textContent==='100 模拟美元');
    assert.equal(await page.locator('#broker-private-status').textContent(),'按本人账户从服务商读取。数值为沙盒模拟记录，不是 YNXT 或法币托管资产。');
    assert.match(await page.evaluate(()=>date('2026-09-19T11:00:00.000Z')),/年/u);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    assert.equal(await page.locator('#broker-order-form button[type="submit"]').isVisible(),false);
  }finally{await page.close()}
});

test('saved Chinese locale renders Broker unknown states on a cold 390px load',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await page.addInitScript(()=>localStorage.setItem('ynx-finance-locale','zh-CN'));
    await page.route('**/api/broker/snapshot',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await page.goto(base+'/#orders');
    assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
    assert.equal(await page.locator('#broker-account').textContent(),'未关联');
    assert.equal(await page.locator('#broker-cash').textContent(),'未知，并非零');
    assert.equal(await page.locator('#broker-buying-power').textContent(),'未知，并非零');
    assert.equal(await page.locator('#broker-positions').innerText(),'连接后查看持仓和订单。');
    assert.equal(await page.locator('#broker-orders').innerText(),'连接后查看持仓和订单。');
    assert.equal(await page.locator('#broker-sandbox').evaluate(element=>element.classList.contains('broker-unlinked')),true);
    assert.equal(await page.locator('#broker-positions').isVisible(),false);
    assert.equal(await page.locator('#broker-order-form').isVisible(),false);
    assert.equal(await page.locator('#signed-out').isVisible(),false);
    assert.equal(await page.locator('#wallet-connect').isVisible(),false);
    assert.equal(await page.locator('#broker-connect-action').isVisible(),true);
    await page.locator('#broker-asset-search input[name="query"]').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.querySelector('#broker-asset-search input[name="query"]').getBoundingClientRect().bottom<document.querySelector('.sidebar').getBoundingClientRect().top),true);
    await page.locator('#broker-connect-action').click();
    await page.waitForFunction(()=>location.hash==='#wallet-connect'&&!document.body.classList.contains('finance-route-broker'));
    assert.equal(await page.locator('#wallet-connect').isVisible(),true);
    assert.equal(await page.locator('#broker-sandbox').isVisible(),false);
    assert.equal(await page.locator('#broker-asset-search button').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(0, 47, 167)');
    assert.equal(await page.locator('#broker-asset-results .empty').evaluate(element=>getComputedStyle(element).borderStyle),'none');
    assert.equal(await page.locator('#broker-order-preview').textContent(),'尚未创建审核请求。');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }finally{await page.close()}
});

test('failed Broker asset search is not an empty result and invalidates an old selection',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});let mode='asset';const posts=[];
  page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname)});
  try{
    await page.route('**/api/broker/assets?*',route=>mode==='failure'?route.fulfill({status:503,contentType:'application/json',body:'{}'}):route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schema:'ynx-finance-broker-assets-v1',assets:mode==='empty'?[]:[{id:'11111111-2222-4333-8444-555555555555',symbol:'ACME',name:'ACME fixture asset',status:'active',tradable:true}]})}));
    await page.goto(base+'/#orders');
    await page.locator('#broker-asset-search button[type=submit]').click();
    await page.locator('#broker-asset-results [data-broker-select]').click();
    assert.equal(await page.locator('#broker-order-form [name=assetId]').inputValue(),'11111111-2222-4333-8444-555555555555');
    mode='failure';await page.locator('#broker-asset-search button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#broker-asset-results')?.textContent==='Sandbox asset directory is unavailable.');
    assert.equal(await page.locator('#broker-asset-results [data-broker-select]').count(),0);
    assert.equal(await page.locator('#broker-order-form [name=assetId]').inputValue(),'');
    assert.equal(await page.locator('#broker-order-form [name=symbol]').inputValue(),'');
    assert.equal(await page.locator('#broker-order-preview').textContent(),'No approval request created.');
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.equal(await page.locator('#broker-asset-results').innerText(),'沙盒资产目录暂不可用。');
    mode='empty';await page.locator('#broker-asset-search button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#broker-asset-results')?.textContent==='没有匹配的可交易官方资产，不会替换为示例数据。');
    await page.locator('#finance-language').selectOption('en');
    assert.equal(await page.locator('#broker-asset-results').innerText(),'No active tradable provider asset matched. Nothing was substituted.');
    assert.deepEqual(posts,[]);
  }finally{await page.close()}
});

test('Broker order main state localizes while machine codes stay behind details',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await page.goto(base);
    await page.locator('#nav a[href="#orders"]').click();
    await page.waitForFunction(()=>document.querySelector('#broker-sandbox')?.classList.contains('active-view'));
    await page.evaluate(()=>renderBrokerWorkspace({orders:[{requestId:'request_fixture',approvalState:'consumed',state:'cancel_requested',order:{orderId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',symbol:'ACME',side:'buy',qty:'2',maxCost:'21'}}],outbox:[],journal:[],watchlist:[]}));
    assert.match(await page.locator('#broker-local-orders').innerText(),/Wallet review recorded/);
    assert.equal(await page.locator('#broker-local-orders .order-machine-state').first().isVisible(),true);
    assert.equal(await page.locator('#broker-local-orders .order-machine-state').first().getAttribute('open'),null);
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.match(await page.locator('#broker-local-orders').innerText(),/已记录钱包审核/);
    assert.match(await page.locator('#broker-local-orders').innerText(),/已请求撤单/);
    assert.equal(await page.locator('#broker-local-orders').innerText().then(value=>value.includes('cancel_requested')),false);
    await page.locator('#broker-local-orders .order-machine-state').first().locator('summary').click();
    assert.match(await page.locator('#broker-local-orders').innerText(),/cancel_requested/);
  }finally{await page.close()}
});

test('desktop guest Finance keeps dynamic Broker absence and date copy in the selected language',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('#broker-cash')?.textContent==='100 simulated USD');
    assert.equal(await page.evaluate(()=>date(null)),'Date unavailable');
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.equal(await page.evaluate(()=>date(null)),'日期不可用');
    assert.equal(await page.locator('#broker-cash').textContent(),'100 模拟美元');
    await page.evaluate(async()=>{state.connected=false;await refreshBrokerSnapshot()});
    assert.equal(await page.locator('#broker-cash').textContent(),'未知，并非零');
    await page.locator('#finance-language').selectOption('en');
    assert.equal(await page.locator('#broker-cash').textContent(),'Unknown — not zero');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  }finally{await page.close()}
});

test('Finance connection state follows the selected language through offline, retry failure and recovery',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await page.goto(base);
    await page.locator('#finance-language').selectOption('zh-CN');
    await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    assert.equal(await page.locator('#source-pill').textContent(),'网络已断开 · 恢复后重新连接');
    await page.locator('#finance-language').selectOption('en');
    assert.equal(await page.locator('#source-pill').textContent(),'Offline · reconnect when network returns');
    await page.route('**/health',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false})}));
    await page.locator('#finance-language').selectOption('zh-CN');
    await page.evaluate(()=>publicHealth().catch(()=>{}));
    assert.equal(await page.locator('#source-pill').textContent(),'Finance 连接暂不可用');
    await page.unroute('**/health');
    await page.evaluate(()=>publicHealth());
    assert.equal(await page.locator('#source-pill').textContent(),'私人 Finance 服务可用');
    await page.locator('#finance-language').selectOption('en');
    assert.equal(await page.locator('#source-pill').textContent(),'Private Finance service reachable');
  }finally{await page.close()}
});

test('newer Broker asset search wins over an out-of-order result and remains localized',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await page.goto(base);
    const outcome=await page.evaluate(async()=>{
      const originalFetch=window.fetch,requests=[];
      window.fetch=(url,options)=>String(url).startsWith('/api/broker/assets?')?new Promise(resolve=>requests.push({url:String(url),options,resolve})):originalFetch(url,options);
      const query=document.querySelector('#broker-asset-search [name=query]');
      query.value='OLD';const older=searchBrokerAssets();
      query.value='NEW';const newer=searchBrokerAssets();
      if(requests.length!==2||!requests[0].options.signal.aborted)return {requests:requests.length,aborted:requests[0]?.options.signal.aborted};
      const result=asset=>new Response(JSON.stringify({schema:'ynx-finance-broker-assets-v1',assets:[asset]}),{status:200,headers:{'content-type':'application/json'}});
      requests[1].resolve(result({id:'bbbbbbbb-1111-4111-8111-111111111111',symbol:'NEW',name:'New provider asset'}));
      await newer;
      requests[0].resolve(result({id:'aaaaaaaa-1111-4111-8111-111111111111',symbol:'OLD',name:'Old provider asset'}));
      await older;
      window.fetch=originalFetch;
      return {symbols:[...document.querySelectorAll('#broker-asset-results strong')].map(element=>element.textContent),stored:[...state.brokerAssets.values()].map(asset=>asset.symbol)};
    });
    assert.deepEqual(outcome,{symbols:['NEW'],stored:['NEW']});
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.match(await page.locator('#broker-asset-results').textContent(),/沙盒中有效且可交易的资产/);
    assert.equal(await page.locator('#broker-asset-results [data-broker-select]').textContent(),'选择');
    assert.equal(await page.locator('#broker-asset-results [data-broker-watch]').textContent(),'加入关注列表');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  }finally{await page.close()}
});

test('Broker quote never labels a sample as IEX or accepts a different asset price',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await page.goto(base);
    const result=await page.evaluate(async()=>{
      selectBrokerAsset({id:'bbbbbbbb-1111-4111-8111-111111111111',symbol:'TEST',name:'Test asset'});
      const originalFetch=window.fetch;
      const quote={symbol:'OTHER',bidPrice:'9.99',askPrice:'10',timestamp:'2026-09-19T11:00:00.000Z',feed:'iex'};
      window.fetch=(url,options)=>String(url).startsWith('/api/broker/quote?')?Promise.resolve(new Response(JSON.stringify({schema:'ynx-finance-broker-quote-v1',quote,quoteState:'real_time',source:'alpaca_market_data_sandbox',officialSandboxVerified:false}),{status:200,headers:{'content-type':'application/json'}})):originalFetch(url,options);
      await refreshBrokerQuote();const mismatched=document.querySelector('#broker-quote-status').textContent;
      quote.symbol='TEST';quote.feed='sample';
      window.fetch=(url,options)=>String(url).startsWith('/api/broker/quote?')?Promise.resolve(new Response(JSON.stringify({schema:'ynx-finance-broker-quote-v1',quote,quoteState:'sample',source:'alpaca_market_data_sandbox',officialSandboxVerified:false}),{status:200,headers:{'content-type':'application/json'}})):originalFetch(url,options);
      await refreshBrokerQuote();window.fetch=originalFetch;
      return {mismatched,sample:document.querySelector('#broker-quote-status').textContent};
    });
    assert.match(result.mismatched,/No price was substituted/);
    assert.doesNotMatch(result.mismatched,/9\.99|IEX/);
    assert.match(result.sample,/SAMPLE · sample only — not live market data/);
    assert.doesNotMatch(result.sample,/IEX/);
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.match(await page.locator('#broker-quote-status').textContent(),/仅供测试的样本，并非实时行情/);
    await page.evaluate(()=>selectBrokerAsset({id:'cccccccc-1111-4111-8111-111111111111',symbol:'NEXT',name:'Next asset'}));
    assert.equal(await page.locator('#broker-quote-status').textContent(),'尚未请求报价，缺少的行情仍为未知。');
    const stale=await page.evaluate(async()=>{
      const originalFetch=window.fetch;let finish;
      window.fetch=(url,options)=>String(url).startsWith('/api/broker/quote?')?new Promise(resolve=>{finish=resolve}):originalFetch(url,options);
      const pending=refreshBrokerQuote();
      selectBrokerAsset({id:'dddddddd-1111-4111-8111-111111111111',symbol:'LATER',name:'Later asset'});
      finish(new Response(JSON.stringify({schema:'ynx-finance-broker-quote-v1',quote:{symbol:'NEXT',bidPrice:'100',askPrice:'101',timestamp:'2026-09-19T11:00:00.000Z',feed:'iex'},quoteState:'real_time',source:'alpaca_market_data_sandbox',officialSandboxVerified:false}),{status:200,headers:{'content-type':'application/json'}}));
      await pending;window.fetch=originalFetch;
      return document.querySelector('#broker-quote-status').textContent;
    });
    assert.equal(stale,'尚未请求报价，缺少的行情仍为未知。');
  }finally{await page.close()}
});

test('AI draft and manual Broker order share one asset-confirmed Wallet approval form',async()=>{
  aiRequests=[];opaqueIssueRequests=[];challengeRequests=[];challengeSuccess=true;
  const page=await browser.newPage(),posts=[];
  page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname)});
  try{
    await page.goto(base);
    await page.waitForFunction(()=>!document.querySelector('#workspace').classList.contains('hidden'));
    await page.evaluate(()=>{location.hash='assistant'});
    await page.locator('#ai-kind').selectOption('draft_broker_order');
    await page.locator('#ai-order-intent [name=symbol]').fill('ACME');
    await page.locator('#ai-order-intent [name=qty]').fill('2');
    await page.locator('#ai-order-intent [name=limitPrice]').fill('10.25');
    await page.locator('#ai-consent').check();
    await page.locator('#ai-start').click();
    await page.locator('[data-ai="use-order"]').waitFor({state:'visible'});
    await page.locator('[data-ai="use-order"]').click();
    assert.equal(await page.locator('#broker-order-form [name=assetId]').inputValue(),'');
    assert.equal(await page.locator('#broker-order-form [name=symbol]').inputValue(),'');
    assert.equal(await page.locator('#broker-order-form [name=qty]').inputValue(),'2');
    assert.equal(await page.locator('#broker-order-form [name=limitPrice]').inputValue(),'10.25');
    assert.deepEqual(opaqueIssueRequests,[]);
    await page.locator('#broker-asset-search [name=query]').fill('ACME');
    await page.locator('#broker-asset-search button[type=submit]').click();
    await page.locator('#broker-asset-results [data-broker-select]').click();
    assert.equal(await page.locator('#broker-order-form [name=assetId]').inputValue(),'11111111-2222-4333-8444-555555555555');
    await page.evaluate(()=>{window.__orderWalletFixture.authorityAllowed=true});
    await page.locator('#broker-order-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#broker-wallet-approve')?.hidden===false);
    assert.equal(aiRequests.length,1);
    assert.equal(aiRequests[0].kind,'draft_broker_order');
    assert.equal(opaqueIssueRequests.length,1);
    assert.deepEqual(opaqueIssueRequests[0].draft,{assetId:'11111111-2222-4333-8444-555555555555',symbol:'ACME',side:'buy',qty:'2',limitPrice:'10.25'});
    assert.equal(challengeRequests.length,0);
    assert.equal(posts.includes('/api/broker/orders'),false);
    assert.equal(posts.some(path=>path.includes('execution-request')),false);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('ynx.finance.order-opaque.v2.pending')!==null),true);
  }finally{await page.close()}
});

test('partially filled Broker order shows one-shot cancellation recovery after browser restart',async()=>{
  const page=await browser.newPage();let orderState='partially_filled',cancelRequests=0,cancelIntentAt=null,cancelAttemptedAt=null;
  page.on('dialog',dialog=>dialog.accept());
  const workspaceResponse=()=>({schema:'ynx-finance-broker-workspace-v1',workspace:{orders:[{requestId:'request-fixture',approvalState:'consumed',state:orderState,cancelIntentAt,cancelAttemptedAt,order:{orderId,symbol:'ACME',side:'buy',qty:'2',maxCost:'21'}}],outbox:[{orderId,status:'submitted',attempts:1}],journal:[],watchlist:[],serverTime:'2026-09-19T11:00:00.000Z'},providerWriteAttempted:false});
  await page.route('**/api/broker/orders',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(workspaceResponse())}));
  await page.route(`**/api/broker/orders/${orderId}/cancel-request`,route=>{
    cancelRequests++;orderState='cancel_requested';cancelIntentAt='2026-09-19T11:00:00.000Z';
    return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({schema:'ynx-finance-broker-cancel-request-v1',order:{state:orderState},providerWriteAttempted:false,next:'operator_worker_cancel_once'})});
  });
  try{
    await page.goto(base);
    await page.evaluate(()=>{location.hash='broker-sandbox'});
    await page.locator('[data-broker-order-cancel]').click();
    await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('Provider cancellation has not yet run'));
    assert.equal(cancelRequests,1);
    assert.equal(await page.locator('[data-broker-order-cancel]').count(),0);
    await page.reload();
    await page.evaluate(()=>{location.hash='broker-sandbox'});
    await page.waitForFunction(()=>document.querySelector('#broker-local-orders')?.textContent.includes('cancel_requested'));
    assert.equal(await page.locator('[data-broker-order-cancel]').count(),0);
    assert.equal(cancelRequests,1);
    assert.match(await page.locator('#broker-local-orders').textContent(),/operator has not yet confirmed a provider attempt/);
    orderState='partially_filled';cancelAttemptedAt='2026-09-19T11:01:00.000Z';
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#broker-local-orders')?.textContent.includes('partially_filled'));
    assert.equal(await page.locator('[data-broker-order-cancel]').count(),0);
    assert.match(await page.locator('#broker-local-orders').textContent(),/do not resend/);
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.match(await page.locator('#broker-local-orders').textContent(),/不得再次发送/);
    orderState='cancel_requested';cancelIntentAt=null;cancelAttemptedAt=null;
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#broker-local-orders')?.textContent.includes('cancel_requested'));
    assert.match(await page.locator('#broker-local-orders').textContent(),/旧版撤单状态无法判定/);
    assert.equal(await page.locator('[data-broker-order-cancel]').count(),0);
  }finally{await page.close()}
});

test('Broker workspace outage stays unavailable across language switch and recovers without inventing orders',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await page.goto(base);
    await page.waitForFunction(()=>!document.querySelector('#workspace').classList.contains('hidden'));
    await page.route('**/api/broker/orders',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'raw provider incident'})}));
    await page.evaluate(()=>refreshBrokerWorkspace());
    assert.match(await page.locator('#broker-local-orders').textContent(),/Local Broker order state is unavailable/);
    assert.doesNotMatch(await page.locator('#broker-local-orders').textContent(),/raw provider incident|No local Sandbox order drafts/);
    assert.match(await page.locator('#broker-events').textContent(),/Local Broker order state is unavailable/);
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.match(await page.locator('#broker-local-orders').textContent(),/本地券商订单状态暂不可用/);
    assert.doesNotMatch(await page.locator('#broker-local-orders').textContent(),/raw provider incident|本地尚无沙盒订单草稿/);
    await page.unroute('**/api/broker/orders');
    await page.evaluate(()=>refreshBrokerWorkspace());
    assert.match(await page.locator('#broker-local-orders').textContent(),/ACME/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  }finally{await page.close()}
});

test('Broker cancel failure remains localized and never claims a provider DELETE',async()=>{
  for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:844}});let requests=0;
    page.on('dialog',dialog=>dialog.accept());
    await page.route('**/api/broker/orders',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schema:'ynx-finance-broker-workspace-v1',workspace:{orders:[{requestId:'request-fixture',approvalState:'consumed',state:'partially_filled',order:{orderId,symbol:'ACME',side:'buy',qty:'2',maxCost:'21'}}],outbox:[{orderId,status:'submitted',attempts:1}],journal:[],watchlist:[],serverTime:'2026-09-19T11:00:00.000Z'},providerWriteAttempted:false})}));
    await page.route(`**/api/broker/orders/${orderId}/cancel-request`,route=>{requests++;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'raw provider delete failed'})})});
    try{
      await page.goto(base);
      await page.evaluate(()=>{location.hash='broker-sandbox'});
      await page.locator('[data-broker-order-cancel]').click();
      await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('Cancellation request could not be recorded'));
      assert.equal(requests,1);
      assert.match(await page.locator('#notice').textContent(),/Cancellation request could not be recorded/);
      assert.doesNotMatch(await page.locator('#notice').textContent(),/raw provider delete failed|Provider cancellation has not yet run/);
      await page.locator('#finance-language').selectOption('zh-CN');
      await page.locator('[data-broker-order-cancel]').click();
      await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('无法记录撤单请求'));
      assert.equal(requests,2);
      assert.match(await page.locator('#notice').textContent(),/无法记录撤单请求；不能推断服务商已撤单/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    }finally{await page.close()}
  }
});

test('Finance desktop and mobile rerender Exchange and Quant source status in the selected language',async()=>{
  const sources={exchange:{id:'exchange',name:'YNX Exchange',owner:'07-exchange',ownerContractAccepted:true,status:{available:false,syncStatus:'owner-endpoint-unavailable',error:'raw upstream error'},action:{configured:false}},quant:{id:'quant',name:'YNX Quant Lab',owner:'08-quant-lab',ownerContractAccepted:true,status:{available:true,syncStatus:'authoritative-persisted-quant-state'},action:{configured:false},envelope:{asOf:'2026-09-19T11:00:00.000Z',payload:{strategies:[],experiments:[],mandates:[{market:'YNXT-YUSD_TEST',maxNotional:'1000000',maxDailyLoss:'100000',maxSlippageBps:50,maxLeverageBps:20000,expiresAt:'2099-09-19T11:00:00.000Z',revoked:false}],executions:[],paper:[]}}}};
  const overview={portfolio:{account:'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',balanceYnxt:0,stakedYnxt:0,asOf:'2026-09-19T11:00:00.000Z',activity:[],payReceipts:[],explorerStatus:{available:false,error:'Indexer unavailable'},payStatus:{available:false},readSources:sources},profile:{categories:[],budgets:[],reminders:[],privacy:{includePayInStatements:false,allowAiActivityContext:true,alertsEnabled:true}},budgetProgress:[],alerts:[],support:{helpUrl:'https://support.example/help',privacyUrl:'https://support.example/privacy',disputeUrl:'https://support.example/disputes'}};
  for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:844}});
    await page.route('**/api/overview',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(overview)}));
    try{
      await page.goto(base);
      await page.waitForFunction(()=>document.querySelector('#read-sources')?.textContent.includes('EVIDENCE AVAILABLE'));
      assert.doesNotMatch(await page.locator('#read-sources').textContent(),/raw upstream error/);
      await page.locator('#finance-language').selectOption('zh-CN');
      const content=await page.locator('#read-sources').textContent();
      assert.match(content,/产品方端点不可用；不填入替代数据/);
      assert.match(content,/证据可用/);
      assert.match(content,/杠杆 2×/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    }finally{await page.close()}
  }
});

test('real browser previews a test-only DvP draft without Wallet or chain writes',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}}),posts=[];
  page.on('request',request=>{if(request.method()==='POST')posts.push(request.url())});
  const channel=(id,label)=>({id,label,environment:'test',availability:'disabled',riskNotice:'No live market.',unit:'none',settlement:'disabled',custody:'none',capabilities:[]});
  const catalog={schemaVersion:'finance-product-catalog-v1',aggregationPolicy:'never-merge-balances-cost-basis-pnl-or-performance-across-channels',channels:[
    channel('ynxt-indexed','YNXT indexed portfolio'),
    {...channel('ynx-evm-test','YNX on-chain test markets'),testMarket:{sourceCommit:'6663df43e2f973a90a591cc88fc120a540df7f4a',dryRunManifestSha256:'efd4d0c8f372a6a5c94a8687c17321b02144c4b812602a5e672252469a585802',chainId:6423,testOnly:true,deploymentVerified:false,publicAddresses:null,chainSubmissionEnabled:false,assets:['TEST-AAPL','tUSD'],settlementContract:'TestDvP'}},
    channel('broker-sandbox','Official broker sandbox'),channel('future-live','Future live products'),
  ]};
  try{
    await page.route('**/api/product-catalog',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(catalog)}));
    await page.goto(base);
    await page.locator('#nav a[href="#markets"]').click();
    await page.locator('#test-market-draft').waitFor();
    assert.equal(await page.locator('[data-channel="ynx-evm-test"] [data-chain-submission]').getAttribute('data-chain-submission'),'disabled');
    const before=posts.length;
    await page.getByLabel('TEST-AAPL quantity').fill('1.25');
    await page.getByLabel('Your limit price in tUSD per share').fill('2.500000');
    await page.getByRole('button',{name:'Preview test-only terms'}).click();
    assert.match(await page.locator('#test-market-draft-result').textContent(),/1.250000 TEST-AAPL @ 2.500000 tUSD/);
    assert.match(await page.locator('#test-market-draft-result').textContent(),/3.125000 tUSD/);
    assert.match(await page.locator('#test-market-draft-result').textContent(),/0.156250 tUSD/);
    assert.match(await page.locator('#test-market-draft-result').textContent(),/No market quote, fee, allowance, counterparty/);
    assert.equal(posts.length,before);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.locator('#finance-language').selectOption('zh-CN');
    await page.getByLabel('TEST-AAPL 数量').fill('1e6');
    await page.getByLabel('每股 tUSD 自定限价').fill('2');
    await page.getByRole('button',{name:'预览仅供测试的条件'}).click();
    assert.match(await page.locator('#test-market-draft-result').textContent(),/没有创建订单/);
    assert.equal(posts.length,before);
  }finally{await page.close()}
});

test('legacy order callback URL is scrubbed before asynchronous private authorization or subresource referrers',async()=>{
  executionRequests=[];challengeRequests=[];callbackRequests=[];executionStatusRequests=[];reconcileRequests=[];outboxStatus='pending_unwired';callbackFailure=true;challengeSuccess=false;
  const page=await browser.newPage(),subresourceReferrers=[];
  page.on('request',request=>{if(request.resourceType()!=='document')subresourceReferrers.push(request.headers()['referer']||'')});
  try{
    await page.goto(`${base}/wallet-auth/callback?financeOrderApprovalResult=test-private-proof`);
    await page.waitForFunction(()=>typeof pendingLegacyBrokerReturnURL!=='undefined');
    assert.equal(new URL(page.url()).search,'');
    assert.equal(await page.evaluate(()=>pendingLegacyBrokerReturnURL.includes('test-private-proof')),true);
    assert.equal(subresourceReferrers.some(value=>value.includes('test-private-proof')),false);
    assert.deepEqual(callbackRequests,[]);
  }finally{await page.close();}
});

test('opaque code callback URL is scrubbed before account or subresource work',async()=>{
  executionRequests=[];challengeRequests=[];callbackRequests=[];opaqueExchangeRequests=[];executionStatusRequests=[];reconcileRequests=[];
  const page=await browser.newPage(),subresourceReferrers=[];
  page.on('request',request=>{if(request.resourceType()!=='document')subresourceReferrers.push(request.headers()['referer']||'')});
  try{
    await page.goto(`${base}/wallet-auth/callback?financeOrderCode=private-code-fixture&state=private-state-fixture`);
    await page.waitForFunction(()=>typeof pendingOpaqueBrokerReturnURL!=='undefined');
    assert.equal(new URL(page.url()).search,'');
    assert.equal(await page.evaluate(()=>pendingOpaqueBrokerReturnURL.includes('private-code-fixture')),true);
    assert.equal(subresourceReferrers.some(value=>value.includes('private-code-fixture')),false);
    assert.deepEqual(callbackRequests,[]);
  }finally{await page.close()}
});

test('opaque browser callback submits only code and state after strict local route check',async()=>{
  opaqueExchangeRequests=[];
  const code='code_0123456789abcdefghijklmnopqrst',stateToken='state_0123456789abcdefghijklmnopqrst';
  const page=await browser.newPage();
  try{
    await page.goto(`${base}/wallet-auth/callback?financeOrderCode=${code}&state=${stateToken}`);
    await page.evaluate(async()=>{state.connected=true;window.__orderWalletFixture.authorityAllowed=true;await completeBrokerCallback()});
    assert.deepEqual(opaqueExchangeRequests,[{code,state:stateToken}]);
    assert.equal(new URL(page.url()).search,'');
    assert.equal(await page.evaluate(()=>pendingOpaqueBrokerReturnURL),null);
  }finally{await page.close()}
  opaqueExchangeRequests=[];
  const bad=await browser.newPage();
  try{
    await bad.goto(`${base}/wallet-auth/callback?financeOrderCode=${code}&state=${stateToken}&extra=1`);
    await bad.evaluate(async()=>{state.connected=true;window.__orderWalletFixture.authorityAllowed=true;await completeBrokerCallback()});
    assert.deepEqual(opaqueExchangeRequests,[]);
  }finally{await bad.close()}
});

test('pending shared private authority blocks challenge and execution before network or local pending state',async()=>{
  executionRequests=[];challengeRequests=[];callbackRequests=[];executionStatusRequests=[];reconcileRequests=[];outboxStatus='pending_unwired';callbackFailure=true;challengeSuccess=false;
  const page=await browser.newPage(),errors=[],externalRequests=[],dialogs=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).origin!==base)externalRequests.push(request.url());});
  page.on('dialog',dialog=>{dialogs.push(dialog.message());dialog.dismiss();});
  try{
    await page.goto(base);
	await page.evaluate(()=>{location.hash='broker-sandbox';});
    await page.waitForFunction(()=>document.querySelector('[data-broker-order-execute]'));
    await page.locator('[data-broker-order-execute]').click();
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('PRIVATE_SERVICE_DEGRADED'));
    await page.evaluate(()=>selectBrokerAsset({id:'11111111-2222-4333-8444-555555555555',symbol:'ACME',name:'ACME fixture'}));
    await page.locator('#broker-order-form [name="qty"]').fill('1');
    await page.locator('#broker-order-form [name="limitPrice"]').fill('10');
    await page.locator('#broker-order-form').evaluate(form=>form.requestSubmit());
    await page.waitForFunction(()=>window.__orderWalletFixture.authorityChecks===2);
    await page.evaluate(async()=>{history.replaceState(null,'','/wallet-auth/callback?financeOrderApprovalResult=blocked-fixture');await completeBrokerCallback();});
    await page.waitForFunction(()=>window.__orderWalletFixture.authorityChecks===3);
    assert.deepEqual(executionRequests,[]);
    assert.deepEqual(challengeRequests,[]);
    assert.deepEqual(callbackRequests,[]);
    assert.deepEqual(dialogs,[]);
    assert.deepEqual(await page.evaluate(()=>window.__orderWalletFixture),{authorityChecks:3,authorityAllowed:false,beginCalls:0,callbackCalls:0,clearCalls:0,resumeCalls:0,pending:null,callbackResult:null});
    assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.finance.order-approval.v1.pending')),null);
    assert.match(await page.locator('#broker-approval').textContent(),/not yet verified/);
    assert.deepEqual(externalRequests,[]);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('isolated activated fixture refreshes one persisted execution status without provider reconciliation',async()=>{
  executionRequests=[];challengeRequests=[];callbackRequests=[];executionStatusRequests=[];reconcileRequests=[];outboxStatus='execution_requested';callbackFailure=true;challengeSuccess=false;
  const page=await browser.newPage(),dialogs=[];page.on('dialog',dialog=>{dialogs.push(dialog.message());dialog.dismiss();});
  try{
    await page.goto(base);await page.evaluate(()=>{window.__orderWalletFixture.authorityAllowed=true;location.hash='broker-sandbox';});
    await page.waitForFunction(()=>document.querySelector(`[data-broker-order-refresh="${'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'}"]`));
    await page.locator(`[data-broker-order-refresh="${orderId}"]`).click();
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('execution_requested'));
    assert.deepEqual(executionStatusRequests,[`/api/broker/orders/${orderId}/execution-status`]);
    assert.deepEqual(reconcileRequests,[]);
    assert.deepEqual(executionRequests,[]);
    assert.deepEqual(dialogs,[]);
  }finally{await page.close();}
});

test('active pending request is restored and blocks double begin before challenge POST',async()=>{
  executionRequests=[];challengeRequests=[];callbackRequests=[];executionStatusRequests=[];reconcileRequests=[];outboxStatus='pending_unwired';callbackFailure=true;challengeSuccess=false;
  const page=await browser.newPage(),request={kind:'finance_order_approval_request',route:'ynxwallet://finance-order-approval',version:'1',unsigned:{account:'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',requestId:'request_same_pending',expiresAt:'2026-09-19T11:05:00.000Z',order:{side:'buy',qty:'1',symbol:'ACME',limitPrice:'10',maxCost:'10',maxFee:'1'}}},url='https://wallet.example/review?request=request_same_pending';
  try{
    await page.addInitScript(({request,url})=>{window.__initialOrderWalletFixture={authorityAllowed:true,pending:{approved:false,expired:false,request,url}}},{request,url});
    await page.goto(base);await page.evaluate(()=>{location.hash='broker-sandbox';});
    await page.waitForFunction(()=>document.querySelector('#broker-wallet-approve')?.href==='https://wallet.example/review?request=request_same_pending');
    await page.evaluate(()=>selectBrokerAsset({id:'11111111-2222-4333-8444-555555555555',symbol:'ACME',name:'ACME fixture'}));
    await page.locator('#broker-order-form [name="qty"]').fill('1');
    await page.locator('#broker-order-form [name="limitPrice"]').fill('10');
    await page.locator('#broker-order-form').evaluate(form=>form.requestSubmit());
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('existing Wallet request'));
    assert.deepEqual(challengeRequests,[]);
    const fixture=await page.evaluate(()=>window.__orderWalletFixture);
    assert.equal(fixture.beginCalls,0);
    assert.deepEqual(fixture.pending,{approved:false,expired:false,request,url});
    assert.equal(await page.locator('#broker-wallet-approve').getAttribute('href'),url);
  }finally{await page.close();}
});

test('concurrent submit events create one opaque ticket and Web copy does not navigate',async()=>{
  executionRequests=[];challengeRequests=[];opaqueIssueRequests=[];callbackRequests=[];executionStatusRequests=[];reconcileRequests=[];outboxStatus='pending_unwired';callbackFailure=true;challengeSuccess=true;
  const page=await browser.newPage();
  try{
    await page.addInitScript(()=>{window.__initialOrderWalletFixture={authorityAllowed:true}});
    await page.goto(base);await page.evaluate(()=>{location.hash='broker-sandbox';selectBrokerAsset({id:'11111111-2222-4333-8444-555555555555',symbol:'ACME',name:'ACME fixture'})});
    await page.locator('#broker-order-form [name="qty"]').fill('1');
    await page.locator('#broker-order-form [name="limitPrice"]').fill('10');
    await page.locator('#broker-order-form').evaluate(form=>{form.requestSubmit();form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('button[type="submit"]')}))});
    await page.waitForFunction(()=>sessionStorage.getItem('ynx.finance.order-opaque.v2.pending'));
    assert.deepEqual(challengeRequests,[]);
    assert.equal(opaqueIssueRequests.length,1);
    const fixture=await page.evaluate(()=>window.__orderWalletFixture),pending=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('ynx.finance.order-opaque.v2.pending')));
    assert.equal(fixture.beginCalls,0);
    assert.equal(pending.requestId,'request_11111111-2222-4333-8444-555555555555');
    assert.equal(pending.account,'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80');
    assert.equal(JSON.stringify(pending).includes('ACME'),false);
    await page.waitForFunction(()=>document.querySelector('#broker-wallet-approve')?.dataset.walletReviewUrl?.startsWith('ynxwallet://finance-order-approval?ticket='));
    assert.equal(await page.locator('#broker-wallet-approve').getAttribute('href'),'#');
    assert.match(await page.locator('#broker-wallet-approve').getAttribute('data-wallet-review-url'),/^ynxwallet:\/\/finance-order-approval\?ticket=/);
    const reviewURL=await page.locator('#broker-wallet-approve').getAttribute('data-wallet-review-url');
    assert.match(await page.locator('#broker-order-preview').innerText(),/ACME.*10.*simulated USD/s);
    await page.locator('#finance-language').selectOption('zh-CN');
    const localizedPreview=await page.locator('#broker-order-preview').innerText();
    for(const exactTerm of ['买入 1 ACME @ 10 模拟美元','最高金额: 10 USD','最高费用 1 USD','有效期至 2026-09-19T11:05:00.000Z'])assert.ok(localizedPreview.includes(exactTerm),exactTerm);
    assert.equal(await page.locator('#broker-wallet-approve').getAttribute('data-wallet-review-url'),reviewURL);
    assert.equal(await page.locator('#broker-wallet-approve').innerText(),'复制安全的 YNX Wallet 审核链接');
    await page.locator('#finance-language').selectOption('en');
    assert.match(await page.locator('#broker-order-preview').innerText(),/ACME.*10.*simulated USD/s);
    assert.equal(await page.locator('#broker-wallet-approve').getAttribute('data-wallet-review-url'),reviewURL);
    assert.equal(opaqueIssueRequests.length,1);
    await page.evaluate(async()=>{window.__orderWalletFixture.authorityAllowed=false;await requireBrokerOrderAuthority().catch(()=>{})});
    assert.equal(await page.locator('#broker-wallet-approve').isHidden(),true);
    assert.equal(await page.locator('#broker-wallet-approve').getAttribute('data-wallet-review-url'),null);
    assert.match(await page.locator('#broker-order-preview').innerText(),/private Wallet authority is verified/);
    assert.ok(await page.evaluate(()=>sessionStorage.getItem('ynx.finance.order-opaque.v2.pending')));
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.equal(await page.locator('#broker-wallet-approve').isHidden(),true);
    assert.equal(await page.locator('#broker-wallet-approve').getAttribute('data-wallet-review-url'),null);
    assert.match(await page.locator('#broker-order-preview').innerText(),/私有钱包权限验证前/);
    await page.evaluate(async()=>{window.__orderWalletFixture.authorityAllowed=true;await restoreBrokerApproval('2026-09-19T11:00:00.000Z')});
    assert.equal(await page.locator('#broker-wallet-approve').getAttribute('data-wallet-review-url'),reviewURL);
    assert.equal(opaqueIssueRequests.length,1);
    await page.locator('#finance-language').selectOption('en');
    const pageURL=page.url(),pagesBefore=browser.contexts().flatMap(context=>context.pages()).length;
    await page.locator('#broker-wallet-approve').click();
    assert.equal(page.url(),pageURL);
    assert.equal(browser.contexts().flatMap(context=>context.pages()).length,pagesBefore);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ynx-finance-private-state',{detail:{status:'checking'}})));
    assert.ok(await page.evaluate(()=>sessionStorage.getItem('ynx.finance.order-opaque.v2.pending')));
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#broker-wallet-approve')?.dataset.walletReviewUrl?.startsWith('ynxwallet://finance-order-approval?ticket='));
    assert.equal(await page.locator('#broker-order-preview').textContent().then(text=>text.includes('ACME')),false);
    await page.evaluate(()=>{window.__financeTestAccount='ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';window.dispatchEvent(new CustomEvent('ynx-finance-private-state',{detail:{status:'checking'}}));window.dispatchEvent(new CustomEvent('ynx-finance-private-state',{detail:{status:'connected',account:window.__financeTestAccount}}))});
    await page.waitForFunction(()=>sessionStorage.getItem('ynx.finance.order-opaque.v2.pending')===null);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('ynx.finance.order-opaque.v2.pending')),null);
    assert.equal(await page.locator('#broker-wallet-approve').isHidden(),true);
    assert.equal(await page.locator('#broker-order-preview').textContent(),'No approval request created.');
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.equal(await page.locator('#broker-wallet-approve').isHidden(),true);
    assert.equal(await page.locator('#broker-order-preview').textContent(),'尚未创建审核请求。');
    await page.evaluate(async()=>{window.__financeTestAccount='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';state.connected=true;state.overview={portfolio:{account:window.__financeTestAccount}};await restoreBrokerApproval('2026-09-19T11:00:00.000Z')});
    assert.equal(await page.locator('#broker-wallet-approve').isHidden(),true);
    await page.waitForFunction(()=>document.querySelector('#broker-order-form button[type="submit"]').disabled===false);
  }finally{await page.close();}
});

test('expired opaque review cannot reappear after a language switch or clear action',async()=>{
  const page=await browser.newPage();
  try{
    await page.goto(base);
    await page.locator('#nav a[href="#orders"]').click();
    await page.evaluate(async()=>{
      const account='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';
      state.connected=true;state.overview={portfolio:{account}};
      sessionStorage.setItem('ynx.finance.order-opaque.v2.pending',JSON.stringify({version:'2',ticket:'ticket_0123456789abcdefghijklmnopqrst',account,requestId:'request_11111111-2222-4333-8444-555555555555',expiresAt:'2026-09-19T11:05:00.000Z'}));
      await restoreBrokerApproval('2026-09-19T11:06:00.000Z');
    });
    assert.equal(await page.locator('#broker-wallet-approve').isHidden(),true);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('ynx.finance.order-opaque.v2.pending')),null);
    assert.match(await page.locator('#broker-order-preview').innerText(),/ticket expired/);
    await page.locator('#finance-language').selectOption('zh-CN');
    assert.equal(await page.locator('#broker-wallet-approve').isHidden(),true);
    assert.match(await page.locator('#broker-order-preview').innerText(),/票据已过期/);
    await page.locator('#broker-clear-approval').click();
    await page.waitForFunction(()=>document.querySelector('#broker-order-preview')?.textContent==='尚未创建审核请求。');
    assert.equal(await page.locator('#broker-wallet-approve').isHidden(),true);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('ynx.finance.order-opaque.v2.pending')),null);
  }finally{await page.close()}
});

test('callback outage preserves exact request across reload and later records Wallet revocation once',async()=>{
  executionRequests=[];challengeRequests=[];callbackRequests=[];executionStatusRequests=[];reconcileRequests=[];outboxStatus='pending_unwired';callbackFailure=true;challengeSuccess=false;
  const page=await browser.newPage(),request={kind:'finance_order_approval_request',route:'ynxwallet://finance-order-approval',version:'1',unsigned:{account:'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',requestId:'request_callback_retry',expiresAt:'2026-09-19T11:05:00.000Z',order:{side:'sell',qty:'1',symbol:'ACME',limitPrice:'9',maxCost:'0',maxFee:'1'}}},url='https://wallet.example/review?request=request_callback_retry',callbackResult={kind:'finance_order_approval_result',version:'1',status:'revoked',requestId:'request_callback_retry'};
  try{
    await page.addInitScript(({request,url,callbackResult})=>{window.__initialOrderWalletFixture={authorityAllowed:true,pending:{approved:true,expired:false,request,url},callbackResult}},{request,url,callbackResult});
    await page.goto(`${base}/wallet-auth/callback?financeOrderApprovalResult=fixture`);
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('isolated callback outage'));
    assert.equal(callbackRequests.length,1);
    assert.equal((await page.evaluate(()=>window.__orderWalletFixture)).clearCalls,0);
    await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('#broker-wallet-approve')?.href==='https://wallet.example/review?request=request_callback_retry');
    assert.equal(await page.locator('#broker-wallet-approve').getAttribute('href'),url);
    callbackFailure=false;
    await page.evaluate(()=>history.replaceState(null,'','/wallet-auth/callback?financeOrderApprovalResult=fixture'));
    await page.evaluate(()=>completeBrokerCallback());
    await page.waitForFunction(()=>window.__orderWalletFixture.pending===null);
    assert.equal(callbackRequests.length,2);
    assert.equal((await page.evaluate(()=>window.__orderWalletFixture)).clearCalls,1);
    assert.match(await page.locator('#notice').textContent(),/Wallet decision recorded/);
  }finally{await page.close();}
});

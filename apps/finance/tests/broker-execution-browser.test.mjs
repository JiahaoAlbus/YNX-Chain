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
let server,browser,base,executionRequests,challengeRequests,opaqueIssueRequests,callbackRequests,opaqueExchangeRequests,executionStatusRequests,reconcileRequests,outboxStatus,callbackFailure,challengeSuccess;

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
    await page.locator('#test-market-draft').waitFor();
    assert.equal(await page.locator('[data-channel="ynx-evm-test"] [data-chain-submission]').getAttribute('data-chain-submission'),'disabled');
    const before=posts.length;
    await page.getByLabel('TEST-AAPL quantity').fill('1.25');
    await page.getByLabel('Your limit price in tUSD per share').fill('2.500000');
    await page.getByRole('button',{name:'Preview test-only terms'}).click();
    assert.match(await page.locator('#test-market-draft-result').textContent(),/1.25 TEST-AAPL @ 2.500000 tUSD/);
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
    await page.evaluate(async()=>{window.__financeTestAccount='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';state.connected=true;state.overview={portfolio:{account:window.__financeTestAccount}};await restoreBrokerApproval('2026-09-19T11:00:00.000Z')});
    assert.equal(await page.locator('#broker-wallet-approve').isHidden(),true);
    await page.waitForFunction(()=>document.querySelector('#broker-order-form button[type="submit"]').disabled===false);
  }finally{await page.close();}
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const web=new URL('../web/',import.meta.url);
const orderId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const walletStub=`window.YNXFinanceWallet={ready:Promise.resolve(),connected:()=>true,getRevision:()=>0,requireProof:async()=>({proofHeader:'TEST_ONLY',requestId:'req_test_finance_broker_0001'}),connect:async()=>{},disconnect:async()=>({status:'disconnected'}),reportPrivateFailure:()=>{}};`;
const orderWalletStub=`window.__orderWalletFixture=Object.assign({authorityChecks:0,authorityAllowed:false,beginCalls:0,callbackCalls:0,clearCalls:0,resumeCalls:0,pending:null,callbackResult:null},window.__initialOrderWalletFixture||{});const assertAuthority=async()=>{window.__orderWalletFixture.authorityChecks++;if(window.__orderWalletFixture.authorityAllowed)return {fixture:true};throw new Error('PRIVATE_SERVICE_DEGRADED: Wallet Gateway=PENDING; Finance Product Session=PENDING.')};window.YNXFinanceOrderWallet={pending:()=>window.__orderWalletFixture.pending,clear:()=>{window.__orderWalletFixture.clearCalls++;window.__orderWalletFixture.pending=null},assertAuthority,begin:async unsigned=>{window.__orderWalletFixture.beginCalls++;const request={kind:'finance_order_approval_request',route:'ynxwallet://finance-order-approval',version:'1',unsigned},route={approved:false,expired:false,request,url:'https://wallet.example/review?request='+encodeURIComponent(unsigned.requestId)};window.__orderWalletFixture.pending=route;return route},resume:async()=>{window.__orderWalletFixture.resumeCalls++;return window.__orderWalletFixture.pending},parseReturn:async()=>{window.__orderWalletFixture.callbackCalls++;return JSON.stringify(window.__orderWalletFixture.callbackResult)}};`;
let server,browser,base,executionRequests,challengeRequests,callbackRequests,executionStatusRequests,reconcileRequests,outboxStatus,callbackFailure,challengeSuccess;

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
    if(url.pathname==='/api/broker/callback'&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      callbackRequests.push(Buffer.concat(chunks).toString('utf8'));
      if(callbackFailure)return json(res,500,{error:'isolated callback outage'});
      return json(res,200,{schema:'ynx-finance-order-approval-consume-v1',status:'revoked',result:{approvalState:'revoked'},providerWriteAttempted:false});
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
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});

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
  const page=await browser.newPage(),request={kind:'finance_order_approval_request',route:'ynxwallet://finance-order-approval',version:'1',unsigned:{requestId:'request_same_pending',expiresAt:'2026-09-19T11:05:00.000Z',order:{side:'buy',qty:'1',symbol:'ACME',limitPrice:'10',maxCost:'10',maxFee:'1'}}},url='https://wallet.example/review?request=request_same_pending';
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

test('concurrent submit events create one challenge and one local pending request',async()=>{
  executionRequests=[];challengeRequests=[];callbackRequests=[];executionStatusRequests=[];reconcileRequests=[];outboxStatus='pending_unwired';callbackFailure=true;challengeSuccess=true;
  const page=await browser.newPage();
  try{
    await page.addInitScript(()=>{window.__initialOrderWalletFixture={authorityAllowed:true}});
    await page.goto(base);await page.evaluate(()=>{location.hash='broker-sandbox';selectBrokerAsset({id:'11111111-2222-4333-8444-555555555555',symbol:'ACME',name:'ACME fixture'})});
    await page.locator('#broker-order-form [name="qty"]').fill('1');
    await page.locator('#broker-order-form [name="limitPrice"]').fill('10');
    await page.locator('#broker-order-form').evaluate(form=>{form.requestSubmit();form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('button[type="submit"]')}))});
    await page.waitForFunction(()=>window.__orderWalletFixture.pending?.request?.unsigned?.requestId==='request_concurrent_singleflight');
    assert.deepEqual(challengeRequests,['/api/broker/challenges']);
    const fixture=await page.evaluate(()=>window.__orderWalletFixture);
    assert.equal(fixture.beginCalls,1);
    assert.equal(fixture.pending.request.unsigned.requestId,'request_concurrent_singleflight');
    await page.waitForFunction(()=>document.querySelector('#broker-order-form button[type="submit"]').disabled===false);
  }finally{await page.close();}
});

test('callback outage preserves exact request across reload and later records Wallet revocation once',async()=>{
  executionRequests=[];challengeRequests=[];callbackRequests=[];executionStatusRequests=[];reconcileRequests=[];outboxStatus='pending_unwired';callbackFailure=true;challengeSuccess=false;
  const page=await browser.newPage(),request={kind:'finance_order_approval_request',route:'ynxwallet://finance-order-approval',version:'1',unsigned:{requestId:'request_callback_retry',expiresAt:'2026-09-19T11:05:00.000Z',order:{side:'sell',qty:'1',symbol:'ACME',limitPrice:'9',maxCost:'0',maxFee:'1'}}},url='https://wallet.example/review?request=request_callback_retry',callbackResult={kind:'finance_order_approval_result',version:'1',status:'revoked',requestId:'request_callback_retry'};
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const web=new URL('../web/',import.meta.url);
const orderId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const walletStub=`window.YNXFinanceWallet={ready:Promise.resolve(),connected:()=>true,getRevision:()=>0,requireProof:async()=>({proofHeader:'TEST_ONLY',requestId:'req_test_finance_broker_0001'}),connect:async()=>{},disconnect:async()=>({status:'disconnected'}),reportPrivateFailure:()=>{}};`;
const orderWalletStub=`window.YNXFinanceOrderWallet={pending:()=>null,clear:()=>{},begin:()=>{throw new Error('approval is outside this fixture')},parseReturn:()=>{throw new Error('callback is outside this fixture')}};`;
let server,browser,base,executionRequests,outboxStatus;

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
    if(url.pathname===`/api/broker/orders/${orderId}/execution-request`&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      executionRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      outboxStatus='execution_requested';
      return json(res,202,{schema:'ynx-finance-broker-execution-request-v1',outbox:{orderId,status:outboxStatus},providerWriteAttempted:false,next:'controlled_worker_dispatch_once'});
    }
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/.test(file)){res.writeHead(404);return res.end();}
    try{const bytes=await readFile(new URL(file,web));res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(bytes);}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});

test('real Finance DOM queues one controlled owner request and never calls a provider directly',async()=>{
  executionRequests=[];outboxStatus='pending_unwired';
  const page=await browser.newPage(),errors=[],externalRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).origin!==base)externalRequests.push(request.url());});
  page.on('dialog',dialog=>dialog.accept());
  try{
    await page.goto(base);
	await page.evaluate(()=>{location.hash='broker-sandbox';});
    await page.waitForFunction(()=>document.querySelector('[data-broker-order-execute]'));
    await page.locator('[data-broker-order-execute]').click();
    await page.waitForFunction(()=>document.querySelector('#broker-local-orders').textContent.includes('execution_requested'));
    assert.deepEqual(executionRequests,[{idempotencyKey:`finance-execution-${orderId}`}]);
    assert.equal(await page.locator('[data-broker-order-execute]').count(),0);
    assert.deepEqual(externalRequests,[]);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

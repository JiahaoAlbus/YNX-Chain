import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

const web=new URL('../web/',import.meta.url);
const walletStub=`window.YNXFinanceWallet={ready:Promise.resolve(),connected:()=>true,getRevision:()=>0,requireProof:async()=>({proofHeader:'TEST_ONLY',requestId:'req_test_finance_ai_0001'}),connect:async()=>{},disconnect:async()=>({status:'disconnected'}),reportPrivateFailure:()=>{}};`;
const orderWalletStub=`window.YNXFinanceOrderWallet={pending:()=>null,clear:()=>{},begin:()=>{throw new Error('order Wallet is outside this AI fixture')},parseReturn:()=>{throw new Error('order Wallet is outside this AI fixture')}};`;
let server,browser,base,aiRequests;

function json(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
test.before(async()=>{
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/health')return json(res,200,{ok:true,chainId:'ynx_6423-1',portfolio:'read-only'});
    if(url.pathname==='/wallet-auth.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(walletStub);}
    if(url.pathname==='/order-wallet.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(orderWalletStub);}
    if(url.pathname==='/api/overview')return json(res,200,{
      portfolio:{account:'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',balanceYnxt:1,stakedYnxt:0,asOf:'2026-09-19T11:00:00.000Z',activity:[{id:'owned-ai-record',type:'transfer',direction:'incoming',amountYnxt:1,feeYnxt:0,timestamp:'2026-09-19T11:00:00.000Z'}],payReceipts:[],explorerStatus:{available:true},payStatus:{available:true}},
      profile:{categories:[],budgets:[],reminders:[],privacy:{includePayInStatements:false,allowAiActivityContext:true,alertsEnabled:true}},budgetProgress:[],alerts:[],support:{helpUrl:'https://support.example/help',privacyUrl:'https://support.example/privacy',disputeUrl:'https://support.example/disputes'}
    });
    if(url.pathname==='/api/broker/status')return json(res,200,{schema:'ynx-finance-broker-status-v1',status:{enabled:false,tradingEnvironment:'sandbox',chainEnvironment:'testnet',submissionEnabled:false,state:'DISABLED'}});
    if(url.pathname==='/api/broker/snapshot')return json(res,200,{schema:'ynx-finance-broker-snapshot-v1',snapshot:{provider:'alpaca_broker',environment:'sandbox',account:{providerAccountId:'11111111-2222-4333-8444-555555555555',currency:'USD',cash:'0',buyingPower:'0'},positions:[],orders:[]}});
    if(url.pathname==='/api/broker/orders')return json(res,200,{schema:'ynx-finance-broker-workspace-v1',workspace:{orders:[],outbox:[],journal:[],watchlist:[],serverTime:'2026-09-19T11:00:00.000Z'}});
    if(url.pathname==='/api/ai/jobs'&&req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      aiRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      await new Promise(resolve=>setTimeout(resolve,75));
      return json(res,202,{id:'ai-browser-fixture',kind:'draft_broker_order',status:'ready',provider:'loopback-browser-fixture',model:'strict-schema-fixture',estimatedCost:'unverified',progress:'structured draft',result:{schemaVersion:'finance.ai.broker-order-draft.v1',draftOnly:true,orderDraft:{symbol:'ACME',side:'buy',qty:'2',limitPrice:'10.25',timeInForce:'day',warnings:['Review only']}}});
    }
    if(url.pathname==='/api/ai/jobs/ai-browser-fixture')return json(res,200,{id:'ai-browser-fixture',kind:'draft_broker_order',status:'ready',provider:'loopback-browser-fixture',model:'strict-schema-fixture',estimatedCost:'unverified',progress:'structured draft'});
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/.test(file)){res.writeHead(404);return res.end();}
    try{const bytes=await readFile(new URL(file,web));res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(bytes);}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch(await financeBrowserLaunchOptions());
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});

async function fixture(){
  aiRequests=[];
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#workspace')&&!document.querySelector('#workspace').classList.contains('hidden'));
  await page.evaluate(()=>{location.hash='assistant'});
  await page.selectOption('#ai-kind','draft_broker_order');
  await page.locator('#ai-records input').check();
  await page.locator('#ai-consent').check();
  return {page,errors};
}
async function fillIntent(page,{symbol='ACME',qty='2',price='10.25'}={}){
  await page.locator('#ai-order-intent [name=symbol]').fill(symbol);
  await page.locator('#ai-order-intent [name=qty]').fill(qty);
  await page.locator('#ai-order-intent [name=limitPrice]').fill(price);
}

test('real Finance DOM submits one canonical AI Broker order intent and restores the button',async()=>{
  const {page,errors}=await fixture();
  try{
    assert.equal(await page.locator('#ai-order-intent').evaluate(node=>node.tagName),'FORM');
    await fillIntent(page);
    const response=page.waitForResponse(value=>value.request().method()==='POST'&&new URL(value.url()).pathname==='/api/ai/jobs');
    await page.locator('#ai-start').click();
    assert.equal(await page.locator('#ai-start').isDisabled(),true);
    await response;
    await page.waitForFunction(()=>!document.querySelector('#ai-start').disabled);
    assert.equal(await page.locator('#ai-start').textContent(),'Request review draft');
    assert.equal(aiRequests.length,1);
    assert.deepEqual(aiRequests[0],{kind:'draft_broker_order',recordIds:['owned-ai-record'],contextClasses:['owned_activity'],consent:true,securitiesOrderIntent:{symbol:'ACME',side:'buy',qty:'2',limitPrice:'10.25'}});
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('real Finance DOM rejects missing AI order fields before any request and restores the button',async()=>{
  const {page,errors}=await fixture();
  try{
    await fillIntent(page,{qty:''});
    await page.locator('#ai-start').click();
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Quantity must be'));
    assert.equal(aiRequests.length,0);
    assert.equal(await page.locator('#ai-start').isDisabled(),false);
    assert.equal(await page.locator('#ai-start').textContent(),'Request review draft');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('language switch relabels loaded AI records without dropping exact selected owner IDs',async()=>{
  const {page,errors}=await fixture();
  try{
    const selected=await page.locator('#ai-records input:checked').inputValue();
    await page.evaluate(()=>window.YNXFinanceLocale.set('zh-CN'));
    assert.equal(await page.locator('#ai-records input:checked').inputValue(),selected);
    assert.match(await page.locator('#assistant .section-head p').textContent(),/获得同意后/u);
    await page.selectOption('#finance-language','ar');
    assert.equal(await page.locator('#ai-records input:checked').inputValue(),selected);
    assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
    assert.match(await page.locator('#assistant .section-head p').textContent(),/المعاينة/u);
    assert.deepEqual(errors,[]);
  }finally{await page.close()}
});

test('real Finance DOM rejects non-canonical AI order decimals before any request',async()=>{
  const {page,errors}=await fixture();
  try{
    for(const invalid of [{qty:'2/1',price:'10.25',message:'Quantity must be'},{qty:'2',price:'1e2',message:'Limit price must be'}]){
      await fillIntent(page,invalid);
      await page.locator('#ai-start').click();
      await page.waitForFunction(message=>document.querySelector('#notice').textContent.includes(message),invalid.message);
      assert.equal(await page.locator('#ai-start').isDisabled(),false);
      assert.equal(await page.locator('#ai-start').textContent(),'Request review draft');
    }
    assert.equal(aiRequests.length,0);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('real Finance DOM permits an explicit empty chain context and copies only the returned draft',async()=>{
  const {page,errors}=await fixture();
  try{
    await page.locator('#ai-records input').uncheck();
    await fillIntent(page,{symbol:'ACME',qty:'2',price:'10.25'});
    const response=page.waitForResponse(value=>value.request().method()==='POST'&&new URL(value.url()).pathname==='/api/ai/jobs');
    await page.locator('#ai-start').click();
    await response;
    await page.waitForFunction(()=>!document.querySelector('[data-ai="use-order"]').classList.contains('hidden'));
    assert.deepEqual(aiRequests[0],{kind:'draft_broker_order',recordIds:[],contextClasses:[],consent:true,securitiesOrderIntent:{symbol:'ACME',side:'buy',qty:'2',limitPrice:'10.25'}});
    await page.locator('[data-ai="use-order"]').click();
    assert.equal(await page.locator('#broker-order-form [name=symbol]').inputValue(),'');
    assert.equal(await page.locator('#broker-order-form [name=side]').inputValue(),'buy');
    assert.equal(await page.locator('#broker-order-form [name=qty]').inputValue(),'2');
    assert.equal(await page.locator('#broker-order-form [name=limitPrice]').inputValue(),'10.25');
    assert.equal(await page.locator('#broker-asset-search [name=query]').inputValue(),'ACME');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

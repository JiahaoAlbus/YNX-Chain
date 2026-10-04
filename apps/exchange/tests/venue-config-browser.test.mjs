import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8'),app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const render=app.slice(app.indexOf('function withdrawEstimate('),app.indexOf('async function refreshAll('));
const bind=app.slice(app.indexOf('function bindVenueConfig('),app.indexOf('function withdrawEstimate('));
const close=app.slice(app.indexOf('function closeCommandReview('),app.indexOf('function checkCommandRequirements('));
test('real config module GET drives fee/address display; refresh/offline/HTML fence reviews but preserve forms and Standard connection',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),requests=[],errors=[];
    let fee=250000,fallback=false;
    page.on('request',r=>requests.push({url:r.url(),method:r.method(),headers:r.headers()}));page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://exchange.example/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/')return route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
      if(path==='/api/v1/config')return fallback?route.fulfill({contentType:'text/html',body:'<h1>Old fallback, not JSON configuration</h1>'}):route.fulfill({json:{chainId:'ynx_6423-1',evmChainId:6423,nativeAsset:'YNXT',custodyAddress:'ynx1controlledaddressonly',networks:[{asset:'YNXT',network:'YNX Testnet',chainId:'ynx_6423-1',evmChainId:6423,depositEnabled:true,withdrawalEnabled:false,withdrawalReviewEnabled:true,withdrawalBroadcastEnabled:false,crossChain:false,confirmations:12,withdrawalFeeMicro:fee}]}});
      const name=path.slice(1);if(!['venue-config.js','market-data.js','order-preview.js'].includes(name))return route.abort();return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../web/'+name,import.meta.url),'utf8')});
    });
    await page.goto('https://exchange.example/#assets');
    await page.addScriptTag({type:'module',content:`import {createVenueConfigReader} from '/venue-config.js';import {parseMicro} from '/order-preview.js';import {formatMicro} from '/market-data.js';const $=s=>document.querySelector(s);const state={config:null,standardWallet:{status:'standard-connected'}};const display=v=>formatMicro(v,document.documentElement.lang);const productApiUnavailable=()=>({code:'API_UNAVAILABLE'});${close}\n${render}\n${bind}\nconst venueConfig=createVenueConfigReader({onState:renderVenueConfig});bindVenueConfig();window.configQA={refresh:venueConfig.refresh,offline:venueConfig.offline,stop:venueConfig.stop,wallet:()=>state.standardWallet,review(){state.commandReview={kind:'withdrawal'};$('#command-review-dialog').showModal()}};`});
    await page.waitForFunction(()=>window.configQA);
    await page.locator('#withdraw-amount').fill('1.000001');await page.locator('#withdraw-destination').fill('ynx1unsentdraft');
    await page.evaluate(()=>configQA.refresh());assert.equal(await page.locator('#withdraw-fee').textContent(),'0.25 YNXT');assert.equal(await page.locator('#withdraw-receive').textContent(),'0.750001 YNXT');assert.equal(await page.locator('#custody-address').textContent(),'ynx1controlledaddressonly');
    await page.evaluate(()=>configQA.review());fee=400000;await page.evaluate(()=>configQA.refresh());assert.equal(await page.locator('#command-review-dialog').evaluate(d=>d.open),false);assert.equal(await page.locator('#withdraw-fee').textContent(),'0.40 YNXT');
    await page.evaluate(()=>{configQA.review();configQA.offline()});assert.equal(await page.locator('#withdraw-fee').textContent(),'—');assert.equal(await page.locator('#withdraw-receive').textContent(),'—');assert.equal(await page.locator('#command-review-dialog').evaluate(d=>d.open),false);
    const readback=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/config');await page.locator('#venue-config-retry').click();await readback;await page.waitForFunction(()=>document.querySelector('#withdraw-fee').textContent==='0.40 YNXT');fallback=true;await page.evaluate(()=>configQA.refresh());assert.equal(await page.locator('#withdraw-fee').textContent(),'—');assert.match(await page.locator('#custody-address').textContent(),/Separate approved/);
    assert.equal(await page.locator('#withdraw-amount').inputValue(),'1.000001');assert.equal(await page.locator('#withdraw-destination').inputValue(),'ynx1unsentdraft');assert.equal((await page.evaluate(()=>configQA.wallet())).status,'standard-connected');
    const configRequests=requests.filter(r=>new URL(r.url).pathname==='/api/v1/config');assert.equal(configRequests.length,4);for(const r of configRequests){assert.equal(r.method,'GET');assert.equal('authorization' in r.headers,false);assert.equal('x-ynx-product-session-proof-v2' in r.headers,false)}
    assert.equal(requests.filter(r=>r.method!=='GET').length,0);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);await page.evaluate(()=>configQA.stop());await context.close();
  }}finally{await browser.close()}
});

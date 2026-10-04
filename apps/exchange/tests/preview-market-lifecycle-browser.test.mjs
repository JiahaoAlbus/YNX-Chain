import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const marketStatus=app.slice(app.indexOf('function renderMarketStatus('),app.indexOf('async function refreshBook('));
const feed=app.slice(app.indexOf('function retireMarketPreview('),app.indexOf('async function boot('));

test('actual preview dialog retires on market loss or rule change, not equivalent live observation, without deleting draft',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();let requests=0;page.on('request',()=>requests++);
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={rules:null};const createMarketFeed=options=>{window.feedQA=options;return {retry:async()=>{}}};function renderBook(){}function renderPublicMarket(){}function estimate(){}${feed}\n${marketStatus}\nwindow.marketStatusQA=renderMarketStatus;`});
    const source={authority:'YNX-owned deterministic order state',coverage:'stream-orderbook-matched-trades',asOf:'2026-10-04T00:00:00Z',version:'exchange-public-state-v1',status:'degraded_single_host'};
    const snapshot={sourceMetadata:source,trades:[],orderBook:{},tradingRules:{schemaVersion:'same-test-rules',makerFeeBps:10,takerFeeBps:20}};
    await page.evaluate(value=>feedQA.onSnapshot(value),snapshot);
    for(const phase of ['loading','offline','reconnecting','unavailable']){
      await page.evaluate(()=>{document.querySelector('#price').value='2';document.querySelector('#amount').value='3';document.querySelector('#order-preview-values').textContent='Old reviewed costs';document.querySelector('#order-preview-dialog').showModal()});
      await page.evaluate(value=>marketStatusQA(value),{phase,source});
      assert.equal(await page.locator('#order-preview-dialog').evaluate(d=>d.open),false,phase);
      assert.equal(await page.locator('#order-preview-values').textContent(),'');
      assert.equal(await page.locator('#price').inputValue(),'2');assert.equal(await page.locator('#amount').inputValue(),'3');
    }
    await page.evaluate(()=>{document.querySelector('#order-preview-values').textContent='Current reviewed costs';document.querySelector('#order-preview-dialog').showModal()});
    await page.evaluate(value=>feedQA.onSnapshot(value),{...snapshot,tradingRules:{takerFeeBps:20,makerFeeBps:10,schemaVersion:'same-test-rules'}});
    await page.evaluate(value=>marketStatusQA(value),{phase:'live',source});
    assert.equal(await page.locator('#order-preview-dialog').evaluate(d=>d.open),true,'key ordering alone does not change rules');
    await page.evaluate(value=>feedQA.onSnapshot(value),{...snapshot,tradingRules:{...snapshot.tradingRules,takerFeeBps:21}});
    assert.equal(await page.locator('#order-preview-dialog').evaluate(d=>d.open),false,'changed fee requires another explicit review');
    assert.equal(await page.locator('#order-preview-values').textContent(),'');assert.equal(await page.locator('#price').inputValue(),'2');
    assert.equal(page.context().pages().length,1);assert.equal(requests,0);
  }finally{await browser.close()}
});

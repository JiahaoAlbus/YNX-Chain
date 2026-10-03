import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const receipts=app.slice(app.indexOf('function financeNavigationURL('),app.indexOf('\n',app.indexOf('function renderReceipts(')));
const support=app.slice(app.indexOf('function renderSupport('),app.indexOf('\n',app.indexOf('function renderSupport(')));
test('actual receipt/support renderers reject executable and ambiguous navigation without losing owned records',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.route('https://finance-navigation.test/',route=>route.fulfill({contentType:'text/html',body:'<div id="recent-receipts"></div><div id="support-links"></div>'}));
    await page.goto('https://finance-navigation.test/');
    await page.addScriptTag({content:`const $=s=>document.querySelector(s),financeText=k=>k,fmt=v=>String(v),date=v=>v,short=v=>v;const esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');${receipts}\n${support}\nwindow.renderQA=value=>{renderReceipts([{id:'owned-record',amountYnxt:7,createdAt:'2026-10-03T00:00:00Z',disputeUrl:value}],{available:true});renderSupport({helpUrl:value,privacyUrl:value,disputeUrl:value})};`});
    for(const value of ['javascript:window.compromised=true','data:text/html,unsafe','http://unsafe.test/','//unsafe.test/','/\\unsafe.test/','https://user:pass@example.test/',' https://example.test/','https://example.test/\n','mailto:person@example.test',null,{},'https://']){
      await page.evaluate(v=>renderQA(v),value);assert.equal(await page.locator('a').count(),0,JSON.stringify(value));
      assert.match(await page.locator('#recent-receipts').textContent(),/owned-record/);
      assert.equal(await page.locator('#support-links .support-card').count(),3);
      assert.equal(await page.evaluate(()=>window.compromised),undefined);
    }
    for(const [value,expected] of [['/help?record=one#details','https://finance-navigation.test/help?record=one#details'],['https://support.ynxweb4.com/disputes?record=one&kind=test','https://support.ynxweb4.com/disputes?record=one&kind=test']]){
      await page.evaluate(v=>renderQA(v),value);assert.equal(await page.locator('a').count(),4);
      for(const link of await page.locator('a').all())assert.equal(await link.getAttribute('href'),expected);
    }
    assert.equal(page.url(),'https://finance-navigation.test/');assert.equal(browser.contexts()[0].pages().length,1);
  }finally{await browser.close()}
});

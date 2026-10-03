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
test('actual receipt/support renderers isolate malformed sources and preserve valid neighboring records',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();
    await page.goto('about:blank');
    await page.setContent('<div id="recent-receipts"></div><div id="support-links"></div>');
    await page.addScriptTag({content:`const $=s=>document.querySelector(s),financeText=k=>k,date=v=>v,short=v=>v;const esc=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');${app.slice(app.indexOf('const fmt='),app.indexOf('\n',app.indexOf('const fmt=')))}\n${receipts}\n${support}\nwindow.renderSourceQA=(items,status,s)=>{renderReceipts(items,status);renderSupport(s)};`});
    for(const status of [null,undefined,{},[],{available:'true'},{available:1}]){
      await page.evaluate(s=>renderSourceQA([],s,null),status);
      assert.match(await page.locator('#recent-receipts').textContent(),/unavailable/);
      assert.equal(await page.locator('#support-links .support-card').count(),3);
    }
    for(const items of [null,{},'bad']){
      await page.evaluate(i=>renderSourceQA(i,{available:true},null),items);
      assert.match(await page.locator('#recent-receipts').textContent(),/unavailable/);
      assert.doesNotMatch(await page.locator('#recent-receipts').textContent(),/noOwnedPayReceipts/);
    }
    await page.evaluate(()=>renderSourceQA([null,{},[],{id:'valid-zero',amountYnxt:0},{id:'valid-unknown',amountYnxt:null}],{available:true},{}));
    const text=await page.locator('#recent-receipts').textContent();
    assert.match(text,/valid-zero/);assert.match(text,/0 YNXT/);assert.match(text,/valid-unknown/);assert.match(text,/unknown YNXT/);
    assert.equal(await page.locator('#recent-receipts .empty').count(),3);
    for(const amount of [null,-1,'7',Number.MAX_SAFE_INTEGER+1]){
      await page.evaluate(v=>renderSourceQA([{id:'typed-record',amountYnxt:v,status:{paid:true},transactionHash:{hash:'bad'},createdAt:{date:'bad'}}],{available:true},['bad']),amount);
      const row=await page.locator('#recent-receipts').textContent();
      assert.match(row,/typed-record/);assert.match(row,/payRecord/);assert.match(row,/unknown YNXT/);assert.doesNotMatch(row,/\[object Object\]/);
      assert.equal(await page.locator('#support-links .support-card').count(),3);
    }
    await page.evaluate(()=>renderSourceQA([],{available:true},null));
    assert.match(await page.locator('#recent-receipts').textContent(),/noOwnedPayReceipts/);
    assert.equal(await page.locator('a').count(),0);
  }finally{await browser.close()}
});

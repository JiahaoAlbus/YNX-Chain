import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const web=new URL('../web/',import.meta.url);
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('exact-origin Exchange chooser opens Hosted Wallet without account, private authority or blank tab',async()=>{
  let browser;
  try{
    const executablePath=process.platform==='darwin'?chrome:undefined;
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
    const context=await browser.newContext();
    await context.route('https://exchange.ynxweb4.com/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"code":"LOCAL_SOURCE_FIXTURE_UNAVAILABLE"}'});
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!/^[a-z0-9.-]+$/u.test(name))return route.fulfill({status:404,body:''});
      try{
        const body=await readFile(new URL(name,web));
        const contentType=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html';
        return route.fulfill({status:200,body,contentType});
      }catch{return route.fulfill({status:404,body:''});}
    });
    await context.route('https://wallet.ynxweb4.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Hosted Wallet source fixture</title>'}));
    const page=await context.newPage();
    await page.goto('https://exchange.ynxweb4.com/',{waitUntil:'domcontentloaded'});
    await page.locator('#connect').click();
    assert.equal(await page.locator('#wallet-dialog').evaluate(dialog=>dialog.open),true);
    for(const id of ['#connect-ynx-wallet','#connect-hosted-ynx','#connect-metamask'])assert.equal(await page.locator(id).isVisible(),true);
    const pending=context.waitForEvent('page');
    await page.locator('#connect-hosted-ynx').click();
    const popup=await pending;
    await popup.waitForURL(/^https:\/\/wallet\.ynxweb4\.com\/hosted\/#connect=/u);
    assert.equal(await page.url(),'https://exchange.ynxweb4.com/');
    assert.equal(await page.locator('#wallet-dialog').evaluate(dialog=>dialog.open),true);
    assert.equal(await page.locator('#wallet-account').textContent(),'—');
    assert.equal(await page.locator('#wallet-details').isVisible(),false);
    await popup.close();
    await page.getByText('Hosted Wallet approval did not complete.',{exact:false}).waitFor({timeout:5000});
    assert.equal(await page.locator('#wallet-fallback a',{hasText:'Download YNX Wallet'}).count(),1);
    assert.equal(await page.locator('#wallet-fallback a',{hasText:'Use MetaMask'}).count(),1);
    assert.equal(context.pages().length,1);
    await context.close();
  }finally{await browser?.close();}
});

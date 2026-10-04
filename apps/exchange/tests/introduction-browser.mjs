import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
const browser=await chromium.launch(await financeBrowserLaunchOptions());
const evidence=await mkdtemp(path.join(tmpdir(),'ynx-exchange-introduction-')),results=[];
try{for(const width of [320,390,1440]){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),requests=[],errors=[];
 page.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!=='https://exchange.example'||url.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'});
  let name=url.pathname.slice(1);if(!name)name=url.search?'index.html':'introduction.html';if(['app','wallet-auth/callback','wallet-action/callback'].includes(name))name='index.html';
  if(!/^[a-z0-9.-]+$/u.test(name))return route.abort();
  try{return route.fulfill({body:await readFile(new URL('../web/'+name,import.meta.url)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html'})}catch{return route.fulfill({status:404,body:'not found'})}
 });
 for(const language of ['en','zh-Hans']){
  requests.length=0;
  await page.goto('https://exchange.example/');await page.selectOption('#introduction-language',language);
  await page.locator('figure img').evaluate(i=>i.decode());
  assert.equal(await page.locator('html').getAttribute('lang'),language);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  assert.ok(!requests.some(r=>/wallet-connect\.js|private-session\.js|\/api\//.test(r.url)),'introduction must not load application SDK/API');
  await page.screenshot({path:path.join(evidence,`intro-${width}-${language}.png`),fullPage:true});
  await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement!==document.body));
  await page.locator('.hero .primary').click();await page.waitForFunction(()=>Boolean(window.YNXExchangeWebWallet&&window.YNXExchangeLocale));
  assert.equal(page.url(),'https://exchange.example/app#market');assert.equal(await page.locator('#exchange-language').inputValue(),language);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'application overflow');
  await page.reload();await page.waitForFunction(()=>Boolean(window.YNXExchangeWebWallet));assert.equal(page.url(),'https://exchange.example/app#market');
  await page.locator('a[aria-label="Exchange introduction"]').click();await page.waitForSelector('#introduction-language');assert.equal(await page.locator('#introduction-language').inputValue(),language);
  requests.length=0;await page.reload();await page.waitForSelector('#introduction-language');assert.ok(!requests.some(r=>/wallet-connect\.js|private-session\.js|\/api\//.test(r.url)));
 }
 await page.goto('https://exchange.example/#assets');await page.waitForFunction(()=>Boolean(window.YNXExchangeWebWallet));assert.equal(page.url(),'https://exchange.example/app#assets');await page.locator('#assets').waitFor({state:'visible'});
 await page.goto('https://exchange.example/?requestId=preserved#assets');await page.waitForFunction(()=>Boolean(window.YNXExchangeWebWallet));assert.equal(page.url(),'https://exchange.example/?requestId=preserved#assets');
 await page.evaluate(()=>localStorage.setItem('ynx-exchange-language','ja'));await page.goto('https://exchange.example/');await page.waitForSelector('#introduction-language');assert.equal(await page.evaluate(()=>localStorage.getItem('ynx-exchange-language')),'ja');
 await page.locator('.hero .primary').click();await page.waitForFunction(()=>Boolean(window.YNXExchangeWebWallet&&window.YNXExchangeLocale));assert.equal(await page.locator('#exchange-language').inputValue(),'ja');
 assert.equal(context.pages().length,1);assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method!=='GET').length,0);
 results.push({width,languages:['en','zh-Hans'],sdkAbsentOnIntroduction:true,ctaAppReturnReload:true,legacyHash:true,queryReturn:true,overflow:false,errors,nonGetRequests:0});await context.close();
}}finally{await browser.close()}
console.log(JSON.stringify({evidence,results,publicProof:false,walletApproval:false},null,2));

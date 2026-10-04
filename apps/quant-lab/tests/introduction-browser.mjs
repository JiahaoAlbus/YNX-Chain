import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
const browser=await chromium.launch(await financeBrowserLaunchOptions()),evidence=await mkdtemp(path.join(tmpdir(),'ynx-quant-introduction-'));
const capture=process.argv.includes('--capture-workspace');
try{for(const width of capture?[1440]:[320,390,1440]){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),requests=[],errors=[];
 page.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!=='https://quant.example'||url.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'});
  let name=url.pathname.slice(1);if(!name)name=url.search?'index.html':'introduction.html';if(['app','wallet-auth/callback','wallet-action/callback'].includes(name))name='index.html';
  if(!/^[a-z0-9.-]+$/u.test(name))return route.abort();
  try{return route.fulfill({body:await readFile(new URL('../web/'+name,import.meta.url)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html'})}catch{return route.fulfill({status:404,body:'not found'})}
 });
 if(capture){await page.goto('https://quant.example/app#research');await page.waitForFunction(()=>typeof quantHTTP==='function');await page.screenshot({path:new URL('../web/quant-workspace-preview.png',import.meta.url).pathname});}
 else{
  for(const language of ['en','zh-CN']){
   requests.length=0;await page.goto('https://quant.example/');await page.selectOption('#introduction-language',language);await page.locator('figure img').evaluate(i=>i.decode());
   assert.equal(await page.locator('html').getAttribute('lang'),language);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.ok(!requests.some(r=>/wallet-auth\.js|\/api\//u.test(r.url)));await page.screenshot({path:path.join(evidence,`intro-${width}-${language}.png`),fullPage:true});
   await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
   await page.locator('.hero .primary').click();await page.waitForFunction(()=>typeof quantHTTP==='function');assert.equal(page.url(),'https://quant.example/app#research');assert.equal(await page.locator('#locale').inputValue(),language);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'existing research workspace overflow');
   await page.locator('nav button[data-view="paper"]').click();await page.locator('#paper.active').waitFor();
   await page.locator('a[aria-label="Quant introduction"]').click();await page.waitForSelector('#introduction-language');await page.reload();assert.equal(await page.locator('#introduction-language').inputValue(),language);
  }
  await page.goto('https://quant.example/#paper');await page.waitForSelector('#paper.active');assert.equal(page.url(),'https://quant.example/app#paper');await page.reload();await page.waitForSelector('#paper.active');
  await page.goto('https://quant.example/?state=preserved#research');assert.equal(page.url(),'https://quant.example/?state=preserved#research');
  await page.evaluate(()=>localStorage.setItem('ynx.quant.locale','ja'));await page.goto('https://quant.example/');await page.waitForSelector('#introduction-language');assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.locale')),'ja');
  assert.equal(context.pages().length,1);assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method!=='GET').length,0);
 }
 await context.close();
}}finally{await browser.close()}
console.log(JSON.stringify({evidence,capture,publicProof:false,walletApproval:false}));

import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';
const browser=await chromium.launch(await financeBrowserLaunchOptions());
const evidence=await mkdtemp(path.join(tmpdir(),'ynx-finance-introduction-'));
const capture=process.argv.includes('--capture-workspace');
try {
 for(const width of capture?[1440]:[320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),requests=[],errors=[];
  page.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='https://finance.example'||url.pathname.startsWith('/api/')||url.pathname.startsWith('/sso/'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'});
   let name=url.pathname.slice(1);if(!name)name=url.search?'index.html':'introduction.html';if(['app','index.html','auth/callback','wallet-auth/callback'].includes(name))name='index.html';
   if(!/^(?:vendor\/)?[a-zA-Z0-9.-]+$/u.test(name))return route.abort();
   try{return route.fulfill({body:await readFile(new URL('../web/'+name,import.meta.url)),contentType:name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html'})}catch{return route.fulfill({status:404,body:'not found'})}
  });
  if(capture) {
   await page.goto('https://finance.example/app#markets');await page.waitForSelector('#markets.active-view');
   await page.screenshot({path:new URL('../web/finance-workspace-preview.png',import.meta.url).pathname,fullPage:false});
  } else {
   for(const language of ['en','zh-CN']) {
    requests.length=0;await page.goto('https://finance.example/');await page.selectOption('#introduction-language',language);
    await page.locator('figure img').evaluate(i=>i.decode());
    assert.equal(await page.locator('html').getAttribute('lang'),language);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(requests.some(r=>/wallet-auth\.js|\/vendor\/|\/api\/|\/sso\//u.test(r.url)),false,'intro must not load SDK/API');
    await page.screenshot({path:path.join(evidence,`intro-${width}-${language}.png`),fullPage:true});
    await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
    await page.locator('.hero .primary').click();await page.waitForSelector('#markets.active-view');assert.equal(page.url(),'https://finance.example/app#markets');
    assert.equal(await page.locator('#finance-language').inputValue(),language);
    await page.reload();await page.waitForSelector('#markets.active-view');
    await page.locator('a[aria-label="Finance introduction"]').click();await page.waitForSelector('#introduction-language');
    assert.equal(await page.locator('#introduction-language').inputValue(),language);
   }
   await page.goto('https://finance.example/#assets');await page.waitForSelector('#guest-gate.active-view');assert.equal(page.url(),'https://finance.example/app#assets');
   await page.goto('https://finance.example/?state=preserved#assets');assert.equal(page.url(),'https://finance.example/?state=preserved#assets');
   await page.evaluate(()=>localStorage.setItem('ynx-finance-locale','ja'));await page.goto('https://finance.example/');await page.waitForSelector('#introduction-language');assert.equal(await page.evaluate(()=>localStorage.getItem('ynx-finance-locale')),'ja');
   assert.equal(context.pages().length,1);assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method!=='GET').length,0);
  }
  await context.close();
 }
}finally{await browser.close()}
console.log(JSON.stringify({evidence,capture,publicProof:false,walletApproval:false}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {QUANT_RUNTIME_WEB_ASSETS} from '../scripts/verify-versioned-assets.mjs';
test('actual complete Quant renderer enforces identity byte framing in real Chrome without write replay',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.method()));
    await page.route('https://quant.example/**',async route=>{
      const name=new URL(route.request().url()).pathname.slice(1)||'index.html';
      if(name.startsWith('api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'});
      if(!QUANT_RUNTIME_WEB_ASSETS.includes(name))return route.abort();
      return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:await readFile(new URL('../web/'+name,import.meta.url))});
    });
    await page.goto('https://quant.example/');await page.waitForFunction(()=>typeof quantHTTP==='function');
    await page.locator('.product-logo').evaluate(image=>image.decode());
    const result=await page.evaluate(async()=>{
      let calls=0,cancels=0;const codes=[];
      for(const length of ['0','1','3','99']){
        const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{}'));c.close()},cancel(){cancels++}});
        try{await quantHTTP('/v1/backtests/from-market',{method:'POST',body:'controlled-unsubmitted-draft'},{fetchImpl:async()=>{calls++;return new Response(stream,{headers:{'content-type':'application/json','content-length':length}})}});codes.push('accepted')}catch(e){codes.push(e.code)}
      }
      const compressed=await quantHTTP('/v1/snapshot',{}, {fetchImpl:async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'1','content-encoding':'gzip'}})});
      return {calls,codes,compressed:compressed.body,workspaceReadUnavailable,pendingResearchIntent,lang:document.documentElement.lang};
    });
    assert.equal(result.calls,4);assert.deepEqual(result.codes,Array(4).fill('QUANT_API_RESPONSE_INVALID'));assert.deepEqual(result.compressed,{});
    assert.equal(result.pendingResearchIntent,null);assert.equal(result.lang,'en');assert.equal(requests.filter(m=>m!=='GET').length,0);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
    await context.close();
  }}finally{await browser.close()}
});

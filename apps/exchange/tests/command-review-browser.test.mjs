import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {commandLocales,commandText} from '../web/command-copy.js';
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const functions=app.slice(app.indexOf('function closeCommandReview('),app.indexOf('function renderAIState('));
const errorFactory=app.slice(app.indexOf('function productApiUnavailable('),app.indexOf('function showWalletFallback('));
test('actual review forms preserve drafts, refuse write authority and do not send or sign in mobile/desktop',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    for(const width of [390,1280]){
      const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),requests=[],errors=[];
      page.on('request',r=>requests.push(r));page.on('pageerror',e=>errors.push(e.message));
      await page.route('https://exchange.example/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(path==='/')return route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
        const name=path.slice(1);if(!['command-review.js','command-copy.js','order-preview.js','market-data.js'].includes(name))return route.abort();
        return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../web/'+name,import.meta.url),'utf8')});
      });
      await page.goto('https://exchange.example/');
      await page.addScriptTag({type:'module',content:`import {buildCommandReview} from '/command-review.js';import {commandText} from '/command-copy.js';const $=s=>document.querySelector(s);const state={account:'owned',config:null};const display=v=>String(v);function toast(v){$('#toast').textContent=v} ${errorFactory}\n${functions}\nwindow.commandQA={review:reviewCommand,check:checkCommandRequirements,close:closeCommandReview,copy:renderCommandCopy,owner:v=>state.account=v};$('#command-review-check').onclick=checkCommandRequirements;`});
      await page.waitForFunction(()=>!!window.commandQA);
      await page.evaluate(()=>document.querySelector('#support-message').value='Unsubmitted support draft');
      for(const locale of commandLocales){
        await page.evaluate(locale=>{document.documentElement.lang=locale;commandQA.copy();commandQA.review('support',{category:'order',message:'This is a review, not a case.'})},locale);
        assert.equal(await page.locator('#command-review-title').textContent(),commandText(locale,'title'));
        assert.equal(await page.locator('#command-review-dialog').evaluate(d=>d.open),true);
        await page.locator('#command-review-check').click();assert.match(await page.locator('#command-review-state').textContent(),/API_UNAVAILABLE/);
        await page.evaluate(()=>commandQA.close());assert.equal(await page.locator('#support-message').inputValue(),'Unsubmitted support draft');
      }
      await page.evaluate(()=>{commandQA.review('security',{withdrawalLock:true,orderConfirmation:true,sessionTtlMinutes:60});commandQA.owner('other');commandQA.check()});
      assert.equal(await page.locator('#command-review-dialog').evaluate(d=>d.open),false);
      await page.evaluate(()=>commandQA.review('support',{category:'order',message:'short'}));
      assert.equal(await page.locator('#toast').textContent(),commandText('id','invalid'));
      assert.equal(requests.filter(r=>r.method()!=='GET').length,0);assert.equal(context.pages().length,1);assert.deepEqual(errors,[]);
      await context.close();
    }
  }finally{await browser.close()}
});

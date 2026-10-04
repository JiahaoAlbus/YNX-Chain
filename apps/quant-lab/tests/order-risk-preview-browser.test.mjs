import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';

test('actual Quant browser requires explicit risk observations and retires preview on edits without Wallet authorization',async()=>{
 const [html,app,i18n]=await Promise.all(['index.html','app.js','i18n.js'].map(name=>readFile(new URL('../web/'+name,import.meta.url),'utf8')));
 const browser=await chromium.launch(await financeBrowserLaunchOptions());
 try{
  const page=await browser.newPage(),errors=[],posts=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
   if(url.pathname==='/api/v1/snapshot')return route.fulfill({json:{access:{statefulPreview:true},paper:{},strategies:{},experiments:{},audit:[]}});
   if(url.pathname==='/api/v1/testnet/signing-payloads/order'){posts.push(request.postDataJSON());return route.fulfill({json:{payload:'Controlled local preview only',digest:'f'.repeat(64)}})}
   return route.abort();
  });
  await page.goto('https://quant-owned-fixture.invalid/');
  await page.addScriptTag({content:`window.riskQAProofCalls=0;window.YNXQuantWallet={getStandardWalletState:()=>({status:'disconnected'}),requireProof:async()=>{riskQAProofCalls++;throw Error('Controlled private service unavailable')}};`});
  await page.addScriptTag({content:i18n});await page.addScriptTag({content:app});
  await page.locator('nav button[data-view="testnet"]').click();
  assert.equal(await page.locator('#risk-oracle-time').inputValue(),'');assert.equal(await page.locator('#risk-venue').inputValue(),'');
  await page.locator('#preview-order').click();assert.equal(posts.length,0);assert.equal(await page.locator('#order-payload').isHidden(),true);
  const time=new Date(Date.now()-1000).toISOString();await page.locator('#risk-oracle-time').fill(time);await page.locator('#risk-venue').selectOption('healthy');
  for(const [id,value] of Object.entries({reference:'1000000',gas:'100',loss:'0',equity:'10000000',exposure:'1000000',peak:'10000000',current:'9900000',liquidity:'10000000',depeg:'5',concentration:'2000',orders:'10',cancels:'1','api-failures':'0',var:'100000',es:'150000'})){assert.equal(await page.locator('#risk-'+id).inputValue(),'');await page.locator('#risk-'+id).fill(value)}
  await page.locator('#preview-order').click();await page.locator('#order-payload').waitFor({state:'visible'});assert.equal(posts.length,1);
  assert.ok((await page.locator('#order-payload').textContent()).includes(time));assert.match(await page.locator('#order-payload').textContent(),/operator|Operator/);
  await page.locator('#risk-gas').fill('101');assert.equal(await page.locator('#order-payload').isHidden(),true);
  await page.locator('#risk-oracle-time').fill(new Date(Date.now()-60000).toISOString());await page.locator('#preview-order').click();assert.equal(posts.length,1);
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
   await page.locator('#locale').selectOption(language);
   assert.equal(await page.locator('[data-business-i18n="riskOperatorObservation"]').textContent(),await page.evaluate(()=>businessCopy[locale].riskOperatorObservation));
  }
  assert.equal(await page.evaluate(()=>riskQAProofCalls),0);assert.deepEqual(errors,[]);assert.equal(page.context().pages().length,1);
 }finally{await browser.close()}
});

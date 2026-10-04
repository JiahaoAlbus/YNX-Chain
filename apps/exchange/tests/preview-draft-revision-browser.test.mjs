import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
const root=new URL('../web/',import.meta.url);
const app=await readFile(new URL('app.js',root),'utf8');
const html=await readFile(new URL('index.html',root),'utf8');
const market=(await readFile(new URL('market-data.js',root),'utf8')).replace(/^export /gm,'').replace(/^\{date as isVenueTimestamp\};$/m,'');
const arithmetic=(await readFile(new URL('order-preview.js',root),'utf8')).replace(/^import .*;\n/m,'const isVenueTimestamp=date;\n').replace(/^export /gm,'');
const line=name=>app.split('\n').find(value=>value.startsWith(`function ${name}(`))??'';
const rules={schemaVersion:'exchange-limit-rules-v2',market:'YNXT-YUSD_TEST',orderTypes:['limit'],scale:'1000000',minPriceMicro:'1',maxPriceMicro:'1000000000000',minAmountMicro:'1',maxAmountMicro:'1000000000000',maxOrderNotionalMicro:'100000000000',makerFeeBps:17,takerFeeBps:43,notionalRounding:'floor_micro',feeRounding:'ceil_micro_per_fill',quoteAssetType:'venue_only_test_credit_not_token',admissionMinimumQuote:'one_micro_credit',reservationShortfall:'atomic_order_request_rejection'};
const review=app.slice(app.indexOf('async function reviewOrder('),app.indexOf('function cancelOrder('));
const binding=app.split('\n').find(value=>value.includes("$('#price').addEventListener('input'"));

test('edit/revert and navigation retire an in-flight exact draft review without losing input or requesting authority',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage(),errors=[];let requests=0;
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({content:`${market}\n${arithmetic}\nconst $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];const state={account:null,privatePhase:'guest',side:'buy',rules:${JSON.stringify(rules)},marketPhase:'live'};const display=v=>formatMicro(v,'en');function estimate(){}function withdrawEstimate(){}function toast(){}let finish;const marketFeed={retry:()=>new Promise(resolve=>{finish=()=>{state.source={asOf:new Date().toISOString(),authority:'YNX-owned deterministic order state',classification:'testnet',status:'degraded_single_host'};resolve()}})};${line('retireMarketPreview')}\n${line('invalidateOrderDraftReview')}\n${line('showView')}\n${line('setSide')}\n${line('preview')}\n${review}\n${binding}\nwindow.startDraftReview=()=>{window.pendingReview=reviewOrder({preventDefault(){}})};window.finishDraftReview=()=>finish();`});
    await page.fill('#price','2');await page.fill('#amount','3');
    for(const kind of ['price','amount','side','view']){
      await page.evaluate(()=>startDraftReview());
      if(kind==='price'||kind==='amount'){
        const before=await page.locator('#'+kind).inputValue();
        await page.fill('#'+kind,'8');await page.fill('#'+kind,before);
      }else if(kind==='side')await page.evaluate(()=>{setSide('sell');setSide('buy')});
      else await page.evaluate(()=>{showView('assets');showView('market')});
      await page.evaluate(()=>{finishDraftReview();return pendingReview});
      assert.equal(await page.locator('#order-preview-dialog').evaluate(dialog=>dialog.open),false,kind+' must require a fresh explicit review even after returning to equal values');
      assert.equal(await page.locator('#order-preview-values').textContent(),'');
      assert.equal(await page.locator('#review-order').isEnabled(),true);
      assert.equal(await page.locator('#price').inputValue(),'2');assert.equal(await page.locator('#amount').inputValue(),'3');
    }
    await page.evaluate(()=>{startDraftReview();finishDraftReview();return pendingReview});
    assert.equal(await page.locator('#order-preview-dialog').evaluate(dialog=>dialog.open),true,'unchanged new explicit review still works');
    // An input event from another app action must also retire an open old review.
    await page.evaluate(()=>document.querySelector('#amount').dispatchEvent(new Event('input',{bubbles:true})));
    assert.equal(await page.locator('#order-preview-dialog').evaluate(dialog=>dialog.open),false);
    assert.equal(await page.locator('#order-preview-values').textContent(),'');
    assert.deepEqual(errors,[]);assert.equal(requests,0);assert.equal(page.context().pages().length,1);
  }finally{await browser.close()}
});

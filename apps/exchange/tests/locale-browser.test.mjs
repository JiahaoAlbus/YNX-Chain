import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {catalogs,locales,errorCodes,normalizeLocale,translate} from '../web/locale.js';
import {formatMicro} from '../web/market-data.js';

const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../web/styles.css',import.meta.url),'utf8');
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const localeSource=await readFile(new URL('../web/locale.js',import.meta.url),'utf8');
const privateRender=app.slice(app.indexOf('function renderPrivateAccount('),app.indexOf('function renderBook('));
const marketRender=app.slice(app.indexOf('function renderMarketStatus('),app.indexOf('async function refreshBook('));
const estimate=app.slice(app.indexOf('function preview()'),app.indexOf('function withdrawEstimate()'));
const toast=app.slice(app.indexOf('function toast('),app.indexOf('function showWalletFallback('));
const previewSource=await readFile(new URL('../web/order-preview.js',import.meta.url),'utf8');

test('every supported locale has all connected/degraded/recovery messages without silent English fallback',()=>{
  assert.equal(locales.length,12);
  const keys=Object.keys(catalogs.en);
  for(const locale of locales){
    assert.deepEqual(Object.keys(catalogs[locale]),keys);
    for(const key of keys){assert.ok(catalogs[locale][key]?.trim(),`${locale}/${key}`);assert.equal(translate(locale,key),catalogs[locale][key]);}
    if(locale!=='en')for(const key of ['guest','connected','degraded','authorization-required','market-offline'])assert.notEqual(catalogs[locale][key],catalogs.en[key]);
    for(const code of errorCodes)assert.ok(catalogs[locale][code],`${locale}/${code}`);
  }
  for(const value of [null,undefined,'fr-unknown','../../account','<script>'])assert.equal(normalizeLocale(value),'en');
});

test('actual preview errors retain exact codes in every locale, clear on correction, and cannot resurrect an obsolete toast',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;
    await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${previewSource}\nwindow.previewTest={buildOrderPreview,validateTradingRules};`});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});
    await page.waitForFunction(()=>window.previewTest&&window.localeTest);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const {buildOrderPreview,validateTradingRules}=window.previewTest;const state={side:'buy',marketPhase:'live',source:null,rules:null};const display=${formatMicro.toString()};${estimate}\n${toast}\nwindow.errorTest={set(value){Object.assign(state,value);estimate()},toast,permission:()=>toast(productApiUnavailable())};window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document,onChange:()=>estimate()});`});
    const rules={schemaVersion:'exchange-limit-rules-v2',market:'YNXT-YUSD_TEST',orderTypes:['limit'],scale:'1000000',minPriceMicro:'1',maxPriceMicro:'1000000000000',minAmountMicro:'1',maxAmountMicro:'1000000000000',maxOrderNotionalMicro:'100000000000',makerFeeBps:17,takerFeeBps:43,notionalRounding:'floor_micro',feeRounding:'ceil_micro_per_fill',quoteAssetType:'venue_only_test_credit_not_token',admissionMinimumQuote:'one_micro_credit',reservationShortfall:'atomic_order_request_rejection'};
    const source={asOf:new Date().toISOString(),authority:'YNX-owned deterministic order state',classification:'testnet',status:'degraded_single_host'};
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      await page.locator('#price').fill('0');await page.locator('#amount').fill('3');
      await page.evaluate(value=>window.errorTest.set(value),{rules,source,marketPhase:'live',side:'buy'});
      assert.equal(await page.locator('#order-error').innerText(),catalogs[locale].PRICE_LIMIT+' (PRICE_LIMIT)');
      await page.locator('#price').fill('2');await page.evaluate(()=>window.errorTest.set({marketPhase:'offline'}));
      assert.equal(await page.locator('#order-error').innerText(),catalogs[locale].RULES_STALE+' (RULES_STALE)');
      await page.evaluate(()=>window.errorTest.permission());
      assert.equal(await page.locator('#toast').innerText(),catalogs[locale].API_UNAVAILABLE+' (API_UNAVAILABLE)');
      await page.evaluate(()=>window.errorTest.set({marketPhase:'live'}));assert.equal(await page.locator('#order-error').innerText(),'');
    }
    // Correction then language change must not restore an obsolete error.
    await page.locator('#exchange-language').selectOption('ar');assert.equal(await page.locator('#order-error').innerText(),'');
    await page.evaluate(()=>window.errorTest.toast('isolated-newer-status'));await page.locator('#exchange-language').selectOption('ja');
    assert.equal(await page.locator('#toast').innerText(),'isolated-newer-status');
    const rejected=await page.evaluate(()=>window.YNXExchangeLocale.error(document.querySelector('#toast'),{code:'UNKNOWN_REMOTE_CODE',message:'not translated'}));
    assert.equal(rejected,false,'unknown backend errors must not be relabelled as a known failure');
    assert.equal(requests,0,'preview validation and locale changes never request accounts or submit orders');
  }finally{await browser.close()}
});

test('actual locale module and renderers update late account/market states in 12 languages without identity or network effects',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;
    await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});await page.waitForFunction(()=>!!window.localeTest);
    await page.evaluate(()=>{
      const prefs=new Map();window.localeCalls=[];
      window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document,storage:{getItem:key=>prefs.get(key),setItem:(key,value)=>{window.localeCalls.push([key,value]);prefs.set(key,value)}}});
      window.localePrefs=prefs;
    });
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:null,standardWallet:{status:'standard-connected',account:'isolated-standard-account'}};const renderAccount=()=>{};const resumeDeferredBrowserIdentity=()=>{};${privateRender}\n${marketRender}\nwindow.stateTest=state;window.privateRender=renderPrivateAccount;window.marketRender=renderMarketStatus;`});
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    const before=requests;
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      assert.equal(await page.locator('html').getAttribute('lang'),locale);
      assert.equal(await page.locator('html').getAttribute('dir'),locale==='ar'?'rtl':'ltr');
      assert.equal(await page.locator('[data-view="assets"]').innerText(),catalogs[locale].assets);
      for(const phase of ['guest','loading','connected','degraded','authorization-required','closed','approval-pending']){
        await page.evaluate(phase=>window.privateRender({phase,account:null,snapshot:null,code:'PRIVATE_API_UNAVAILABLE'}),phase);
        assert.equal(await page.locator('#private-status').innerText(),catalogs[locale][phase]+' (PRIVATE_API_UNAVAILABLE)');
      }
      await page.evaluate(()=>window.privateRender({phase:'approval-pending',installation:'selected-provider',account:null,snapshot:null}));
      assert.equal(await page.locator('#private-status').innerText(),catalogs[locale]['selected-pending']);
      await page.evaluate(()=>window.marketRender({phase:'offline',source:null}));
      assert.equal(await page.locator('#market-connection').innerText(),catalogs[locale]['market-offline']);
      assert.equal(await page.evaluate(()=>window.stateTest.standardWallet.account),'isolated-standard-account');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,locale);
    }
    // Change language after the existing error: preserve exact code and status,
    // do not need a new API read to make the current message change language.
    await page.evaluate(()=>window.privateRender({phase:'degraded',snapshot:null,account:null,code:'PRIVATE_API_UNAVAILABLE'}));
    await page.locator('#exchange-language').selectOption('ar');
    assert.equal(await page.locator('#private-status').innerText(),catalogs.ar.degraded+' (PRIVATE_API_UNAVAILABLE)');
    assert.equal(await page.evaluate(()=>window.stateTest.privatePhase),'degraded');
    assert.equal(await page.evaluate(()=>window.localePrefs.get('ynx-exchange-language')),'ar');
    assert.ok((await page.locator('#exchange-language').boundingBox()).height>=44);
    assert.equal(requests,before,'language/status rendering cannot create API or Wallet traffic');
    assert.ok((await page.evaluate(()=>window.localeCalls)).every(([key,value])=>key==='ynx-exchange-language'&&locales.includes(value)));
    await page.evaluate(()=>{window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document,storage:{getItem:key=>window.localePrefs.get(key)}})});
    assert.equal(await page.locator('html').getAttribute('lang'),'ar','second initialization restores only the language preference');
    await page.evaluate(()=>{window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document,storage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}});window.YNXExchangeLocale.set('ja')});
    assert.equal(await page.locator('html').getAttribute('lang'),'ja','blocked storage must not block language selection');
  }finally{await browser.close()}
});

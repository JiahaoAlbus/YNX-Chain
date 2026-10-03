import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {catalogs,locales,errorCodes,activityKeys,riskKeys,normalizeLocale,translate} from '../web/locale.js';
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
const activityRender=app.slice(app.indexOf('function renderActivity()'),app.indexOf('function renderPublicMarket()'));
const activityBinding=app.split('\n').find(line=>line.includes("$$('.tabs button').forEach(b=>b.addEventListener"));
const review=app.slice(app.indexOf('async function reviewOrder('),app.indexOf('function cancelOrder('));
const walletRender=app.slice(app.indexOf('function renderStandardWallet('),app.indexOf('function disconnectWallet('));
const walletChooser=app.slice(app.indexOf('function openWalletChooser('),app.indexOf('async function restoreStandardWallet('));
const walletConnect=app.slice(app.indexOf('async function connectWallet('),app.indexOf('function showView('));
const identitySource=app.slice(app.indexOf('let browserIdentity='),app.indexOf('\nconst marketFeed='));
const revokeSource=app.slice(app.indexOf('async function revokeWalletPermission('),app.indexOf('function openWalletChooser('));
const privateRevokeBinding=app.split('\n').find(line=>line.includes("$('#private-disconnect').addEventListener"));

test('actual revoke confirmations use the selected locale and cancellation invokes neither private nor standard revocation',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});await page.waitForFunction(()=>window.localeTest);
    assert.ok(privateRevokeBinding,'execute the actual private confirmation listener');
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);let decision=false,privateCalls=0,walletCalls=0;const confirmations=[];window.confirm=text=>{confirmations.push(text);return decision};const toast=()=>{};const privateAccount={disconnect:()=>{privateCalls++}};window.YNXExchangeWebWallet={revoke:async()=>{walletCalls++;return {permissionRevoked:false,status:'unsupported'}}};${revokeSource}\n${privateRevokeBinding}\nwindow.revokeLocaleQA={revoke:revokeWalletPermission,confirmations,counts:()=>({privateCalls,walletCalls}),approve:()=>decision=true};window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document});`});
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);await page.locator('#private-disconnect').click();await page.evaluate(()=>window.revokeLocaleQA.revoke());
      const prompts=await page.evaluate(()=>window.revokeLocaleQA.confirmations.slice(-2));assert.deepEqual(prompts,[catalogs[locale]['confirm-private-revoke'],catalogs[locale]['confirm-wallet-revoke']]);
      assert.deepEqual(await page.evaluate(()=>window.revokeLocaleQA.counts()),{privateCalls:0,walletCalls:0});
    }
    await page.evaluate(()=>window.revokeLocaleQA.approve());await page.locator('#private-disconnect').click();await page.evaluate(()=>window.revokeLocaleQA.revoke());
    assert.deepEqual(await page.evaluate(()=>window.revokeLocaleQA.counts()),{privateCalls:1,walletCalls:1},'controlled acceptance retains one call to its respective existing adapter');
    assert.equal(await page.locator('#wallet-revoke').isEnabled(),true);assert.equal(requests,0,'controlled confirmation test is not real Wallet approval or revocation evidence');
  }finally{await browser.close()}
});

test('actual browser identity displays late results in the current locale without expanding permission or retrying on language change',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;
    await page.route('**/*',route=>{requests++;return route.abort()});await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});await page.waitForFunction(()=>window.localeTest);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:null,standardWallet:{status:'standard-connected',account:'standard-A'}};let mode='read',calls=0,cleanupFails=false,pending=null;const privateAccount={state:()=>({phase:'guest'}),guest:async()=>{},disconnect:async()=>{if(cleanupFails)throw new Error('controlled-private-cleanup')}};${identitySource}\nbrowserIdentityRequest=async path=>{calls++;if(path==='config')return {response:{ok:true},data:{enabled:true,silentRestoreAllowed:false}};if(path==='logout')return {response:{ok:mode!=='logout-failed'},data:{revoked:mode!=='logout-failed'}};if(mode==='pending')await new Promise(resolve=>pending=resolve);return mode==='guest'?{response:{ok:false,status:401},data:{}}:mode==='unavailable'?{response:{ok:false,status:503},data:{}}:{response:{ok:true},data:{account:'native-A',scopes:['identity:read'],privateWorkspaceAuthorized:false,csrfToken:'isolated-fixture-only'}}};window.identityLocaleQA={set(value){mode=value},calls:()=>calls,restore:restoreBrowserIdentity,init:initializeBrowserIdentity,cleanupFail(value){cleanupFails=value},pending:()=>!!pending,resume(){mode='read';pending()},identity:()=>browserIdentity,standard:()=>state.standardWallet};window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document});`});
    await page.evaluate(()=>window.identityLocaleQA.init());
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      assert.equal(await page.locator('#browser-identity-start').innerText(),catalogs[locale]['Sign in across YNX products']);assert.equal(await page.locator('#browser-identity-logout').innerText(),catalogs[locale]['Sign out of Exchange']);
      const count=await page.evaluate(()=>window.identityLocaleQA.calls());await page.evaluate(locale=>window.YNXExchangeLocale.set(locale),locale);assert.equal(await page.evaluate(()=>window.identityLocaleQA.calls()),count);
      await page.evaluate(async()=>{window.identityLocaleQA.set('read');await window.identityLocaleQA.restore()});
      assert.equal(await page.locator('#browser-identity-status').innerText(),catalogs[locale]['identity-read']+' (native-A)');
      await page.evaluate(async()=>{window.identityLocaleQA.set('unavailable');await window.identityLocaleQA.restore()});assert.equal(await page.locator('#browser-identity-status').innerText(),catalogs[locale]['identity-unavailable']);
      await page.evaluate(async()=>{window.identityLocaleQA.set('read');await window.identityLocaleQA.restore();window.identityLocaleQA.set('logout-failed')});await page.locator('#browser-identity-logout').click();
      await page.waitForFunction(text=>document.querySelector('#browser-identity-status').textContent===text,catalogs[locale]['identity-signout-unconfirmed']);assert.equal(await page.locator('#browser-identity-logout').isEnabled(),true);
      await page.evaluate(async()=>{window.identityLocaleQA.set('read');await window.identityLocaleQA.restore();window.identityLocaleQA.cleanupFail(true)});await page.locator('#browser-identity-logout').click();
      await page.waitForFunction(text=>document.querySelector('#browser-identity-status').textContent===text,catalogs[locale]['identity-private-cleanup-unconfirmed']);assert.equal(await page.evaluate(()=>window.identityLocaleQA.identity()),null);
      await page.evaluate(async()=>{window.identityLocaleQA.cleanupFail(false);window.identityLocaleQA.set('read');await window.identityLocaleQA.restore()});await page.locator('#browser-identity-logout').click();
      await page.waitForFunction(text=>document.querySelector('#browser-identity-status').textContent===text,catalogs[locale]['identity-signed-out']);
      await page.evaluate(async()=>{window.identityLocaleQA.set('read');await window.identityLocaleQA.restore();window.identityLocaleQA.set('guest');await window.identityLocaleQA.restore()});assert.equal(await page.locator('#browser-identity-status').innerText(),catalogs[locale]['identity-guest']);
    }
    await page.evaluate(()=>{window.identityLocaleQA.set('pending');void window.identityLocaleQA.restore()});await page.waitForFunction(()=>window.identityLocaleQA.pending());
    await page.locator('#exchange-language').selectOption('ar');await page.evaluate(()=>window.identityLocaleQA.resume());
    await page.waitForFunction(text=>document.querySelector('#browser-identity-status').textContent===text,catalogs.ar['identity-read']+' (native-A)');
    assert.deepEqual(await page.evaluate(()=>window.identityLocaleQA.identity().scopes),['identity:read']);assert.equal(await page.evaluate(()=>window.identityLocaleQA.identity().privateWorkspaceAuthorized),false);assert.equal(await page.evaluate(()=>window.identityLocaleQA.standard().account),'standard-A');
    assert.equal(requests,0,'controlled identity fixture never proves or invokes real SSO/Wallet authorization');
  }finally{await browser.close()}
});

test('actual Wallet display keeps selected identity and fallback destinations while late states use the current locale',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;
    await page.route('**/*',route=>{requests++;return route.abort()});await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});await page.waitForFunction(()=>window.localeTest);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={standardWallet:null};let browserIdentityExplicitIntent=false,browserIdentityRestoreDeferred=false,browserIdentityEpoch=0;const toast=()=>{};function showWalletFallback(value){$('#wallet-fallback').hidden=!value}let calls=[];window.YNXExchangeWebWallet={connectYNX:async()=>{calls.push('ynx');return {status:'provider-absent'}},connectMetaMask:async()=>{calls.push('metamask');return {status:'provider-absent'}},connectHosted:async()=>{calls.push('hosted');return {status:'approval-pending'}}};${walletRender}\n${walletChooser}\n${walletConnect}\nwindow.walletLocaleQA={state,calls,renderStandardWallet,renderWalletState,openWalletChooser,connectWallet};window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document});`});
    const account='0x'+'1'.repeat(40);
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      await page.evaluate(()=>window.walletLocaleQA.openWalletChooser());
      assert.equal(await page.locator('#wallet-state').innerText(),catalogs[locale]['wallet-chooser']);
      assert.equal(await page.locator('#wallet-retry').innerText(),catalogs[locale]['Reconnect selected wallet']);
      for(const kind of ['ynx','metamask','hosted']){
        await page.evaluate(kind=>window.walletLocaleQA.connectWallet(kind),kind);
        assert.equal(await page.locator('#wallet-fallback').isVisible(),true);
        assert.ok((await page.locator('#wallet-state').innerText()).startsWith(catalogs[locale]['wallet-unavailable']));
        assert.equal(await page.locator('#wallet-fallback a').first().getAttribute('href'),'https://www.ynxweb4.com/dapp/download');
        assert.equal(await page.locator('#wallet-fallback a').last().getAttribute('href'),'https://metamask.io/download/');
      }
      await page.evaluate(value=>window.walletLocaleQA.renderStandardWallet(value),{status:'standard-connected',providerKind:'metamask',account,chainId:'0x1917'});
      assert.equal(await page.locator('#wallet-dialog').evaluate(e=>e.open),false);assert.equal(await page.locator('#connect').evaluate(e=>e===document.activeElement),true);
      assert.equal(await page.locator('#connect').innerText(),catalogs[locale]['Wallet details']);assert.equal(await page.locator('#wallet-provider').innerText(),'MetaMask');
      assert.equal(await page.locator('#wallet-account').innerText(),account);assert.equal(await page.locator('#wallet-chain').innerText(),'0x1917');
      await page.evaluate(()=>window.walletLocaleQA.openWalletChooser());
      assert.equal(await page.locator('#wallet-details p').last().innerText(),catalogs[locale]['wallet-local-boundary']);
      await page.evaluate(()=>window.walletLocaleQA.renderWalletState({status:'transport-unavailable'}));
      assert.equal(await page.locator('#wallet-state').innerText(),catalogs[locale]['wallet-transport']);assert.equal(await page.locator('#connect').innerText(),catalogs[locale]['Reconnect Wallet']);
      await page.evaluate(()=>window.walletLocaleQA.renderWalletState({status:'wrong-chain'}));assert.equal(await page.locator('#wallet-state').innerText(),catalogs[locale]['wallet-wrong-chain']);
      await page.evaluate(()=>window.walletLocaleQA.renderWalletState({status:'disconnected'}));assert.equal(await page.locator('#wallet-state').innerText(),catalogs[locale]['wallet-disconnected']);
      await page.locator('#wallet-dialog .close').click();
    }
    const calls=await page.evaluate(()=>window.walletLocaleQA.calls);assert.equal(calls.length,36);assert.deepEqual(calls,Array.from({length:12},()=>['ynx','metamask','hosted']).flat());
    await page.evaluate(value=>window.walletLocaleQA.renderStandardWallet(value),{status:'standard-connected',providerKind:'ynx',transport:'hosted-wallet-web',account,chainId:'0x1917'});
    await page.locator('#exchange-language').selectOption('ar');assert.equal(await page.locator('#connect').innerText(),catalogs.ar['Wallet details']);assert.equal(await page.locator('#wallet-provider').innerText(),'YNX Wallet Web');assert.equal(await page.locator('#wallet-account').innerText(),account);
    assert.equal(await page.locator('#wallet-revoke').evaluate(e=>e.hidden),true,'localization must not enable unsupported Hosted permission revocation');
    assert.equal(requests,0,'controlled UI test performs no real account/Wallet/network action');
  }finally{await browser.close()}
});

test('real order preview preserves exact financial values while form and dialog labels change languages',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;
    await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${previewSource}\nwindow.previewTest={buildOrderPreview,validateTradingRules};`});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});await page.waitForFunction(()=>window.previewTest&&window.localeTest);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const {buildOrderPreview,validateTradingRules}=window.previewTest;const state={side:'buy',marketPhase:'live',privatePhase:'guest',standardWallet:null};const display=${formatMicro.toString()};let reads=0;const marketFeed={retry:async()=>{reads++}};${estimate}\n${toast}\n${review}\nwindow.formQA={state,review:()=>reviewOrder({preventDefault(){}}),reads:()=>reads};window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document,onChange:estimate});`});
    await page.evaluate(()=>Object.assign(window.formQA.state,{rules:{schemaVersion:'exchange-limit-rules-v2',market:'YNXT-YUSD_TEST',orderTypes:['limit'],scale:'1000000',minPriceMicro:'1',maxPriceMicro:'1000000000000',minAmountMicro:'1',maxAmountMicro:'1000000000000',maxOrderNotionalMicro:'100000000000',makerFeeBps:17,takerFeeBps:43,notionalRounding:'floor_micro',feeRounding:'ceil_micro_per_fill',quoteAssetType:'venue_only_test_credit_not_token',admissionMinimumQuote:'one_micro_credit',reservationShortfall:'atomic_order_request_rejection'},source:{asOf:new Date().toISOString(),authority:'YNX-owned deterministic order state',classification:'testnet',status:'degraded_single_host'}}));
    await page.locator('#price').fill('2.000001');await page.locator('#amount').fill('3.000001');
    const keys=['Side / type','Limit price','Amount','Notional at limit','Single-fill maker fee','Single-fill taker fee','Initial reservation','Available venue balance','Wallet state','Rule source'];
    let financial;
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      assert.equal(await page.locator('#buy-tab').innerText(),catalogs[locale].Buy);
      assert.equal(await page.locator('#review-order').innerText(),catalogs[locale]['Preview order · no submission']);
      await page.evaluate(()=>window.formQA.review());
      assert.deepEqual(await page.locator('#order-preview-values dt').allTextContents(),keys.map(key=>catalogs[locale][key]));
      const values=await page.locator('#order-preview-values dd').allTextContents();
      if(!financial)financial=values.slice(0,7);assert.deepEqual(values.slice(0,7),financial);
      assert.equal(values[7],catalogs[locale]['Unknown — Exchange account proof required']);
      assert.equal(values[8],catalogs[locale]['Not connected; guest preview remains available']);
      assert.equal(await page.locator('#order-preview-title').innerText(),catalogs[locale]['Review a limit order']);
      assert.equal(await page.locator('#order-preview-dialog .wide').innerText(),catalogs[locale]['Return to edit']);
      for(const key of riskKeys){
        assert.equal(await page.locator(`#order-preview-dialog [data-exchange-locale="${key}"]`).innerText(),catalogs[locale][key]);
        if(locale!=='en')assert.notEqual(catalogs[locale][key],catalogs.en[key],`${locale}/${key}`);
      }
      assert.match(catalogs[locale]['preview-fee-risk'],/0\.000001 YUSD_TEST/u);
      assert.match(catalogs[locale]['preview-test-assets'],/YNXT/u);assert.match(catalogs[locale]['preview-test-assets'],/YUSD_TEST/u);
      assert.equal(await page.evaluate(()=>document.querySelector('#order-preview-dialog').scrollWidth<=document.querySelector('#order-preview-dialog').clientWidth),true,locale);
      await page.locator('#order-preview-dialog .wide').click();
    }
    assert.equal(await page.evaluate(()=>window.formQA.reads()),12,'each explicit review has only its existing single public refresh');
    assert.equal(requests,0,'controlled preview test never accesses a Wallet or submits an order');
    assert.equal(await page.locator('#price').inputValue(),'2.000001');assert.equal(await page.locator('#amount').inputValue(),'3.000001');
  }finally{await browser.close()}
});

test('actual activity tabs and all headers use 12 locales without mutating owned records or making requests',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;
    await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});await page.waitForFunction(()=>window.localeTest);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];const state={account:'A',snapshot:{orders:[]},activity:'orders'};const display=${formatMicro.toString()};${activityRender}\n${activityBinding}\nwindow.activityLocaleQA={state,renderActivity};window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document,onChange:renderActivity});document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));$('#activity').classList.add('active');renderActivity();`});
    const tabs={trades:'Trade history',orders:'Order history',ledger:'Asset ledger',deposits:'Deposits',withdrawals:'Withdrawals',fees:'Fee history',audit:'Audit'};
    const headers={};
    for(const tab of Object.keys(tabs)){await page.locator(`[data-activity="${tab}"]`).click();headers[tab]=await page.locator('#activity-head th').allTextContents();for(const key of headers[tab])assert.ok(activityKeys.includes(key),key)}
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      for(const [tab,label] of Object.entries(tabs)){
        assert.equal(await page.locator(`[data-activity="${tab}"]`).innerText(),catalogs[locale][label]);
        await page.locator(`[data-activity="${tab}"]`).click();
        assert.deepEqual(await page.locator('#activity-head th').allTextContents(),headers[tab].map(key=>catalogs[locale][key]));
        assert.equal(await page.locator('#activity-body').innerText(),catalogs[locale]['No owned records yet.']);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,locale);
    }
    await page.evaluate(()=>{window.activityLocaleQA.state.activity='orders';window.activityLocaleQA.state.snapshot={orders:[{account:'A',id:'exact-A',market:'YNXT-YUSD_TEST',side:'buy',type:'limit',priceMicro:1234567,amountMicro:2000000,filledMicro:0,status:'rejected',rejectReason:'EXACT_ENGINE_CODE',createdAt:'2026-10-03T00:00:00Z'},{account:'B',id:'foreign-B',createdAt:'2026-10-03T00:00:00Z'}]};window.activityLocaleQA.renderActivity()});
    const before=await page.locator('#activity-body').innerText();
    for(const locale of locales){await page.locator('#exchange-language').selectOption(locale);assert.equal(await page.locator('#activity-body').innerText(),before)}
    assert.match(before,/exact-A/u);assert.match(before,/EXACT_ENGINE_CODE/u);assert.doesNotMatch(before,/foreign-B/u);assert.equal(requests,0);
  }finally{await browser.close()}
});

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
  for(const key of riskKeys)assert.ok(html.includes(`data-exchange-locale="${key}">${catalogs.en[key]}</p>`),`default English risk disclosure differs from catalog: ${key}`);
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

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
const marketSource=await readFile(new URL('../web/market-data.js',import.meta.url),'utf8');
const privateRender=app.slice(app.indexOf('function ownedRecordInstant('),app.indexOf('function renderBalances('))+app.slice(app.indexOf('function renderPrivateAccount('),app.indexOf('function renderBook('));
const marketRender=app.slice(app.indexOf('function renderMarketStatus('),app.indexOf('async function refreshBook('));
const estimate=app.slice(app.indexOf('function preview()'),app.indexOf('function withdrawEstimate()'));
const toast=app.slice(app.indexOf('function toast('),app.indexOf('function showWalletFallback('));
const previewSource=await readFile(new URL('../web/order-preview.js',import.meta.url),'utf8');
const ownedTimes=app.slice(app.indexOf('function ownedRecordInstant('),app.indexOf('function renderBalances('));
const activityRender=ownedTimes+app.slice(app.indexOf('function renderActivity()'),app.indexOf('function renderPublicMarket()'));
const activityBinding=app.split('\n').find(line=>line.includes("$$('.tabs button').forEach(b=>b.addEventListener"));
const review=app.slice(app.indexOf('async function reviewOrder('),app.indexOf('function cancelOrder('));
const walletRender=app.slice(app.indexOf('function renderStandardWallet('),app.indexOf('function disconnectWallet('));
const walletChooser=app.slice(app.indexOf('function openWalletChooser('),app.indexOf('async function restoreStandardWallet('));
const walletConnect=app.slice(app.indexOf('async function connectWallet('),app.indexOf('function showView('));
const identitySource=app.slice(app.indexOf('let browserIdentity='),app.indexOf('\nconst marketFeed='));
const revokeSource=app.slice(app.indexOf('async function revokeWalletPermission('),app.indexOf('function openWalletChooser('));
const privateRevokeBinding=app.split('\n').find(line=>line.includes("$('#private-disconnect').addEventListener"));
const openOrdersRender=app.slice(app.indexOf('function renderOrders('),app.indexOf('function renderBalances('));
const balancesRender=app.slice(app.indexOf('function renderBalances('),app.indexOf('function renderActivity('));
const walletActions=app.slice(app.indexOf('function disconnectWallet('),app.indexOf('function openWalletChooser('));
const walletFailure=app.slice(app.indexOf('function walletConnectionFailure('),app.indexOf('async function connectWallet('));
const controlsRender=app.slice(app.indexOf('function renderOwnedControls('),app.indexOf('function renderBook('));
const publicRender=app.slice(app.indexOf('function renderPublicMarket('),app.indexOf('async function reviewOrder('));
const bookRender=app.slice(app.indexOf('function renderBook('),app.indexOf('function renderAccount('));

test('final AI, asset and truth-help batch preserves actual controls and fails closed without write approval',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;
    await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.evaluate(()=>{window.originalFinalInputs=Array.from(document.querySelectorAll('#ai-kind,#ai-context,#ai-prompt,#ai-permission,#deposit-network,#deposit-tx,#withdraw-destination,#withdraw-amount'));document.querySelector('#ai-kind').value='order_draft';document.querySelector('#ai-context').value='owned_balances';document.querySelector('#ai-prompt').value='Only this exact draft · 原文';document.querySelector('#ai-permission').checked=true;document.querySelector('#deposit-tx').value='exact-test-hash';document.querySelector('#withdraw-destination').value='ynx1exact';document.querySelector('#withdraw-amount').value='0.000001';window.approvals=0});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.YNXExchangeLocale=installExchangeLocale({document});`});await page.waitForFunction(()=>window.YNXExchangeLocale);
    const aiState=app.slice(app.indexOf('function renderAIState('),app.indexOf('\nboot();'));
    const unavailable=app.slice(app.indexOf('function productApiUnavailable('),app.indexOf('function requireProductSession('));
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);${unavailable}\n${aiState}\nwindow.renderActualAI=renderAIState;`});
    await page.evaluate(()=>window.renderActualAI());
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      for(const [id,key] of [['ai-kind','Workflow'],['ai-context','Bounded context'],['ai-prompt','Request'],['ai-permission','ai-context-consent'],['deposit-network','Network:'],['deposit-tx','Committed transaction hash'],['withdraw-destination','Native destination'],['withdraw-amount','Amount']])assert.equal(await page.locator('#'+id).evaluate(el=>Array.from(el.closest('label').childNodes).find(n=>n.nodeType===3&&n.textContent.trim()).textContent.trim()),catalogs[locale][key]);
      assert.deepEqual(await page.locator('#ai-kind option').allTextContents(),['Explain market','Summarize my trades','Explain risk','Draft an order'].map(key=>catalogs[locale][key]));
      assert.deepEqual(await page.locator('#ai-context option').allTextContents(),['Public market rules','My orders','My trades','My balances'].map(key=>catalogs[locale][key]));
      for(const [id,value] of [['ai-kind','order_draft'],['ai-context','owned_balances'],['ai-prompt','Only this exact draft · 原文'],['deposit-tx','exact-test-hash'],['withdraw-destination','ynx1exact'],['withdraw-amount','0.000001']])assert.equal(await page.locator('#'+id).inputValue(),value);
      assert.equal(await page.locator('#ai-permission').isChecked(),true);assert.equal(await page.locator('#ai-submit').textContent(),catalogs[locale]['Request draft']);
      assert.equal(await page.locator('#ai-result p').textContent(),catalogs[locale].API_UNAVAILABLE+' (API_UNAVAILABLE)');
      assert.equal(await page.locator('#deposit-network').inputValue(),'YNX Testnet · ynx_6423-1');assert.equal(await page.locator('#deposit-network option').last().evaluate(el=>el.disabled),true);
      assert.equal(await page.locator('#deposit-network option').last().getAttribute('value'),'External / cross-chain · unavailable');
      assert.equal(await page.locator('#deposit-state').textContent(),catalogs[locale]['deposit-policy-help']);assert.equal(await page.locator('#withdraw-form + .source-note').textContent(),catalogs[locale]['withdraw-broadcast-help']);
      for(const key of ['private-scope-help','metamask-session-help','market-order-gap'])assert.equal(await page.locator(`[data-exchange-locale="${key}"]`).textContent(),catalogs[locale][key]);
      assert.equal(await page.evaluate(()=>window.originalFinalInputs.every(el=>el.isConnected&&document.getElementById(el.id)===el)),true);
      assert.equal(await page.locator('#private-standard-wallet').count(),1);assert.equal(await page.locator('#private-standard-wallet').evaluate(el=>el.tagName),'BUTTON');
    }
    assert.equal(requests,0,'presentation changes cannot upload selected context, create a session or send a transaction');
    assert.equal(await page.evaluate(()=>window.approvals),0);
  }finally{await browser.close()}
});

test('actual security and support form labels preserve input nodes, raw values and user drafts across 12 languages',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.evaluate(()=>{document.querySelector('#controls').classList.add('active');window.originalControls=Array.from(document.querySelectorAll('#security-form input,#security-form select,#support-form select,#support-form textarea'));document.querySelector('#session-ttl').value='60';document.querySelector('#support-category').value='withdrawal';document.querySelector('#support-message').value='Exact draft · 原始内容 · <img> preserved';document.querySelector('#withdraw-lock').checked=true;document.querySelector('#withdraw-lock').disabled=true;document.querySelector('#session-ttl').disabled=true;window.unexpectedSubmit=0;for(const id of ['security-form','support-form'])document.getElementById(id).addEventListener('submit',event=>{event.preventDefault();window.unexpectedSubmit++})});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.YNXExchangeLocale=installExchangeLocale({document});`});await page.waitForFunction(()=>window.YNXExchangeLocale);
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      for(const [id,key] of [['session-ttl','Session lifetime'],['support-category','Category'],['support-message','What happened']])assert.equal(await page.locator('#'+id).evaluate(el=>Array.from(el.closest('label').childNodes).find(n=>n.nodeType===3&&n.textContent.trim()).textContent.trim()),catalogs[locale][key]);
      assert.deepEqual(await page.locator('#session-ttl option').allTextContents(),['15 minutes','1 hour','8 hours'].map(key=>catalogs[locale][key]));assert.equal(await page.locator('#session-ttl').inputValue(),'60');assert.equal(await page.locator('#support-category').inputValue(),'withdrawal');assert.equal(await page.locator('#support-message').inputValue(),'Exact draft · 原始内容 · <img> preserved');
      assert.equal(await page.locator('#withdraw-lock').isChecked(),true);assert.equal(await page.locator('#withdraw-lock').isDisabled(),true);assert.equal(await page.locator('#order-confirmation').isChecked(),true);assert.equal(await page.locator('#order-confirmation').isDisabled(),true);assert.equal(await page.locator('#session-ttl').isDisabled(),true);
      assert.equal(await page.locator('#security-form button').textContent(),catalogs[locale]['Save controls']);assert.equal(await page.locator('#support-form button').textContent(),catalogs[locale]['Open support case']);
      assert.equal(await page.locator('#security-form small').first().textContent(),catalogs[locale]['Blocks new withdrawal reviews']);assert.equal(await page.locator('#security-form small').last().textContent(),catalogs[locale]['Always review in Wallet']);
      assert.equal(await page.evaluate(()=>window.originalControls.every(el=>el.isConnected&&document.getElementById(el.id)===el)),true,'translation preserves input identity and existing listeners');
    }
    assert.equal(requests,0);assert.equal(await page.evaluate(()=>window.unexpectedSubmit),0);
  }finally{await browser.close()}
});

test('actual market workspace localizes headers and depth source without changing returned amounts, network or controls',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.YNXExchangeLocale=installExchangeLocale({document});`});await page.waitForFunction(()=>window.YNXExchangeLocale);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={book:null};const display=${formatMicro.toString()};${bookRender}\nwindow.bookLocaleQA={render(book){state.book=book;renderBook()},source:()=>JSON.stringify(state.book)};`});
    const book={asks:[{priceMicro:2000001,amountMicro:3000001,filledMicro:1000000}],bids:[]};
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      for(const [id,key] of [['chart-title','Market activity'],['book-title','Order book'],['order-title','Limit order'],['market-retry','Reconnect market data'],['refresh','Refresh']])assert.equal(await page.locator('#'+id).textContent(),catalogs[locale][key]);
      assert.deepEqual(await page.locator('.market-strip dt').allTextContents(),['Last matched','Your volume','Venue source','Network:'].map(key=>catalogs[locale][key]));
      assert.equal(await page.locator('#market-title').textContent(),'YNXT / YUSD_TEST');assert.equal(await page.locator('.market-strip dl div').last().locator('dd').textContent(),'ynx_6423-1');
      for(const [id,keys] of [['public-trades',['Time','Price','Amount','Source','Proof digest']],['orders',['Time','Side','Price','Amount / Filled','Status','Action']]])assert.deepEqual(await page.locator('#'+id).evaluate(el=>Array.from(el.closest('section').querySelectorAll('thead th'),th=>th.textContent)),keys.map(key=>catalogs[locale][key]));
      await page.evaluate(()=>window.bookLocaleQA.render({asks:[],bids:[]}));assert.equal(await page.locator('#spread').textContent(),catalogs[locale]['No public market depth']);
      await page.evaluate(book=>window.bookLocaleQA.render(book),book);assert.equal(await page.locator('#spread').textContent(),catalogs[locale]['Owned venue open orders']);assert.deepEqual(await page.locator('#asks .rows span, #asks > div > span').allTextContents(),[formatMicro(2000001),formatMicro(2000001),formatMicro(4000004)]);
      assert.equal(await page.evaluate(()=>window.bookLocaleQA.source()),JSON.stringify(book));assert.equal(await page.locator('#market').isVisible(),true);assert.equal(await page.locator('#private-refresh').evaluate(el=>el.hidden),true);
    }
    assert.equal(requests,0,'language and controlled depth display cannot request authorization or create an order');
  }finally{await browser.close()}
});

test('actual public trade chart switches SVG visibility from real returned rows and clears without fabricated prices',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.YNXExchangeLocale=installExchangeLocale({document});`});await page.waitForFunction(()=>window.YNXExchangeLocale);
    await page.addScriptTag({content:`${marketSource.replace(/^export\s*\{[^}]*\};?\s*$/gm,'').replace(/^export /gm,'')}\nconst $=s=>document.querySelector(s);const state={publicTrades:[]};const display=v=>formatMicro(v);${publicRender}\nwindow.publicChartQA={render(trades){state.publicTrades=trades;renderPublicMarket()},source:()=>JSON.stringify(state.publicTrades)};document.querySelector('#chart-interval').addEventListener('change',renderPublicMarket);`});
    const trades=Array.from({length:65},(_,i)=>({id:String(i).padStart(3,'0'),market:'YNXT-YUSD_TEST',createdAt:new Date(Date.UTC(2026,9,3,0,i)).toISOString(),priceMicro:1000000+i,amountMicro:2000000+i,sourceType:'deterministic_price_time_match',sourceDigest:i.toString(16).padStart(64,'0')})).reverse();
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      await page.evaluate(()=>window.publicChartQA.render([]));
      assert.equal(await page.locator('#chart-svg').isVisible(),false);assert.equal(await page.locator('#chart-empty').isVisible(),true);assert.equal(await page.locator('#last-price').textContent(),'—');assert.equal(await page.locator('#public-trades').textContent(),catalogs[locale]['market-no-matches']);
      await page.evaluate(trades=>window.publicChartQA.render(trades),trades);
      assert.equal(await page.locator('#chart-svg').getAttribute('hidden'),null);assert.equal(await page.locator('#chart-svg').isVisible(),true);assert.equal(await page.locator('#chart-empty').isVisible(),false);
      assert.equal(await page.locator('#public-trades tr').count(),20);assert.equal(await page.locator('#public-trades tr').first().locator('td').nth(1).textContent(),formatMicro(1000064));assert.equal(await page.locator('#public-trades tr').first().locator('td').nth(3).textContent(),'deterministic_price_time_match');assert.equal(await page.locator('#public-trades tr').first().locator('td').nth(4).textContent(),'40'.padStart(64,'0'));
      assert.equal(await page.locator('#last-price').textContent(),formatMicro(1000064)+' YUSD_TEST');assert.equal(await page.locator('#candle-caption').textContent(),catalogs[locale]['candle-chart-label']);
      for(const [period,count] of [['60000',60],['300000',13],['3600000',2]]){
        await page.locator('#chart-interval').selectOption(period);
        assert.equal(await page.locator('#chart-svg g[data-candle-start]').count(),count);assert.equal(await page.locator('#candle-records tr').count(),count);
        assert.doesNotMatch(await page.locator('#chart-svg').innerHTML(),/NaN|Infinity/);
      }
      assert.equal(await page.evaluate(()=>window.publicChartQA.source()),JSON.stringify(trades));await page.locator('#chart-interval').selectOption('60000');
      await page.evaluate(()=>window.publicChartQA.render([]));assert.equal(await page.locator('#chart-svg').isVisible(),false);assert.equal(await page.locator('#chart-svg polyline').count(),0);assert.equal(await page.locator('#last-price').textContent(),'—');
    }
    assert.equal(requests,0,'controlled returned rows test only display behavior, not public matching or real orders');
  }finally{await browser.close()}
});

test('actual controls statuses localize without write enablement or stale placeholders replacing owned support records',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.YNXExchangeLocale=installExchangeLocale({document});`});await page.waitForFunction(()=>window.YNXExchangeLocale);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:'A',snapshot:null};${ownedTimes}${controlsRender}\nwindow.controlsQA={render(snapshot){state.snapshot=snapshot;renderOwnedControls()}};`});
    const createdAt='2026-10-03T00:00:00Z';
    const cases=[{account:'A',id:'owned-case',category:'order',status:'open',createdAt,message:'<img src=x onerror=alert(1)> exact user text'},{account:'B',id:'foreign-case',category:'security',status:'closed',createdAt,message:'FOREIGN_ONLY'}];
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      await page.evaluate(()=>window.controlsQA.render(null));
      assert.equal(await page.locator('#security-read-state').textContent(),catalogs[locale]['controls-unverified']);assert.equal(await page.locator('#owned-support-cases').textContent(),catalogs[locale]['support-unverified']);
      await page.evaluate(()=>window.controlsQA.render({security:{updatedAt:'not-a-time'},support:[]}));
      assert.equal(await page.locator('#security-read-state').textContent(),catalogs[locale]['controls-read-no-time']);assert.equal(await page.locator('#owned-support-cases').textContent(),catalogs[locale]['support-empty']);
      await page.evaluate(cases=>window.controlsQA.render({security:{updatedAt:'2026-10-03T00:00:00Z'},support:cases}),cases);
      await page.evaluate(locale=>window.YNXExchangeLocale.set(locale),locale);
      assert.match(await page.locator('#security-read-state').textContent(),new RegExp('^'+catalogs[locale]['controls-read-verified'].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      assert.equal(await page.locator('#owned-support-cases article').count(),1);assert.equal(await page.locator('#owned-support-cases article p').last().textContent(),cases[0].message);
      assert.doesNotMatch(await page.locator('#owned-support-cases').textContent(),/FOREIGN_ONLY|foreign-case/);assert.equal(await page.locator('#owned-support-cases img').count(),0);
      assert.equal(await page.locator('#withdraw-lock').isDisabled(),true);assert.equal(await page.locator('#session-ttl').isDisabled(),true);
    }
    assert.equal(requests,0,'translated read results cannot request or enable writes');
  }finally{await browser.close()}
});

test('actual Wallet notifications distinguish confirmed and unconfirmed outcomes across locales and preserve late result codes',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});await page.waitForFunction(()=>window.localeTest);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={standardWallet:null};let mode='unsupported',calls=0,pending=null;window.confirm=()=>true;function showWalletFallback(value){$('#wallet-fallback').hidden=!value}window.YNXExchangeWebWallet={connectYNX:async()=>{calls++;return {status:'standard-connected',providerKind:'ynx',account:'0x'+'1'.repeat(40),chainId:'0x1917'}},disconnect:()=>{calls++},state:()=>({status:'disconnected'}),revoke:async()=>{calls++;if(mode==='pending')return await new Promise(resolve=>pending=resolve);if(mode==='throw')throw new Error('controlled-failure');return mode==='confirmed'?{permissionRevoked:true}:{permissionRevoked:false,status:'unsupported'}}};${toast}\n${walletRender}\n${walletActions}\n${walletFailure}\n${walletConnect}\nwindow.toastLocaleQA={set(value){mode=value},connect:()=>connectWallet('ynx'),disconnect:disconnectWallet,revoke:revokeWalletPermission,pending:()=>!!pending,resume:()=>pending({permissionRevoked:false,status:'EXACT_UNCONFIRMED_CODE'}),failure:()=>walletConnectionFailure({code:'EXACT_PROVIDER_CODE'},'MetaMask'),calls:()=>calls,toast};window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document});`});
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);const before=await page.evaluate(()=>window.toastLocaleQA.calls());await page.evaluate(locale=>window.YNXExchangeLocale.set(locale),locale);assert.equal(await page.evaluate(()=>window.toastLocaleQA.calls()),before);
      await page.evaluate(()=>window.toastLocaleQA.connect());assert.equal(await page.locator('#toast').innerText(),catalogs[locale]['wallet-toast-connected']);
      await page.evaluate(()=>window.toastLocaleQA.disconnect());assert.equal(await page.locator('#toast').innerText(),catalogs[locale]['wallet-toast-disconnected']);
      await page.evaluate(async()=>{window.toastLocaleQA.set('unsupported');await window.toastLocaleQA.revoke()});assert.equal(await page.locator('#toast').innerText(),catalogs[locale]['wallet-toast-revoke-unconfirmed']+' (unsupported)');
      await page.evaluate(async()=>{window.toastLocaleQA.set('throw');await window.toastLocaleQA.revoke()});assert.equal(await page.locator('#toast').innerText(),catalogs[locale]['wallet-toast-revoke-failed']);
      await page.evaluate(async()=>{window.toastLocaleQA.set('confirmed');await window.toastLocaleQA.revoke()});assert.equal(await page.locator('#toast').innerText(),catalogs[locale]['wallet-toast-revoked']);assert.equal(await page.locator('#wallet-revoke').isEnabled(),true);
      await page.evaluate(()=>window.toastLocaleQA.failure());assert.equal(await page.locator('#toast').innerText(),catalogs[locale]['wallet-toast-connect-failed']+' (MetaMask; EXACT_PROVIDER_CODE)');
    }
    await page.evaluate(()=>{window.toastLocaleQA.set('pending');void window.toastLocaleQA.revoke()});await page.waitForFunction(()=>window.toastLocaleQA.pending());await page.locator('#exchange-language').selectOption('ar');await page.evaluate(()=>window.toastLocaleQA.resume());await page.waitForFunction(text=>document.querySelector('#toast').textContent===text,catalogs.ar['wallet-toast-revoke-unconfirmed']+' (EXACT_UNCONFIRMED_CODE)');
    await page.evaluate(()=>window.toastLocaleQA.toast({localeKey:'__proto__',message:'unknown-plain'}));await page.locator('#exchange-language').selectOption('ja');assert.equal(await page.locator('#toast').innerText(),'unknown-plain','unknown catalog key cannot revive or impersonate a confirmed outcome');
    assert.equal(requests,0,'controlled outcomes do not prove real Wallet connection or remote revocation');
  }finally{await browser.close()}
});

test('actual record renderers translate only authoritative domain states and retain codes without promoting unknown or reviewed withdrawals',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});await page.waitForFunction(()=>window.localeTest);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:'A',activity:'orders',snapshot:null};const display=${formatMicro.toString()};const cancelOrder=()=>{throw new Error('unexpected write action')};${openOrdersRender}\n${balancesRender}\n${activityRender}\nwindow.recordLocaleQA={set(data){state.snapshot=data},render(domain){state.activity=domain;renderOrders();renderBalances();renderActivity()},snapshot:()=>JSON.stringify(state.snapshot)};window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document});`});
    const createdAt='2026-10-03T00:00:00Z';
    const orders=['open','partially_filled','filled','cancelled','rejected'].map((status,i)=>({account:'A',id:`order-${i}`,market:'YNXT-YUSD_TEST',side:'buy',type:'limit',priceMicro:1234567,amountMicro:2000000,filledMicro:status==='partially_filled'?1000000:status==='filled'?2000000:0,status,createdAt}));
    const deposits=['confirming','confirmed','future_unknown','__proto__'].map((status,i)=>({account:'A',id:`deposit-${i}`,asset:'YNXT',network:'YNX Testnet',amountMicro:1000001,confirmations:status==='confirmed'?12:2,required:12,status,txHash:`returned-${i}`,sourceDigest:'a'.repeat(64),createdAt}));
    const withdrawals=['reviewed_pending_operator_broadcast','future_unknown'].map((status,i)=>({account:'A',id:`withdrawal-${i}`,asset:'YNXT',network:'YNX Testnet',amountMicro:2000000,feeMicro:1,receiveMicro:1999999,status,destination:'ynx1-fixture',sourceDigest:'b'.repeat(64),createdAt}));
    const data={orders,deposits,withdrawals,balances:[{asset:'YNXT',availableMicro:9007199254740991,reservedMicro:1}]};await page.evaluate(data=>window.recordLocaleQA.set(data),data);
    for(const locale of locales){
      await page.evaluate(locale=>window.YNXExchangeLocale.set(locale),locale);
      await page.evaluate(()=>window.recordLocaleQA.render('orders'));
      const states=await page.locator('#activity-body tr td:nth-child(7)').allTextContents();assert.deepEqual(states,['open','partial','filled','cancelled','rejected'].map((key,i)=>catalogs[locale][`record-order-${key}`]+` (${orders[i].status})`));
      assert.equal(await page.locator('#orders tr').count(),2);assert.equal(await page.locator('#orders tr').first().locator('td').nth(4).getAttribute('class'),'status-open');
      assert.deepEqual(await page.locator('#orders button').allTextContents(),[catalogs[locale].Cancel,catalogs[locale].Cancel]);
      assert.deepEqual(await page.locator('#balances dt').allTextContents(),[catalogs[locale].Available,catalogs[locale].Reserved]);assert.deepEqual(await page.locator('#balances dd').allTextContents(),[formatMicro(9007199254740991),formatMicro(1)]);
      await page.evaluate(()=>window.recordLocaleQA.render('deposits'));assert.deepEqual(await page.locator('#activity-body tr td:nth-child(6)').allTextContents(),[catalogs[locale]['record-deposit-confirming']+' (confirming)',catalogs[locale]['record-deposit-confirmed']+' (confirmed)','future_unknown','__proto__']);
      await page.evaluate(()=>window.recordLocaleQA.render('withdrawals'));assert.deepEqual(await page.locator('#activity-body tr td:nth-child(7)').allTextContents(),[catalogs[locale]['record-withdrawal-reviewed']+' (reviewed_pending_operator_broadcast)','future_unknown']);
      assert.equal(await page.evaluate(()=>window.YNXExchangeLocale.record('order','confirmed')),'confirmed','deposit confirmation must not be promoted to an order state');
      assert.equal(await page.evaluate(()=>window.YNXExchangeLocale.record('constructor','open')),'open');assert.equal(await page.evaluate(()=>window.recordLocaleQA.snapshot()),JSON.stringify(data));
      await page.evaluate(()=>{window.recordLocaleQA.set({orders:[],balances:[]});window.recordLocaleQA.render('orders')});assert.equal(await page.locator('#orders').innerText(),catalogs[locale]['orders-empty']);assert.equal(await page.locator('#balances').innerText(),'');await page.evaluate(data=>window.recordLocaleQA.set(data),data);
    }
    assert.equal(requests,0,'displaying a venue report does not verify or cause a chain transaction');
  }finally{await browser.close()}
});

test('actual revoke confirmations use the selected locale and cancellation invokes neither private nor standard revocation',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.localeTest={installExchangeLocale};`});await page.waitForFunction(()=>window.localeTest);
    assert.ok(privateRevokeBinding,'execute the actual private confirmation listener');
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);let decision=false,privateCalls=0,walletCalls=0;const confirmations=[];window.confirm=text=>{confirmations.push(text);return decision};const toast=()=>{};const privateAccount={disconnect:()=>{privateCalls++}};window.YNXExchangeWebWallet={revoke:async()=>{walletCalls++;return {permissionRevoked:false,status:'unsupported'}}};${revokeSource}\n${privateRevokeBinding}\nwindow.revokeLocaleQA={revoke:revokeWalletPermission,confirmations,counts:()=>({privateCalls,walletCalls}),approve:()=>decision=true};window.YNXExchangeLocale=window.localeTest.installExchangeLocale({document});`});
    await page.locator('.account-management summary').click();
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
      assert.equal(await page.locator('#order-limits').innerText(),catalogs[locale]['order-limits-description']+` ${formatMicro(100000000000)} YUSD_TEST.`);
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
      await page.evaluate(()=>Object.assign(window.formQA.state,{privatePhase:'connected',snapshot:{balances:[{asset:'YUSD_TEST',availableMicro:1234567}]}}));
      await page.evaluate(()=>window.formQA.review());
      assert.equal(await page.locator('#order-preview-values dd').nth(7).innerText(),catalogs[locale]['balance-last-read']+` · ${formatMicro(1234567)} YUSD_TEST`);
      await page.locator('#order-preview-dialog .wide').click();
      await page.evaluate(()=>Object.assign(window.formQA.state,{privatePhase:'guest',snapshot:null}));
    }
    assert.equal(await page.evaluate(()=>window.formQA.reads()),24,'each explicit guest or account preview has only its existing single public refresh');
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
    const before=await page.locator('#activity-body').innerText(),cells=await page.locator('#activity-body td').allTextContents();
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);const current=await page.locator('#activity-body td').allTextContents();
      assert.deepEqual(current.filter((_,i)=>i!==0&&i!==6),cells.filter((_,i)=>i!==0&&i!==6));
      assert.equal(current[0],await page.evaluate(()=>new Date('2026-10-03T00:00:00Z').toLocaleString(document.documentElement.lang)));
      assert.equal(current[6],catalogs[locale]['record-order-rejected']+' (rejected)');
    }
    assert.match(before,/exact-A/u);assert.match(before,/EXACT_ENGINE_CODE/u);assert.doesNotMatch(before,/foreign-B/u);assert.equal(requests,0);
    const trade={id:'exact-trade',buyer:'A',seller:'B',buyOrderId:'exact-buy-A',sellOrderId:'exact-sell-B',priceMicro:1234567,amountMicro:2000000,buyerFeeMicro:17,sellerFeeMicro:43,sourceType:'deterministic_price_time_match',sourceDigest:'e'.repeat(64),createdAt:'2026-10-03T00:00:00Z'};
    await page.evaluate(trade=>{activityLocaleQA.state.snapshot={trades:[trade]};activityLocaleQA.state.activity='trades';activityLocaleQA.renderActivity()},trade);
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      assert.deepEqual(await page.locator('#activity-head th').allTextContents(),['Time','Reference','Order ID','Side','Price','Amount','Fee','Source','Source digest'].map(key=>catalogs[locale][key]));
      const values=await page.locator('#activity-body td').allTextContents();
      assert.deepEqual(values.slice(1,4),['exact-trade','exact-buy-A','buy']);assert.equal(values[7],trade.sourceType);assert.equal(values[8],trade.sourceDigest);
      assert.deepEqual(await page.evaluate(()=>activityLocaleQA.state.snapshot.trades[0]),trade);
      assert.equal(await page.locator('#activity-body a,#activity-body button').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,locale);
    }
    assert.equal(requests,0);
  }finally{await browser.close()}
});

test('actual public disclosure localization preserves market visibility, inputs and all action boundaries',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;
    await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.YNXExchangeLocale=installExchangeLocale({document});`});await page.waitForFunction(()=>window.YNXExchangeLocale);
    await page.locator('#price').fill('2.000001');await page.locator('#amount').fill('3.000001');
    const keys=['testnet-disclosure','chart-no-fabrication','book-owned-source','ai-draft-boundary','market-stale-warning'];
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      for(const key of keys){const element=page.locator(`[data-exchange-locale="${key}"]`);assert.equal(await element.textContent(),catalogs[locale][key]);if(locale!=='en')assert.notEqual(catalogs[locale][key],catalogs.en[key]);}
      assert.equal(await page.locator('#market-stale').evaluate(el=>el.hidden),true,'translation cannot mark fresh data stale or manufacture a recovery');
      assert.equal(await page.locator('#chart-svg').evaluate(el=>el.hasAttribute('hidden')),true);assert.equal(await page.locator('#chart-empty').isVisible(),true);
      assert.equal(await page.locator('#price').inputValue(),'2.000001');assert.equal(await page.locator('#amount').inputValue(),'3.000001');
      assert.equal(await page.locator('#market').isVisible(),true);
    }
    assert.equal(requests,0,'language preferences cannot request data, authorization or execution');
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

test('actual private panel translations preserve pending routes and forget unverified placeholders after account recovery',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});let requests=0;await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.addScriptTag({type:'module',content:`${localeSource}\nwindow.YNXExchangeLocale=installExchangeLocale({document});`});await page.waitForFunction(()=>window.YNXExchangeLocale);
    await page.addScriptTag({content:`const $=s=>document.querySelector(s);const state={account:null,standardWallet:{status:'standard-connected',account:'standard-only'}};const renderAccount=()=>{const span=document.createElement('span');span.textContent='RETURNED_BALANCE_ONLY';$('#balances').replaceChildren(span)};const resumeDeferredBrowserIdentity=()=>{};${privateRender}\nwindow.privateQA={render:renderPrivateAccount,state};`});
    const staticKeys=['private-title','private-read-boundary','private-prepare','private-open','private-retry','private-refresh','private-guest','private-revoke','private-native-label','private-expiry-label'];
    const route='https://wallet.ynxweb4.com/?controlled-read-only-request=exact';
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);
      for(const key of staticKeys)assert.equal(await page.locator(`[data-exchange-locale="${key}"]`).textContent(),catalogs[locale][key]);
      await page.evaluate(route=>window.privateQA.render({phase:'approval-pending',account:null,snapshot:null,route}),route);
      assert.equal(await page.locator('#private-open').getAttribute('href'),route);assert.equal(await page.locator('#private-open').isVisible(),true);
      assert.equal(await page.locator('#balances').textContent(),catalogs[locale]['private-no-balances']);assert.equal(await page.locator('#private-source').textContent(),catalogs[locale]['private-no-snapshot']);
      await page.evaluate(()=>window.privateQA.render({phase:'loading',account:null,snapshot:null}));
      for(const id of ['private-begin','private-retry','private-refresh','private-disconnect'])assert.equal(await page.locator('#'+id).isDisabled(),true);
      await page.evaluate(()=>window.privateQA.render({phase:'connected',account:'native-returned-account',expiresAt:'2030-01-01T00:00:00Z',snapshot:{sourceMetadata:{status:'EXACT_SOURCE',coverage:'OWNED_ONLY',asOf:'2026-10-03T00:00:00Z'},security:{updatedAt:'2026-10-03T00:00:00Z'},support:[]}}));
      await page.evaluate(locale=>window.YNXExchangeLocale.set(locale),locale);
      assert.equal(await page.locator('#balances').textContent(),'RETURNED_BALANCE_ONLY','old unverified placeholder cannot overwrite recovered balance DOM');
      assert.match(await page.locator('#private-source').textContent(),/^EXACT_SOURCE · OWNED_ONLY · /);assert.equal(await page.locator('#private-native-account').textContent(),'native-returned-account');
      assert.equal(await page.locator('#private-refresh').isVisible(),true);assert.equal(await page.locator('#private-open').getAttribute('href'),null);
      assert.equal(await page.evaluate(()=>window.privateQA.state.standardWallet.account),'standard-only');
      await page.evaluate(()=>window.privateQA.render({phase:'guest',account:null,snapshot:null}));
      assert.equal(await page.locator('#private-details').evaluate(el=>el.hidden),true);assert.equal(await page.locator('#balances').textContent(),catalogs[locale]['private-no-balances']);
    }
    assert.equal(requests,0,'controlled render results do not prove authorization, readback or private session creation');
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

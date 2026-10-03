import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';

const root=new URL('../web/',import.meta.url);
const [html,css,app,market,locale]=await Promise.all(['index.html','styles.css','app.js','market-data.js','locale.js'].map(name=>readFile(new URL(name,root),'utf8')));
// Production gained an export alias; stripping only the `export ` prefix
// leaves invalid `{date as isVenueTimestamp}` syntax in a classic test script.
const marketForClassicScript=market.replace(/^export \{[^}]*\};?$/gm,'').replace(/^export /gm,'');
assert.doesNotMatch(marketForClassicScript,/^export /m);
const render=app.slice(app.indexOf('function renderPublicMarket('),app.indexOf('async function reviewOrder('));
const logo=await readFile(new URL('ynx-logo.png',root));
test('actual read-only order preview uses the selected language for its rule observation time',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();let requests=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{requests++;return route.abort()});
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addScriptTag({type:'module',content:`${locale}\nwindow.YNXExchangeLocale=installExchangeLocale({document});`});await page.waitForFunction(()=>window.YNXExchangeLocale);
    const arithmetic=await readFile(new URL('order-preview.js',root),'utf8');
    const preview=app.split('\n').find(line=>line.startsWith('function preview()'));
    const review=app.slice(app.indexOf('async function reviewOrder('),app.indexOf('function cancelOrder('));
    const rules={schemaVersion:'exchange-limit-rules-v2',market:'YNXT-YUSD_TEST',orderTypes:['limit'],scale:'1000000',minPriceMicro:'1',maxPriceMicro:'1000000000000',minAmountMicro:'1',maxAmountMicro:'1000000000000',maxOrderNotionalMicro:'100000000000',makerFeeBps:17,takerFeeBps:43,notionalRounding:'floor_micro',feeRounding:'ceil_micro_per_fill',quoteAssetType:'venue_only_test_credit_not_token',admissionMinimumQuote:'one_micro_credit',reservationShortfall:'atomic_order_request_rejection'};
    await page.addScriptTag({content:`${marketForClassicScript}${arithmetic.replace(/^export /gm,'')}const $=s=>document.querySelector(s),state={side:'buy',rules:${JSON.stringify(rules)},source:null,marketPhase:'live'},display=v=>formatMicro(v,document.documentElement.lang);const toast=()=>{};window.previewReads=0;const marketFeed={retry:async()=>{previewReads++;state.source={asOf:new Date().toISOString(),authority:'YNX-owned deterministic order state',classification:'testnet',status:'degraded_single_host'}}};${preview}${review}$('#review-order').onclick=reviewOrder;window.previewSource=()=>JSON.stringify({rules:state.rules,source:state.source});`});
    await page.locator('#price').fill('2.000001');await page.locator('#amount').fill('3.000001');
    for(const language of ['en','zh-Hans','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.locator('#exchange-language').selectOption(language);await page.locator('#review-order').click();
      await page.waitForFunction(()=>document.querySelector('#order-preview-dialog').open);
      const original=await page.evaluate(()=>previewSource());
      const expected=await page.evaluate(()=>`degraded_single_host · ${new Date(JSON.parse(previewSource()).source.asOf).toLocaleString(document.documentElement.lang)}`);
      assert.equal(await page.locator('#order-preview-values > div').last().locator('dd').textContent(),expected);
      assert.equal(await page.evaluate(()=>previewSource()),original);
      await page.locator('#order-preview-dialog [aria-label="Close preview"]').click();
    }
    assert.equal(await page.evaluate(()=>previewReads),12);assert.equal(requests,0);assert.deepEqual(errors,[]);assert.equal(page.context().pages().length,1);
  }finally{await browser.close()}
});
test('actual order book shows best seven prices independent of equivalent snapshot row order',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    const bookRenderer=app.split('\n').filter(line=>line.startsWith('function renderBook(')||line.startsWith('function renderRows(')).join('\n');
    await page.addScriptTag({content:`${marketForClassicScript}const $=s=>document.querySelector(s),state={book:null},display=v=>formatMicro(v);${bookRenderer} window.bookQA=book=>{state.book=book;renderBook();return JSON.stringify(state.book)};`});
    const row=(price,id)=>({id,priceMicro:price*1000000,amountMicro:2000000,filledMicro:500000});
    const book={bids:[1,3,7,5,9,2,8,6,4].map(price=>row(price,'b'+price)),asks:[19,16,18,12,14,11,17,15,13].map(price=>row(price,'a'+price))};
    for(const input of [book,{bids:[...book.bids].reverse(),asks:[...book.asks].reverse()}]){
      assert.equal(await page.evaluate(input=>bookQA(input),input),JSON.stringify(input));
      assert.deepEqual(await page.locator('#bids > div > span:first-child').allTextContents(),['9.00','8.00','7.00','6.00','5.00','4.00','3.00']);
      assert.deepEqual(await page.locator('#asks > div > span:first-child').allTextContents(),['17.00','16.00','15.00','14.00','13.00','12.00','11.00']);
      assert.equal(await page.locator('#bids > div > span:nth-child(2)').first().textContent(),'1.50');
    }
    assert.equal(page.context().pages().length,1);
  }finally{await browser.close()}
});
test('actual preview control unlocks after a bounded stalled read without showing or submitting an order',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    const arithmetic=await readFile(new URL('order-preview.js',root),'utf8');
    const preview=app.split('\n').find(line=>line.startsWith('function preview()'));
    const review=app.slice(app.indexOf('async function reviewOrder('),app.indexOf('function cancelOrder('));
    await page.addScriptTag({content:`${marketForClassicScript}${arithmetic.replace(/^export /gm,'')}const $=s=>document.querySelector(s),state={side:'buy',rules:null,source:null,marketPhase:'loading'};window.deadlines=[];window.readCalls=[];const toast=()=>{};const marketFeed=createMarketFeed({fetchImpl:(url,options)=>{readCalls.push({url,method:options.method});return new Promise(()=>{})},EventSourceImpl:null,setTimer:(fn,ms)=>{deadlines.push({fn,ms});return deadlines.length},clearTimer:()=>{},onStatus:value=>state.marketPhase=value.phase});${preview}${review}$('#review-order').onclick=reviewOrder;window.fireDeadline=()=>deadlines.find(item=>item.ms===10000).fn();window.stopFeed=()=>marketFeed.stop();`});
    await page.locator('#review-order').click();assert.equal(await page.locator('#review-order').isEnabled(),false);
    await page.evaluate(()=>fireDeadline());await page.waitForFunction(()=>!document.querySelector('#review-order').disabled);
    assert.equal(await page.locator('#order-preview-dialog').evaluate(element=>element.open),false);
    assert.match(await page.locator('#order-error').innerText(),/Verified venue trading rules are unavailable/);
    assert.deepEqual(await page.evaluate(()=>readCalls),[{url:'/api/v1/market-data/snapshot',method:'GET'}]);
    assert.equal(page.context().pages().length,1);await page.evaluate(()=>stopFeed());
  }finally{await browser.close()}
});
test('conflicting revision keeps actual candle view stale until an explicit verified retry',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    const status=app.slice(app.indexOf('function renderMarketStatus('),app.indexOf('async function refreshBook('));
    await page.addScriptTag({content:`${marketForClassicScript}const $=s=>document.querySelector(s),state={publicTrades:[]},display=v=>formatMicro(v);${render}${status}
      window.marketQA={next:null,reads:0};let transport;class Source{constructor(){transport=this;this.events={}}addEventListener(k,f){this.events[k]=f}close(){} }
      window.feed=createMarketFeed({fetchImpl:async()=>{marketQA.reads++;return Response.json(marketQA.next)},EventSourceImpl:Source,setTimer:()=>1,clearTimer:()=>{},onSnapshot:s=>{state.publicTrades=s.trades;renderPublicMarket()},onStatus:renderMarketStatus});window.emitConflict=value=>transport.events.reconciled({data:JSON.stringify(value)});`});
    const source={authority:'YNX-owned deterministic order state',version:'exchange-public-state-v1',asOf:'2026-10-03T00:00:00Z',classification:'testnet',status:'degraded_single_host',coverage:'stream-orderbook-matched-trades',stateBackend:'file_snapshot',multiInstance:false};
    const snapshot={schemaVersion:'exchange-public-market-v1',revision:1,market:'YNXT-YUSD_TEST',sourceMetadata:source,orderBook:{market:'YNXT-YUSD_TEST',bids:[],asks:[]},trades:[{id:'local-match',market:'YNXT-YUSD_TEST',priceMicro:2000000,amountMicro:4000000,createdAt:'2026-08-03T18:41:37.614045168Z',sourceType:'deterministic_price_time_match',sourceDigest:'a'.repeat(64)}]};
    await page.evaluate(async s=>{marketQA.next=s;await feed.start()},snapshot);
    const original=await page.locator('#candle-records').textContent();
    const originalMatch=await page.locator('#market-last-match').textContent();
    assert.ok(originalMatch.includes(snapshot.trades[0].createdAt));assert.ok(!originalMatch.includes(source.asOf));
    const observed=structuredClone(snapshot);observed.sourceMetadata.asOf='2026-10-04T00:00:00Z';
    await page.evaluate(s=>emitConflict(s),observed);
    assert.equal(await page.locator('#market-last-match').textContent(),originalMatch,'a fresh snapshot cannot redate an old match');
    assert.equal(await page.locator('#market-last-match').getAttribute('data-match-digest'),snapshot.trades[0].sourceDigest);
    const conflict=structuredClone(snapshot);conflict.trades[0].priceMicro=3000000;
    await page.evaluate(s=>emitConflict(s),conflict);
    assert.equal(await page.locator('#candle-records').textContent(),original);assert.equal(await page.locator('#market-stale').isHidden(),false);assert.equal(await page.locator('#market-source').getAttribute('data-stale'),'true');
    assert.equal(await page.locator('#market-last-match').textContent(),originalMatch);
    conflict.revision=2;await page.evaluate(async s=>{marketQA.next=s;await feed.retry()},conflict);
    assert.notEqual(await page.locator('#candle-records').textContent(),original);assert.equal(await page.locator('#market-stale').isHidden(),true);
    assert.equal(await page.evaluate(()=>marketQA.reads),2);assert.equal(page.context().pages().length,1);await page.evaluate(()=>feed.stop());
  }finally{await browser.close()}
});
test('desktop/mobile candle controls and exact trace rows remain read-only, localized and bounded',async t=>{
  const evidence=await mkdtemp(path.join(os.tmpdir(),'ynx-exchange-candle-display-'));
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    for(const width of [1440,390,320]){
      const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});let requests=0;
      await page.route('**/*',route=>{requests++;return route.abort()});
      await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/src="\/ynx-logo\.png\?v=[a-f0-9]+"/,`src="data:image/png;base64,${logo.toString('base64')}"`));await page.addStyleTag({content:css});
      await page.addScriptTag({type:'module',content:`${locale}\nwindow.YNXExchangeLocale=installExchangeLocale({document});`});await page.waitForFunction(()=>window.YNXExchangeLocale);
      await page.addScriptTag({content:`${marketForClassicScript}\nconst $=s=>document.querySelector(s);const state={publicTrades:[]};const display=v=>formatMicro(v,document.documentElement.lang);${render}\nwindow.candleQA={render(trades){this.rows=trades;state.publicTrades=trades;renderPublicMarket()}};$('#chart-interval').addEventListener('change',renderPublicMarket);`});
      const trades=Array.from({length:20},(_,i)=>({id:`fixture-${i}`,market:'YNXT-YUSD_TEST',createdAt:new Date(Date.UTC(2026,9,3,0,i)).toISOString(),priceMicro:1000000+(i%5)*10000,amountMicro:2000000,sourceType:'deterministic_price_time_match',sourceDigest:i.toString(16).padStart(64,'0')}));
      await page.evaluate(trades=>window.candleQA.render(trades),trades);
      for(const language of ['en','zh-Hans','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
        await page.locator('#exchange-language').selectOption(language);
        await page.evaluate(()=>window.candleQA.render(window.candleQA.rows));
        assert.equal(await page.locator('#public-trades tr').first().locator('td').first().textContent(),await page.evaluate(instant=>new Date(instant).toLocaleString(document.documentElement.lang),trades[19].createdAt),'match display must use the chosen product language, not the browser default');
        assert.equal(await page.evaluate(()=>JSON.stringify(window.candleQA.rows)),JSON.stringify(trades),'language switches must preserve canonical source records');
        assert.equal(await page.locator('#market-last-match').getAttribute('data-match-time'),trades[19].createdAt);
        assert.equal(await page.locator('#market-last-match').getAttribute('data-match-id'),trades[19].id);
        assert.equal(await page.locator('#market-last-match').getAttribute('data-match-digest'),trades[19].sourceDigest);
        assert.equal(await page.locator('[data-exchange-locale="market-match-boundary"]').textContent(),await page.evaluate(()=>YNXExchangeLocale.text('market-match-boundary')));
        for(const [period,count] of [['60000',20],['300000',4],['3600000',1]]){
          await page.locator('#chart-interval').selectOption(period);assert.equal(await page.locator('#chart-svg g').count(),count);assert.equal(await page.locator('#candle-records tr').count(),count);
          assert.ok(await page.locator('#chart-svg').evaluate(svg=>Number(svg.querySelector('text').getAttribute('font-size'))*svg.getBoundingClientRect().width/800>=12),'chart label must not shrink to unreadable SVG text');
        }
        await page.locator('.chart summary').click();
        assert.ok((await page.locator('#candle-records').textContent()).includes(trades[19].sourceDigest));
        assert.ok(await page.locator('#candle-records').textContent().then(value=>value.includes('fixture-0')));
        assert.equal(await page.locator('#candle-records tr td').nth(2).textContent(),await page.evaluate(()=>formatMicro(40000000,document.documentElement.lang)));
        const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));assert.ok(metrics.scroll<=metrics.width,JSON.stringify(metrics));
        if(language==='en')await page.screenshot({path:path.join(evidence,`candles-${width}.png`),fullPage:true});
        await page.locator('.chart summary').click();
      }
      await page.evaluate(()=>window.candleQA.render([]));
      assert.equal(await page.locator('#market-last-match').getAttribute('data-match-time'),null);
      assert.equal(await page.locator('#market-last-match').getAttribute('data-match-id'),null);
      assert.equal(await page.locator('#market-last-match').getAttribute('data-match-digest'),null);
      assert.equal(await page.locator('#market-last-match').textContent(),await page.evaluate(()=>YNXExchangeLocale.text('market-no-matches')));
      assert.equal(requests,0,'local returned-data visualization must not fetch/sign/order');assert.equal(page.context().pages().length,1);await page.close();
    }
    t.diagnostic(`CONTROLLED LOCAL DISPLAY ONLY; screenshots=${evidence}`);
  }finally{await browser.close()}
});

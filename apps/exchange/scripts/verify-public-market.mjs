// Direct canonical public guest readback only. No Wallet/account/sign/order.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateSnapshot,aggregateRetainedCandles} from '../web/market-data.js';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
const {chromium}=createRequire(new URL('../tests/browser.test.mjs',import.meta.url))('playwright');
const origin='https://exchange.ynxweb4.com',hash=b=>createHash('sha256').update(b).digest('hex');
async function read(path){
  const response=await fetch(origin+path,{signal:AbortSignal.timeout(15000),redirect:'error'}),body=Buffer.from(await response.arrayBuffer());
  if(response.status!==200||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Public JSON read unavailable: '+path);
  return {receipt:{path,status:response.status,bytes:body.length,sha256:hash(body)},value:JSON.parse(body.toString())};
}
const version=await read('/api/version'),snapshot=await read('/api/v1/market-data/snapshot');
validateSnapshot(snapshot.value);
const report={observedAt:new Date().toISOString(),scope:'PUBLIC_GUEST_MARKET_READ_ONLY',version:version.value,versionReceipt:version.receipt,snapshotReceipt:snapshot.receipt,source:snapshot.value.sourceMetadata,revision:snapshot.value.revision,trades:snapshot.value.trades.length,bids:snapshot.value.orderBook.bids.length,asks:snapshot.value.orderBook.asks.length,retainedCandles:[60000,300000,3600000].map(interval=>({interval,count:aggregateRetainedCandles(snapshot.value.trades,interval).length})),accountRequested:false,signatureRequested:false,orderSubmitted:false};
const browser=await chromium.launch(await financeBrowserLaunchOptions());
try{
  const page=await browser.newPage(),errors=[],blocked=[];page.on('pageerror',e=>errors.push(e.name+': '+e.message));
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    // Older runtimes may auto-start browser SSO: prevent this audit from
    // following authentication redirects or making any write at all.
    if(!['GET','HEAD','OPTIONS'].includes(request.method())||url.pathname==='/sso/start'||url.pathname==='/sso/callback'){
      blocked.push({method:request.method(),path:url.pathname});return route.abort();
    }
    return route.continue();
  });
  const response=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#market-source')?.textContent.includes('exchange-public-state-v1'),{},{timeout:15000});
  await page.locator('#public-trades tr').first().waitFor({timeout:15000});
  report.page={status:response.status(),url:page.url(),language:await page.locator('html').getAttribute('lang'),tabs:page.context().pages().length,visibleTrades:await page.locator('#public-trades tr').count(),chartEmptyVisible:await page.locator('#chart-empty').isVisible(),intervalControl:await page.locator('#chart-interval').count(),traceRows:await page.locator('#candle-records tr').count(),uncaughtErrors:errors,blockedAuthOrWrites:blocked};
  const appURL=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(url=>url&&new URL(url).pathname==='/app.js'));
  if(appURL){const r=await fetch(appURL,{signal:AbortSignal.timeout(15000)}),b=Buffer.from(await r.arrayBuffer());report.publicApp={status:r.status,bytes:b.length,sha256:hash(b)}}
  report.currentCandlePublicationGate=report.page.status===200&&report.page.intervalControl===1&&(report.trades===0||!report.page.chartEmptyVisible&&report.page.traceRows>0);
  // Independently verify the owned renderer against these actual returned
  // records in a local page. This is NOT public source/runtime completion.
  const local=await browser.newPage();await local.route('**/*',route=>route.abort());
  const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const market=await readFile(new URL('../web/market-data.js',import.meta.url),'utf8');
  const renderer=app.slice(app.indexOf('function renderPublicMarket('),app.indexOf('async function reviewOrder('));
  await local.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  await local.addScriptTag({content:`${market.replace(/^export /gm,'')}const $=s=>document.querySelector(s),state={publicTrades:[]},display=v=>formatMicro(v,'en');${renderer}window.renderReturnedTrades=trades=>{state.publicTrades=trades;renderPublicMarket()};`});
  report.localOwnedRenderer={scope:'LOCAL_RENDER_OF_ACTUAL_PUBLIC_RECORDS',snapshotSha256:snapshot.receipt.sha256,intervals:[]};
  for(const expected of report.retainedCandles){
    await local.selectOption('#chart-interval',String(expected.interval));
    await local.evaluate(trades=>renderReturnedTrades(trades),snapshot.value.trades);
    const groups=await local.locator('#chart-svg g').count(),rows=await local.locator('#candle-records tr').count();
    assert.equal(groups,Math.min(60,expected.count));assert.equal(rows,groups);
    assert.equal(await local.locator('#chart-svg').getAttribute('hidden')===null,report.trades>0);
    report.localOwnedRenderer.intervals.push({interval:expected.interval,groups,traceRows:rows});
  }
  report.localOwnedRenderer.passed=true;
  report.publicMarketReadable=true;report.realWalletApproved=false;report.privateBusinessVerified=false;report.multiInstanceVerified=false;
  console.log(JSON.stringify(report,null,2));
  if(!report.currentCandlePublicationGate)process.exitCode=65;
}finally{await browser.close()}

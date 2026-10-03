// Read-only public Finance guest verification; never requests an account,
// approves a wallet/session, signs, posts an order or changes deployment.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {financeBrowserLaunchOptions} from '../tests/browser-launch-options.mjs';
const {chromium}=createRequire(new URL('../tests/owned-navigation-browser.test.mjs',import.meta.url))('playwright');
const origin='https://finance.ynxweb4.com';
const sha=value=>createHash('sha256').update(value).digest('hex');
async function publicResponse(url){
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  const body=Buffer.from(await response.arrayBuffer());
  return {url,status:response.status,bytes:body.length,sha256:sha(body),mime:response.headers.get('content-type'),body};
}
const report={observedAt:new Date().toISOString(),scope:'PUBLIC_GUEST_READ_ONLY',accountRequested:false,signatureRequested:false,transactionRequested:false};
for(const name of ['version','health']){
  const {body,...receipt}=await publicResponse(`${origin}/${name}`);
  assert.equal(receipt.status,200);assert.ok(receipt.mime?.includes('application/json'));
  report[name]=receipt;if(name==='version')report.versionBody=JSON.parse(body.toString());
}
const browser=await chromium.launch(await financeBrowserLaunchOptions());
try{
  const page=await browser.newPage(),errors=[],blockedMethods=[];
  page.on('pageerror',error=>errors.push(error.name+': '+error.message));
  await page.route('**/*',route=>{
    if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){blockedMethods.push(route.request().method());return route.abort()}
    return route.continue();
  });
  const response=await page.goto(origin+'/',{waitUntil:'networkidle',timeout:30000});
  assert.equal(response.status(),200);assert.equal(await page.locator('html').getAttribute('lang'),'en');
  report.initial={url:page.url(),title:await page.title(),lang:'en',tabs:page.context().pages().length};
  const publicApp=await page.evaluate(()=>[...document.scripts].map(script=>script.src).find(url=>url&&new URL(url).pathname==='/app.js'));
  assert.ok(publicApp&&new URL(publicApp).origin===origin);
  const {body,...asset}=await publicResponse(publicApp),local=await readFile(new URL('../web/app.js',import.meta.url));
  assert.equal(asset.status,200);assert.equal(new URL(publicApp).searchParams.get('v'),asset.sha256);
  report.app={...asset,localBytes:local.length,localSha256:sha(local),matchesOwnerApp:body.equals(local)};
  const publicSource=body.toString();
  report.ordinaryFixSourceMarkers={strictReceiptAvailability:publicSource.includes('status.available!==true'),planningRowGuard:publicSource.includes('function readablePlanningRecord('),localizedReminderCycle:publicSource.includes("financeText(r.schedule+'Label')")};
  report.languages=[];
  for(const lang of await page.locator('#finance-language option').evaluateAll(options=>options.map(option=>option.value))){
    await page.selectOption('#finance-language',lang);
    assert.equal(await page.locator('html').getAttribute('lang'),lang);
    assert.equal(await page.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');
    report.languages.push(lang);
  }
  await page.selectOption('#finance-language','en');
  await page.reload({waitUntil:'networkidle',timeout:30000});
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(page.context().pages().length,1);assert.deepEqual(errors,[]);assert.deepEqual(blockedMethods,[]);
  report.reload={url:page.url(),lang:'en',tabs:1,uncaughtPageErrors:errors,blockedWriteRequests:blockedMethods};
  report.guestVerified=true;report.ownerSourcePublished=report.app.matchesOwnerApp;
  report.providerApprovalVerified=false;report.privateBusinessVerified=false;report.nativeInstalledVerified=false;
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}

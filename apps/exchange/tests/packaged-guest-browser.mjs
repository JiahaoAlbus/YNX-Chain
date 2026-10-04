import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {verifyRuntimeCandidate} from '../scripts/verify-runtime-candidate.mjs';
const [archivePath,commit]=process.argv.slice(2),root=path.resolve(import.meta.dirname,'../../..');
const archive=await readFile(archivePath),verified=verifyRuntimeCandidate(archive,commit,name=>execFileSync('git',['show',`${commit}:${name}`],{cwd:root}));
const tar=gunzipSync(archive),assets=new Map();
for(let pos=0;pos+512<=tar.length&&!tar.subarray(pos,pos+512).every(b=>b===0);){
  const name=tar.subarray(pos,pos+100).toString().replace(/\0.*$/s,''),size=parseInt(tar.subarray(pos+124,pos+136).toString().replace(/\0.*$/s,'').trim(),8);
  if(name.includes('/apps/exchange/web/'))assets.set('/'+name.split('/apps/exchange/web/')[1],tar.subarray(pos+512,pos+512+size));
  pos+=512+Math.ceil(size/512)*512;
}
const browser=await chromium.launch(await financeBrowserLaunchOptions()),results=[];
try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),requests=[],errors=[],served=new Set();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url()),name=url.pathname==='/'?'/index.html':url.pathname;
    if(url.origin==='https://exchange.example'&&assets.has(name)){
      served.add(name);const mime=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html';
      return route.fulfill({contentType:mime,body:assets.get(name)});
    }
    // Deliberate controlled unavailable service; no invented market, account,
    // grant, order or chain data. This is local packaged-renderer evidence only.
    return route.fulfill({status:503,contentType:'application/json',body:'{"error":"API_UNAVAILABLE"}'});
  });
  await page.goto('https://exchange.example/#market');
  await page.waitForFunction(()=>window.YNXExchangeWebWallet&&document.querySelector('#venue-config-retry'));
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.waitForFunction(()=>document.querySelector('.brand img').complete&&document.querySelector('.brand img').naturalWidth>0);
  await page.locator('#connect').click();
  for(const kind of ['ynx-wallet','metamask']){
    await page.locator('#connect-'+kind).click();
    await page.waitForFunction(()=>!document.querySelector('#wallet-fallback').hidden);
    assert.equal(page.url(),'https://exchange.example/#market');assert.equal(context.pages().length,1);
    assert.equal(await page.locator('#wallet-fallback a').nth(0).getAttribute('href'),'https://www.ynxweb4.com/dapp/download');
    assert.equal(await page.locator('#wallet-fallback a').nth(1).getAttribute('href'),'https://metamask.io/download/');
  }
  await page.locator('#wallet-dialog .close').click();
  await page.locator('[data-view="assets"]').click();
  await page.locator('#withdraw-destination').fill('ynx1unsentdraft');
  await page.locator('#withdraw-amount').fill('1');
  assert.equal(await page.locator('#withdraw-fee').textContent(),'—');
  await page.locator('#venue-config-retry').click();
  assert.equal(await page.locator('#withdraw-destination').inputValue(),'ynx1unsentdraft');
  await page.reload();await page.waitForFunction(()=>window.YNXExchangeWebWallet);
  assert.equal(context.pages().length,1);assert.deepEqual(errors,[]);
  assert.equal(requests.filter(r=>r.method!=='GET').length,0);
  assert.equal(requests.filter(r=>r.url.startsWith('ynxwallet:')).length,0);
  for(const name of assets.keys())if(name!=='/ynx-favicon.png')assert.ok(served.has(name),`unloaded packaged asset ${name}`);
  results.push({width,loadedAssets:[...served].sort(),pageErrors:errors,nonGetRequests:0,tabCount:1,defaultEnglish:true,logoDecoded:true,noProviderFallback:true,reload:true,publicProof:false,walletApproval:false});
  await context.close();
}}finally{await browser.close()}
console.log(JSON.stringify({sourceCommit:commit,archiveSha256:verified.archiveSha256,results,installed:false,deployedPublic:false},null,2));

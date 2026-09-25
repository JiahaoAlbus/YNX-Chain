import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';
import {verifyFinanceVersionedAssets} from '../web/verify-versioned-assets.mjs';

const web=join(dirname(fileURLToPath(import.meta.url)),'../web');
const read=name=>readFileSync(join(web,name));
const html=read('index.html').toString('utf8');
const oldCommit='94e6997f4d817233d93f9b4a96fc51b5f31e98bf';
const oldAsset=name=>execFileSync('git',['show',`${oldCommit}:apps/finance/web/${name}`],{cwd:join(web,'../../..'),stdio:['ignore','pipe','ignore']});

test('every Finance browser dependency is pinned to its exact content URL',()=>{
  assert.deepEqual(verifyFinanceVersionedAssets(html,read),{status:'pass',assets:12,versionedReferences:13});
  assert.throws(()=>verifyFinanceVersionedAssets(html.replace(/wallet-auth\.js\?v=[0-9a-f]{64}/u,'wallet-auth.js'),read),/FINANCE_ASSET_HASH_MISMATCH:wallet-auth.js/u);
  assert.throws(()=>verifyFinanceVersionedAssets(html.replace(/wallet-auth\.js\?v=[0-9a-f]{64}/u,'wallet-auth.js?v='+'0'.repeat(64)),read),/FINANCE_ASSET_HASH_MISMATCH:wallet-auth.js/u);
  assert.throws(()=>verifyFinanceVersionedAssets(html.replace('</body>','<script src="/wallet-auth.js?v=30bbe997959706e287228588446aa34f68d8c75c998f6df9d0e82314fb9d21b6"></script></body>'),read),/FINANCE_ASSET_BINDING_MISSING_OR_DUPLICATE:wallet-auth.js/u);
});

test('normal Chrome reload upgrades from an immutable cached old Wallet URL to the new content URL',async()=>{
  let release='old';
  const requests=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    requests.push(url.pathname+url.search);
    if(url.pathname==='/'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      return res.end(release==='old'?'<!doctype html><html><body><script src="/wallet-auth.js" defer></script></body></html>':html);
    }
    if(url.pathname==='/wallet-auth.js'&&release==='old'){
      res.writeHead(200,{'content-type':'text/javascript','cache-control':'public, max-age=31536000, immutable'});
      return res.end('window.__oldWalletBundleLoaded=true;');
    }
    if(!/^\/[a-z0-9.-]+$/u.test(url.pathname)){
      res.writeHead(404);return res.end();
    }
    try{
      const bytes=read(url.pathname.slice(1));
      const type=url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.webmanifest')?'application/manifest+json':'text/plain';
      res.writeHead(200,{'content-type':type,'cache-control':'public, max-age=31536000, immutable'});
      res.end(bytes);
    }catch{res.writeHead(404);res.end();}
  });
  let browser;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch(await financeBrowserLaunchOptions());
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.evaluate(()=>window.__oldWalletBundleLoaded),true);
    release='new';
    await page.reload();
    await page.waitForFunction(()=>Boolean(window.YNXFinanceWallet?.ready));
    assert.equal(await page.locator('#connect-hosted-ynx').count(),1);
    assert.equal(page.context().pages().length,1);
    assert.equal(requests.filter(path=>path==='/wallet-auth.js').length,1);
    assert.equal(requests.filter(path=>path==='/wallet-auth.js?v=30bbe997959706e287228588446aa34f68d8c75c998f6df9d0e82314fb9d21b6').length,1);
    await page.close();
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
});

test('real 94e Finance assets on the exact origin gain Hosted popup after normal source upgrade',async()=>{
  assert.equal(oldAsset('wallet-auth.js').length,182014);
  let release='94e';
  const requests=[];
  let browser;
  try{
    browser=await chromium.launch(await financeBrowserLaunchOptions());
    const context=await browser.newContext();
    await context.route('https://finance.ynxweb4.com/**',route=>{
      const url=new URL(route.request().url());
      requests.push(url.pathname+url.search);
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!/^[a-z0-9.-]+$/u.test(name))return route.fulfill({status:404,body:''});
      try{
        const body=release==='94e'?oldAsset(name):read(name);
        const contentType=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.webmanifest')?'application/manifest+json':'text/html';
        return route.fulfill({status:200,body,contentType,headers:{'cache-control':name==='index.html'?'no-store':'public, max-age=31536000, immutable'}});
      }catch{return route.fulfill({status:404,body:''});}
    });
    await context.route('https://wallet.ynxweb4.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Wallet popup isolated test</title>'}));
    const page=await context.newPage();
    await page.goto('https://finance.ynxweb4.com/');
    await page.waitForFunction(()=>Boolean(window.YNXFinanceWallet?.ready));
    assert.equal(await page.locator('#connect-hosted-ynx').count(),0);
    await page.locator('#connect-ynx').click();
    await page.waitForFunction(()=>window.YNXFinanceWallet?.getStandardWalletState().status==='unavailable');
    assert.equal(context.pages().length,1);
    assert.equal(requests.filter(path=>path==='/wallet-auth.js').length,1);
    release='new';
    await page.reload();
    await page.waitForFunction(()=>Boolean(window.YNXFinanceWallet?.ready));
    assert.equal(await page.locator('#connect-hosted-ynx').count(),1);
    const popupPromise=context.waitForEvent('page');
    await page.locator('#connect-hosted-ynx').click();
    const popup=await popupPromise;
    await popup.waitForURL(/^https:\/\/wallet\.ynxweb4\.com\/hosted\/#connect=/u);
    assert.match(popup.url(),/^https:\/\/wallet\.ynxweb4\.com\/hosted\/#connect=/u);
    assert.equal(requests.filter(path=>path==='/wallet-auth.js').length,1);
    assert.equal(requests.filter(path=>path==='/wallet-auth.js?v=30bbe997959706e287228588446aa34f68d8c75c998f6df9d0e82314fb9d21b6').length,1);
    await context.close();
  }finally{
    await browser?.close();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

// This runs the real Finance page and Wallet-owned hosted approval UI on their
// exact HTTPS origins. The route is local, so no public/installed claim follows.
const walletDist=process.env.YNX_FINANCE_HOSTED_WALLET_DIST;
const financeWeb=fileURLToPath(new URL('../web/',import.meta.url));
const {build}=createRequire(resolve(financeWeb,'package.json'))('esbuild');
const account=/^0x[0-9a-f]{40}$/u;
const password='synthetic Finance QA password 2026';

async function routeExact(context,bundle){
  await context.route(/^https:\/\/(?:finance|wallet)\.ynxweb4\.com\//u,async route=>{
    const url=new URL(route.request().url());
    const isWallet=url.origin==='https://wallet.ynxweb4.com';
    const pathname=isWallet?(url.pathname==='/hosted/'?'index.html':url.pathname.replace(/^\/hosted\//u,'')):(url.pathname==='/'?'index.html':url.pathname.slice(1));
    if(!/^[a-z0-9.-]+$/u.test(pathname))return route.fulfill({status:404,body:''});
    if(!isWallet&&pathname==='wallet-auth.js')return route.fulfill({status:200,contentType:'text/javascript',body:Buffer.from(bundle)});
    if(!isWallet&&pathname==='health')return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"chainId":"ynx_6423-1"}'});
    const allowed=isWallet?['index.html','app.js','hosted-wallet.css','ynx-logo.png']:
      ['index.html','app.js','styles.css','finance-locale.js','wallet-auth.js','order-wallet.js','order-opaque.js','evm-read-session.js','evm-subject.js','read-sources.js','product-catalog.js','ynx-logo.png','favicon.ico'];
    if(!allowed.includes(pathname))return route.fulfill({status:404,body:''});
    try{
      const body=await readFile(resolve(isWallet?walletDist:financeWeb,pathname));
      const contentType=pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.png')?'image/png':'text/html';
      return route.fulfill({status:200,contentType,body});
    }catch{return route.fulfill({status:404,body:''});}
  });
}

test('Finance production DOM consumes Hosted Wallet approval, login rejection, refresh and private isolation',
  {skip:!walletDist&&'YNX_FINANCE_HOSTED_WALLET_DIST not set'},async()=>{
    const built=await build({absWorkingDir:financeWeb,entryPoints:['wallet-auth-entry.js'],outfile:'wallet-auth.js',bundle:true,minify:true,platform:'browser',target:'es2022',write:false});
    const bundle=await readFile(resolve(financeWeb,'wallet-auth.js'));
    assert.deepEqual(bundle,Buffer.from(built.outputFiles[0].contents),'shipped Finance bundle must match its source entry');
    const browser=await chromium.launch(await financeBrowserLaunchOptions());
    try{
      const context=await browser.newContext({acceptDownloads:true,ignoreHTTPSErrors:true,serviceWorkers:'block'});
      await context.route('**/*',route=>route.abort());
      await routeExact(context,bundle);
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      const seen=[],responses=[],failed=[];page.on('request',request=>seen.push(request.url()));page.on('response',response=>responses.push(`${response.status()} ${response.url()}`));page.on('requestfailed',request=>failed.push(`${request.url()} ${request.failure()?.errorText}`));
      try{await page.goto('https://finance.ynxweb4.com/',{waitUntil:'commit',timeout:10000});}
      catch(error){throw new Error(`Finance route did not load: ${seen.join(', ')}`,{cause:error});}
      try{await page.waitForFunction(()=>Boolean(window.YNXFinanceWallet?.ready),null,{timeout:10000});}
      catch(error){throw new Error(JSON.stringify({responses,failed,errors,html:(await page.content()).slice(0,250)}),{cause:error});}
      await page.evaluate(()=>window.YNXFinanceWallet.ready);
      assert.equal(await page.locator('#connect-hosted-ynx').isVisible(),true);
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.connected()),false);
      const popupPromise=context.waitForEvent('page');
      await page.locator('#connect-ynx').click();
      const wallet=await popupPromise;
      await wallet.locator('#setup').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connecting');
      await wallet.locator('#setup-password').fill(password);
      await wallet.locator('#setup-confirm').fill(password);
      await wallet.locator('#setup-form button[type=submit]').click();
      await wallet.locator('#backup-confirmation').waitFor({state:'visible'});
      const download=wallet.waitForEvent('download');
      await wallet.locator('#export-backup').click();await download;
      await wallet.locator('#backup-ack').check();await wallet.locator('#backup-continue').click();
      await wallet.locator('#review').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connecting');
      await wallet.locator('#approve').click();
      await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='connected');
      const selected=await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState());
      assert.match(selected.account,account);
      assert.equal(selected.chainId,'0x1917');assert.equal(selected.providerKind,'ynx-wallet');
      assert.equal(selected.transport,'hosted-wallet-web');
      assert.match(await page.locator('#wallet-state').textContent(),/ynx1.*EVM 0x/u);
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.connected()),false);
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getPrivateState().status)!=='connected',true);
      assert.equal(await page.locator('#wallet-choice').isHidden(),true);
      assert.equal(await page.locator('#wallet-revoke').isHidden(),true);
      assert.equal(page.url(),'https://finance.ynxweb4.com/');
      assert.equal(await page.locator('#evm-read-begin').getAttribute('hidden'),null);
      await page.locator('#finance-language').selectOption('zh-CN');
      assert.match(await page.locator('#hosted-wallet-state').textContent(),/已批准/u);
      for(const locale of ['zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
        await page.locator('#finance-language').selectOption(locale);
        assert.equal(await page.evaluate(()=>document.documentElement.lang),locale);
        assert.doesNotMatch(await page.locator('#hosted-wallet-state').textContent(),/hostedConnected|privateAccountMismatch/u);
      }
      await page.locator('#finance-language').selectOption('en');
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(context.pages().length,2);
      const requestId='finance-login-'+'a'.repeat(32);
      await page.route('**/api/wallet-login/challenges',route=>route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({schemaVersion:'finance-evm-login-challenge-v1',privateFinanceAuthorized:false,challenge:{account:selected.account,providerKind:'ynx-wallet',chainId:6423,productId:'finance',scopes:['finance.account.read'],requestId,expirationTime:'2030-01-01T00:00:00.000Z'},signingRequest:{method:'personal_sign',message:'LOCAL',params:['0x4c4f43414c',selected.account]}})}));
      let verificationCount=0,postedProof=null;
      await page.route('**/api/wallet-login/verify',route=>{verificationCount++;postedProof=route.request().postDataJSON()?.proof;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schemaVersion:'finance-evm-login-verification-v1',verified:true,account:selected.account,providerKind:'ynx-wallet',chainId:6423,scopes:['finance.account.read'],requestId,privateFinanceAuthorized:false,standardWalletUnchanged:true})});});
      await page.locator('#wallet-more').evaluate(element=>{element.open=true});
      await page.locator('#wallet-login-verify').click();
      await wallet.locator('#review').waitFor({state:'visible'});
      await wallet.locator('#reject').click();
      await page.waitForFunction(()=>document.querySelector('#wallet-login-state').textContent.includes('not verified'));
      assert.equal(verificationCount,0);
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.connected()),false);
      await page.locator('#wallet-login-verify').click();
      await wallet.locator('#review').waitFor({state:'visible'});
      await wallet.locator('#approval-password').fill(password);
      await wallet.locator('#approve').click();
      await page.waitForFunction(()=>document.querySelector('#wallet-login-state').textContent.includes('verified.'));
      assert.equal(verificationCount,1);
      assert.equal(postedProof.challenge.account,selected.account);
      assert.match(postedProof.signature,/^0x[0-9a-f]{130}$/u);
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.connected()),false);
      await page.reload();await page.evaluate(()=>window.YNXFinanceWallet.ready);
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');
      assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.connected()),false);
      assert.equal(context.pages().length,2);
      assert.deepEqual(errors,[]);
      await context.close();
    }finally{await browser.close();}
  });

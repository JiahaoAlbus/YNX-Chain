import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {privateSessionCopy,privateSessionLocales} from '../web/private-session-copy.js';

// Product UI lifecycle only; HTTP identity responses are simulated. Real TLS
// cookie/PKCE/native proof/durable ownership is independently tested in Go.
const ORIGIN='https://quant.ynxweb4.com',ACCOUNT='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';
const built=await build({stdin:{contents:"import * as identity from './browser-sso.js';window.identityQA=identity;identity.mountBrowserSSO();",resolveDir:fileURLToPath(new URL('../web/',import.meta.url))},bundle:true,write:false,format:'iife',platform:'browser'});
test('bounded top-level quiet recovery preserves target, never requests Wallet approval, and guest return cannot bounce',async()=>{
  const browser=await chromium.launch({headless:true});try{for(const activeRoot of [false,true]){
    const context=await browser.newContext(),page=await context.newPage();let restored=false,attempted=false,starts=0;
    const html='<nav><button data-view="risk" class="active"></button></nav><select id="locale"></select><button id="browser-signin"></button><button id="browser-signout"></button><small id="browser-identity"></small><script src="/bundle.js"></script>';
    await page.addInitScript(()=>{window.walletRequests=0;window.ethereum={request(){window.walletRequests++;throw new Error('automatic Wallet request forbidden')}}});
    await context.route('**/*',route=>{const url=new URL(route.request().url());assert.equal(url.origin,ORIGIN);
      if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:Buffer.from(built.outputFiles[0].contents)});
      if(url.pathname==='/api/v1/sso/config')return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:true,silentRestoreAllowed:!attempted})});
      if(url.pathname==='/api/v1/sso/account')return route.fulfill({status:restored?200:401,contentType:'application/json',body:JSON.stringify(restored?{signedIn:true,account:ACCOUNT,csrfToken:'fixture-csrf',privateWorkspaceAuthorized:false}:{code:'SSO_LOGIN_REQUIRED'})});
      if(url.pathname==='/sso/start'){starts++;assert.equal(url.searchParams.get('prompt'),'none');assert.equal(url.searchParams.get('target'),'risk');attempted=true;restored=activeRoot;
        // UI-only callback transport fixture. Actual 303/PKCE/cookie authority
        // is tested through TLS product + NodeHost in the Go regression.
        return route.fulfill({contentType:'text/html',body:'<script>location.replace("/#risk")</script>'});}
      return route.fulfill({contentType:'text/html',body:(attempted?'<body data-returned="true">':'')+html});
    });
    const handoff=page.waitForResponse(response=>new URL(response.url()).pathname==='/sso/start');await page.goto(ORIGIN+'/#risk');await handoff;await page.waitForLoadState('networkidle');await page.waitForFunction(()=>document.querySelector('#browser-signin')?.disabled===false);await page.evaluate(()=>window.identityQA.recheckBrowserIdentity());
    assert.equal(starts,1);assert.equal(await page.evaluate(()=>window.walletRequests),0);assert.equal(new URL(page.url()).hash,'#risk');
    if(activeRoot)assert.match(await page.locator('#browser-identity').textContent(),/ynx1/);else assert.equal(await page.locator('#browser-signout').isHidden(),true);
    await page.reload();await page.waitForFunction(()=>!document.querySelector('#browser-signin').disabled);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.evaluate(()=>window.identityQA.recheckBrowserIdentity());assert.equal(starts,1);assert.equal(await page.evaluate(()=>window.walletRequests),0);
    await context.close();
  }}finally{await browser.close();}
});
test('identity UI rechecks without authorization, preserves service-failure state, and product logout stays signed out until explicit action',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),context=await browser.newContext(),page=await context.newPage();
  let signedIn=true,unavailable=false,starts=0;
  try{
    await context.route('**/*',route=>{
      const r=route.request(),url=new URL(r.url());assert.equal(url.origin,ORIGIN);
      if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:Buffer.from(built.outputFiles[0].contents)});
      if(url.pathname==='/api/v1/sso/config')return route.fulfill({contentType:'application/json',body:'{"enabled":true}'});
      if(url.pathname==='/api/v1/sso/account')return route.fulfill({status:unavailable?503:signedIn?200:401,contentType:'application/json',body:JSON.stringify(signedIn&&!unavailable?{signedIn:true,account:ACCOUNT,csrfToken:'fixture-csrf',privateWorkspaceAuthorized:false}:{code:'SSO_LOGIN_REQUIRED'})});
      if(url.pathname==='/api/v1/sso/logout'){assert.equal(r.method(),'POST');assert.equal(r.headers().origin,ORIGIN);assert.equal(r.headers()['x-ynx-sso-csrf'],'fixture-csrf');signedIn=false;return route.fulfill({contentType:'application/json',body:'{"revoked":true}'});}
      if(url.pathname==='/sso/start'){starts++;assert.equal(url.searchParams.get('target'),'risk');return route.fulfill({contentType:'text/html',body:'Explicit registered-target handoff fixture'});}
      return route.fulfill({contentType:'text/html',body:'<nav><button data-view="risk" class="active"></button></nav><select id="locale"></select><button id="browser-signin"></button><button id="browser-signout"></button><small id="browser-identity"></small><script src="/bundle.js"></script>'});
    });
    await page.goto(ORIGIN);await page.waitForFunction(()=>document.getElementById('browser-identity').textContent.includes('ynx1'));
    assert.equal(starts,0);assert.equal(await page.locator('#browser-signin').isHidden(),true);
    for(const locale of privateSessionLocales){await page.evaluate(value=>{localStorage.setItem('ynx.quant.locale',value);document.getElementById('locale').dispatchEvent(new Event('change'));},locale);assert.equal(await page.locator('#browser-signout').textContent(),privateSessionCopy(locale).identitySignOut);}
    unavailable=true;await page.evaluate(()=>window.identityQA.recheckBrowserIdentity());assert.match(await page.locator('#browser-identity').textContent(),/ynx1/);assert.equal(starts,0);
    unavailable=false;await page.locator('#browser-signout').click();await page.waitForFunction(()=>localStorage.getItem('ynx.quant.browser-identity.explicit-logout.v1')==='true');
    await page.reload();await page.waitForFunction(()=>!document.getElementById('browser-signin').disabled);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.evaluate(()=>window.identityQA.recheckBrowserIdentity());assert.equal(starts,0);assert.equal(await page.locator('#browser-signout').isHidden(),true);
    await page.locator('#browser-signin').click();await page.waitForURL(ORIGIN+'/sso/start?target=risk');assert.equal(starts,1);assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.browser-identity.explicit-logout.v1')),null);
  }finally{await context.close();await browser.close();}
});

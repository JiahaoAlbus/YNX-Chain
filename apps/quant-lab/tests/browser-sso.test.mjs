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
test('native Chrome identity streams bound bytes, decode split UTF8 and cancel malformed or retired reads',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),page=await browser.newPage();
  try{
    await page.route('**/*',route=>new URL(route.request().url()).pathname==='/bundle.js'?route.fulfill({contentType:'text/javascript',body:Buffer.from(built.outputFiles[0].contents)}):route.fulfill({contentType:'text/html',body:'<script src="/bundle.js"></script>'}));
    await page.goto(ORIGIN);
    const results=await page.evaluate(async()=>{
      const encode=value=>new TextEncoder().encode(value),read=window.identityQA.readBrowserIdentityResponse;
      let cancels=0,pulls=0;
      const over=new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(encode('中'.repeat(6000)))},cancel(){cancels++}}),{headers:{'content-type':'application/json'}});
      let overError;try{await read(over,new AbortController().signal)}catch(error){overError=error.message}
      const bytes=encode('{"text":"中文"}');const split=new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,10));controller.enqueue(bytes.slice(10));controller.close()}}),{headers:{'content-type':'application/json'}});
      const splitText=await read(split,new AbortController().signal);
      const failures=[];for(const bytes of [new Uint8Array([255]),new Uint8Array([228,184])]){try{await read(new Response(bytes,{headers:{'content-type':'application/json'}}),new AbortController().signal)}catch(error){failures.push(error.message)}}
      for(const length of ['-1','1.5','16385']){try{await read(new Response('{}',{headers:{'content-type':'application/json','content-length':length}}),new AbortController().signal)}catch(error){failures.push(error.message)}}
      let abortCancels=0;const controller=new AbortController(),stalled=new Response(new ReadableStream({cancel(){abortCancels++}}),{headers:{'content-type':'application/json'}}),pending=read(stalled,controller.signal);controller.abort();let abortError;try{await pending}catch(error){abortError=error.message}
      return {overError,cancels,pulls,splitText,failures,abortError,abortCancels};
    });
    assert.equal(results.overError,'IDENTITY_UNAVAILABLE');assert.equal(results.cancels,1);assert.ok(results.pulls<=2);assert.equal(results.splitText,'{"text":"中文"}');assert.deepEqual(results.failures,Array(5).fill('IDENTITY_UNAVAILABLE'));assert.equal(results.abortError,'IDENTITY_UNAVAILABLE');assert.equal(results.abortCancels,1);
  }finally{await browser.close()}
});
test('real Chrome retires late identity reads at logout, coalesces exit and permits an unconfirmed retry',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{for(const oldStatus of [200,401,503]){
    const context=await browser.newContext(),page=await context.newPage(),reads=[],logouts=[];let hold=false,readCount=0;
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{window.identityChanges=0;window.addEventListener('ynx:quant-wallet-context',event=>{if(event.detail?.identityChanged)window.identityChanges++})});
    await context.route('**/*',async route=>{
      const r=route.request(),url=new URL(r.url());assert.equal(url.origin,ORIGIN);
      if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:Buffer.from(built.outputFiles[0].contents)});
      if(url.pathname==='/api/v1/sso/config')return route.fulfill({json:{enabled:true}});
      if(url.pathname==='/api/v1/sso/account'){
        readCount++;const body={signedIn:true,account:ACCOUNT,csrfToken:'fixture-csrf',privateWorkspaceAuthorized:false};
        if(hold){await new Promise(resolve=>reads.push(resolve));return route.fulfill({status:oldStatus,json:oldStatus===200?body:{code:'SSO_LOGIN_REQUIRED'}})}
        return route.fulfill({json:body});
      }
      if(url.pathname==='/api/v1/sso/logout'){
        assert.equal(r.method(),'POST');assert.equal(r.headers()['x-ynx-sso-csrf'],'fixture-csrf');assert.equal(r.postData(),'{}');
        const response=await new Promise(resolve=>logouts.push(resolve));return route.fulfill(response);
      }
      return route.fulfill({contentType:'text/html',body:'<button id="browser-signin"></button><button id="browser-signout"></button><small id="browser-identity"></small><script src="/bundle.js"></script>'});
    });
    await page.goto(ORIGIN);await page.waitForFunction(()=>document.getElementById('browser-identity').textContent.includes('ynx1'));
    hold=true;await page.evaluate(()=>{window.oldIdentityRead=identityQA.recheckBrowserIdentity()});
    for(let i=0;!reads.length&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(reads.length,1);
    const coalesced=await page.evaluate(()=>{window.logoutPending=identityQA.signOutBrowserIdentity();return logoutPending===identityQA.signOutBrowserIdentity()&&logoutPending===identityQA.recheckBrowserIdentity()});assert.equal(coalesced,true);
    for(let i=0;!logouts.length&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(logouts.length,1);assert.equal(await page.locator('#browser-signout').isDisabled(),true);
    const before=readCount;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(readCount,before);
    if(oldStatus===503){
      logouts[0]({status:503,json:{revoked:false}});await page.evaluate(()=>logoutPending);assert.match(await page.locator('#browser-identity').textContent(),/ynx1/);assert.equal(await page.locator('#browser-signout').isEnabled(),true);assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.browser-identity.explicit-logout.v1')),null);
      await page.evaluate(()=>{window.logoutPending=identityQA.signOutBrowserIdentity()});for(let i=0;logouts.length<2&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(logouts.length,2);logouts[1]({json:{revoked:true}});
    }else logouts[0]({json:{revoked:true}});
    await page.evaluate(()=>logoutPending);reads[0]();await page.evaluate(()=>oldIdentityRead);
    assert.equal(await page.locator('#browser-signout').isHidden(),true);assert.doesNotMatch(await page.locator('#browser-identity').textContent(),/ynx1/);assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.browser-identity.explicit-logout.v1')),'true');assert.equal(context.pages().length,1);assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>window.identityChanges),1,'one confirmed logout event; no retired read can fire an old account event');
    await context.close();
  }}finally{await browser.close()}
});
test('guest identity rechecks preserve research drafts and target without automatic SSO or Wallet requests',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
    const context=await browser.newContext(),page=await context.newPage();let accountStatus=401,configStatus=200,starts=0,writes=0;
    const html='<nav><button data-view="risk" class="active"></button></nav><input id="strategy"><input id="fee"><select id="locale"></select><button id="browser-signin"></button><button id="browser-signout"></button><small id="browser-identity"></small><script src="/bundle.js"></script>';
    await page.addInitScript(()=>{window.walletRequests=0;window.ethereum={request(){window.walletRequests++;throw new Error('automatic Wallet request forbidden')}}});
    await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,ORIGIN);if(request.method()!=='GET')writes++;
      if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:Buffer.from(built.outputFiles[0].contents)});
      if(url.pathname==='/api/v1/sso/config')return route.fulfill({status:configStatus,contentType:'application/json',body:JSON.stringify({enabled:true,silentRestoreAllowed:true})});
      if(url.pathname==='/api/v1/sso/account')return route.fulfill({status:accountStatus,contentType:'application/json',body:JSON.stringify(accountStatus===200?{signedIn:true,account:ACCOUNT,csrfToken:'fixture-csrf',privateWorkspaceAuthorized:false}:{code:'SSO_LOGIN_REQUIRED'})});
      if(url.pathname==='/sso/start'){starts++;assert.equal(url.searchParams.has('prompt'),false);assert.equal(url.searchParams.get('target'),'risk');return route.fulfill({contentType:'text/html',body:'Explicit fixed SSO target fixture'});}
      return route.fulfill({contentType:'text/html',body:html});
    });
    await page.goto(ORIGIN+'/#risk');await page.waitForFunction(()=>document.querySelector('#browser-signin')?.disabled===false);await page.locator('#strategy').fill('Unsubmitted research');await page.locator('#fee').fill('17');
    for(const status of [401,403,503,401]){
      accountStatus=status;await page.evaluate(()=>window.identityQA.recheckBrowserIdentity());assert.equal(starts,0);assert.equal(page.url(),ORIGIN+'/#risk');assert.equal(await page.locator('#strategy').inputValue(),'Unsubmitted research');assert.equal(await page.locator('#fee').inputValue(),'17');assert.equal(context.pages().length,1);
    }
    accountStatus=200;await page.evaluate(()=>window.identityQA.recheckBrowserIdentity());assert.match(await page.locator('#browser-identity').textContent(),/ynx1/);assert.equal(starts,0);
    accountStatus=401;await page.evaluate(()=>window.identityQA.recheckBrowserIdentity());assert.equal(await page.locator('#browser-signout').isHidden(),true);assert.equal(await page.evaluate(()=>window.walletRequests),0);assert.equal(writes,0);
    configStatus=503;await page.reload();assert.equal(page.url(),ORIGIN+'/#risk');assert.equal(starts,0);
    configStatus=200;await page.reload();await page.waitForFunction(()=>!document.querySelector('#browser-signin').disabled);await page.locator('#browser-signin').click();await page.waitForURL(ORIGIN+'/sso/start?target=risk');assert.equal(starts,1);
    await context.close();
  }finally{await browser.close();}
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

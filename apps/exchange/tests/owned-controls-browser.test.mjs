import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
import {formatMicro} from '../web/market-data.js';

// Actual product HTML/render functions, controlled account read input only.
// No Wallet approval, authenticated API or public acceptance is claimed here.
const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../web/styles.css',import.meta.url),'utf8');
const controls=app.slice(app.indexOf('function renderPrivateAccount('),app.indexOf('function renderBook('));
const identity=app.slice(app.indexOf('let browserIdentity='),app.indexOf('\nconst marketFeed='));
const chooser=app.slice(app.indexOf('function openWalletChooser()'),app.indexOf('async function restoreStandardWallet()'));
const activity=app.slice(app.indexOf('function renderActivity()'),app.indexOf('function renderPublicMarket()'));
const activityBinding=app.split('\n').find(line=>line.includes("$$('.tabs button').forEach(b=>b.addEventListener"));

test('actual activity renderer exposes existing owned order history and signed ledger changes without write actions',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.evaluate(()=>{document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));document.querySelector('#activity').classList.add('active')});
    assert.ok(activityBinding,'test must execute the actual product tab binding');
    await page.addScriptTag({content:`const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];const state={account:'A',snapshot:null,activity:'orders'};const display=${formatMicro.toString()};${activity};${activityBinding};window.activityQA={set(account,snapshot){state.account=account;state.snapshot=snapshot;renderActivity()}};`});
    const order=(account,id,status,createdAt)=>({account,id,status,createdAt,market:'YNXT-YUSD_TEST',side:'buy',type:'limit',priceMicro:2000000,amountMicro:3000000,filledMicro:status==='filled'?3000000:0,rejectReason:status==='rejected'?'<img src=x onerror=alert(1)> rejected by venue':''});
    const data={orders:[order('A','older-cancelled','cancelled','2026-10-01T00:00:00Z'),order('A','newer-filled','filled','2026-10-02T00:00:00Z'),order('B','foreign-B','open','2026-10-03T00:00:00Z'),order('A','rejected','rejected','2026-10-02T01:00:00Z')],ledger:[{account:'A',id:'ledger-A',asset:'YUSD_TEST',availableDelta:-1234567,reservedDelta:0,sourceType:'order_cancel',sourceId:'older-cancelled',sourceDigest:'a'.repeat(64),createdAt:'2026-10-02T02:00:00Z'},{account:'B',id:'ledger-B',asset:'YNXT',availableDelta:9000000,reservedDelta:0,createdAt:'2026-10-02T03:00:00Z'}]};
    await page.evaluate(data=>window.activityQA.set('A',data),data);
    assert.equal(await page.locator('[data-activity="orders"]').count(),1);
    assert.equal(await page.locator('#activity-body tr').count(),3);
    let text=await page.locator('#activity-body').innerText();assert.match(text,/cancelled/u);assert.match(text,/filled/u);assert.match(text,/rejected/u);assert.doesNotMatch(text,/foreign-B/u);
    assert.equal(await page.locator('#activity-body img').count(),0);assert.equal(await page.locator('#activity-body button').count(),0);
    assert.match(await page.locator('#activity-body tr').first().innerText(),/rejected/u);
    await page.locator('[data-activity="ledger"]').click();text=await page.locator('#activity-body').innerText();
    assert.match(text,/-1\.234567/u);assert.match(text,/0\.00/u);assert.ok(text.includes('a'.repeat(64)));assert.doesNotMatch(text,/ledger-B/u);
    assert.equal(await page.locator('[data-activity="ledger"]').getAttribute('aria-selected'),'true');
    assert.ok((await page.locator('[data-activity="ledger"]').boundingBox()).height>=44);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    data.deposits=[{account:'A',id:'deposit-A',asset:'YNXT',network:'YNX Testnet',amountMicro:1000001,confirmations:2,required:12,status:'pending',txHash:'actual-returned-hash-fixture',sourceDigest:'b'.repeat(64),createdAt:'2026-10-02T03:00:00Z'}];
    data.withdrawals=[{account:'A',id:'withdrawal-A',asset:'YNXT',network:'YNX Testnet',amountMicro:2000000,feeMicro:0,receiveMicro:2000000,status:'pending_wallet',destination:'<script>not markup</script>',sourceDigest:'c'.repeat(64),createdAt:'2026-10-02T04:00:00Z'}];
    await page.evaluate(data=>window.activityQA.set('A',data),data);
    await page.locator('[data-activity="deposits"]').click();text=await page.locator('#activity-body').innerText();
    assert.match(text,/deposit-A/u);assert.match(text,/2 \/ 12/u);assert.match(text,/pending/u);assert.match(text,/actual-returned-hash-fixture/u);assert.doesNotMatch(text,/confirmed|completed/u);
    await page.locator('[data-activity="withdrawals"]').click();text=await page.locator('#activity-body').innerText();
    assert.match(text,/pending_wallet/u);assert.match(text,/0\.00/u);assert.equal(await page.locator('#activity-body script').count(),0);assert.equal(await page.locator('#activity-body button').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.locator('[data-activity="ledger"]').click();
    const original=JSON.stringify(data);await page.evaluate(data=>window.activityQA.set('B',data),data);
    assert.match(await page.locator('#activity-body').innerText(),/ledger-B/u);assert.doesNotMatch(await page.locator('#activity-body').innerText(),/ledger-A/u);
    await page.evaluate(()=>window.activityQA.set(null,null));assert.equal(await page.locator('#activity-body').innerText(),'');assert.equal(await page.locator('#activity-head').innerText(),'');
    assert.equal(JSON.stringify(data),original,'renderer must not mutate source records');
  }finally{await browser.close();}
});

test('actual identity controls fence late logout outcomes and preserve current logout failure/retry',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    for(const mode of ['chooser-takes-epoch','old-finalizer-new-logout','late-success','late-failure','late-recheck-unavailable','current-success','current-failure-retry','current-unauthorized']){
      const page=await browser.newPage();let owner='A',accountStatus=200;const pending=[],requests=[],arrivals=[];
      const nextRequest=(count=1)=>pending.length>=count?Promise.resolve():new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('isolated logout request did not arrive')),5000);
        arrivals.push(()=>{clearTimeout(timer);resolve()});
      });
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!=='https://exchange.ynxweb4.com')return route.abort();
        if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
        if(url.pathname==='/api/v1/sso/config')return route.fulfill({json:{enabled:true,silentRestoreAllowed:false}});
        if(url.pathname==='/api/v1/sso/account')return route.fulfill({status:accountStatus,json:accountStatus===200?{account:owner,csrfToken:'isolated-control-csrf',scopes:['identity:read'],privateWorkspaceAuthorized:false}:{code:'SSO_LOGIN_REQUIRED'}});
        if(url.pathname==='/api/v1/sso/logout'){
          requests.push({method:route.request().method(),csrf:route.request().headers()['x-ynx-sso-csrf'],body:route.request().postData()});
          const result=await new Promise(resolve=>{pending.push(resolve);arrivals.shift()?.()});return route.fulfill(result);
        }
        return route.abort();
      });
      await page.goto('https://exchange.ynxweb4.com/');
      // Exact production identity functions and HTML, controlled HTTP outcomes;
      // this does not simulate a successful Wallet approval or public identity.
      await page.addScriptTag({content:`const $=selector=>document.querySelector(selector);const state={account:null,standardWallet:null};const calls={guest:0,disconnect:0,logoutSettled:0};const privateAccount={state:()=>({phase:'guest'}),guest:async()=>{calls.guest++},disconnect:async()=>{calls.disconnect++}};const originalListener=Element.prototype.addEventListener;Element.prototype.addEventListener=function(type,listener,...options){if(this.id==='browser-identity-logout'&&type==='click'){const wrapped=event=>Promise.resolve(listener.call(this,event)).finally(()=>calls.logoutSettled++);return originalListener.call(this,type,wrapped,...options)}return originalListener.call(this,type,listener,...options)};${identity};function showWalletFallback(show){$('#wallet-fallback').hidden=!show};${chooser};window.identityQA={restore:restoreBrowserIdentity,openChooser:openWalletChooser,current:()=>browserIdentity,calls};initializeBrowserIdentity();`});
      await page.waitForFunction(()=>window.identityQA?.current()?.account==='A');
      const logout=page.locator('#browser-identity-logout');
      await logout.click();await page.waitForFunction(()=>document.querySelector('#browser-identity-logout').disabled);
      await nextRequest();
      if(mode==='chooser-takes-epoch'){
        await page.evaluate(()=>window.identityQA.openChooser());assert.equal(await page.locator('#wallet-dialog').evaluate(element=>element.open),true);
        pending.shift()({status:200,json:{revoked:true}});await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===1);
        assert.equal(await page.evaluate(()=>window.identityQA.current()?.account),'A');assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),0);
        assert.equal(await logout.isEnabled(),true,'chooser epoch change must not leave the old logout busy');
      }else if(mode==='old-finalizer-new-logout'){
        owner='B';await page.evaluate(()=>window.identityQA.restore());await logout.click();
        await page.waitForFunction(()=>window.identityQA.calls.guest===2);
        // Both explicit requests are in flight; settle only the old A request.
        await nextRequest(2);
        pending.shift()({status:200,json:{revoked:true}});await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===1);
        assert.equal(await logout.isDisabled(),true,'old finalizer must not enable a newer pending logout');
        assert.equal(await page.evaluate(()=>window.identityQA.current()?.account),'B');assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),0);
        pending.shift()({status:200,json:{revoked:true}});await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===2);
        assert.equal(await page.evaluate(()=>window.identityQA.current()),null);assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),1);assert.equal(await logout.isDisabled(),false);
      }else if(mode.startsWith('late-')){
        if(mode==='late-recheck-unavailable')accountStatus=503;else owner='B';await page.evaluate(()=>window.identityQA.restore());
        pending.shift()({status:mode==='late-success'?200:503,json:mode==='late-success'?{revoked:true}:{code:'UNAVAILABLE'}});
        await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===1);
        assert.equal(await logout.isEnabled(),true,mode);
        assert.equal(await page.evaluate(()=>window.identityQA.current()?.account),mode==='late-recheck-unavailable'?'A':'B',mode);
        assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),0,mode);
        assert.match(await page.locator('#browser-identity-status').innerText(),mode==='late-recheck-unavailable'?/^Identity recheck unavailable\./u:/^B ·/u,mode);
        assert.equal(await logout.isVisible(),true,mode);
      }else{
        pending.shift()({status:mode==='current-failure-retry'?503:200,json:mode==='current-failure-retry'?{code:'UNAVAILABLE'}:{revoked:true}});
        if(mode==='current-failure-retry'){
          await page.waitForFunction(()=>document.querySelector('#browser-identity-status').textContent.startsWith('Sign-out is not confirmed.'));
          assert.equal(await page.evaluate(()=>window.identityQA.current()?.account),'A');assert.equal(await logout.isEnabled(),true);
          assert.equal(await page.evaluate(()=>window.identityQA.calls.disconnect),0);
          await page.waitForFunction(()=>window.identityQA.calls.logoutSettled===1);
          await logout.click();await nextRequest();
          pending.shift()({status:200,json:{revoked:true}});
        }
        await page.waitForFunction(expected=>window.identityQA.current()===null&&window.identityQA.calls.disconnect===1&&window.identityQA.calls.logoutSettled===expected,mode==='current-failure-retry'?2:1);
        assert.match(await page.locator('#browser-identity-status').innerText(),/^Signed out of Exchange\./u);
        assert.equal(await logout.isVisible(),false);
        if(mode==='current-unauthorized'){
          // A fresh authoritative 401 must still clear the current identity.
          owner='A';await page.evaluate(()=>window.identityQA.restore());accountStatus=401;
          await page.evaluate(()=>window.identityQA.restore());assert.equal(await page.evaluate(()=>window.identityQA.current()),null);
          assert.equal(await logout.isVisible(),false);
        }
      }
      assert.ok(requests.every(value=>value.method==='POST'&&value.csrf==='isolated-control-csrf'&&value.body==='{}'));
      assert.equal(requests.length,['current-failure-retry','old-finalizer-new-logout'].includes(mode)?2:1,'no implicit logout retry');
      await page.close();
    }
  }finally{await browser.close();}
});
test('private and browser identity actions use Klein-blue 44px controls without changing disabled or hidden state',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));await page.addStyleTag({content:css});
    await page.evaluate(()=>{const panel=document.createElement('div');panel.id='browser-identity';panel.innerHTML='<a href="/sso/start">Sign in across YNX products</a><button hidden>Sign out of Exchange</button><button>Recheck browser identity</button>';document.querySelector('#private-account').append(panel)});
    const button=page.locator('#private-begin');assert.equal(await button.isDisabled(),false);assert.equal(await button.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(0, 47, 167)');
    assert.ok((await button.boundingBox()).height>=44);assert.ok((await page.locator('#browser-identity a').boundingBox()).height>=44);
    assert.equal(await page.locator('#browser-identity button[hidden]').isVisible(),false);assert.equal(await page.locator('#private-open').isVisible(),false);
    await button.focus();assert.ok(await button.evaluate(element=>parseFloat(getComputedStyle(element).outlineWidth)>=3));
    await button.evaluate(element=>element.disabled=true);assert.equal(await button.isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  }finally{await browser.close();}
});
test('verified support reads, local support drafts and security state remain bound to the current native account',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',route=>route.abort());
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
    await page.addStyleTag({content:css});await page.evaluate(()=>{document.querySelectorAll('.view').forEach(element=>element.classList.remove('active'));document.querySelector('#controls').classList.add('active')});
    await page.addScriptTag({content:`const $=selector=>document.querySelector(selector);const state={account:null};const resumeDeferredBrowserIdentity=()=>{};const renderAccount=()=>{$('#withdraw-lock').checked=!!state.snapshot.security.withdrawalLock;$('#session-ttl').value=String(state.snapshot.security.sessionTtlMinutes);};${controls}`});
    const snapshot=(account,message)=>({phase:'connected',account,expiresAt:new Date(Date.now()+60_000).toISOString(),snapshot:{security:{account,withdrawalLock:true,sessionTtlMinutes:60,updatedAt:new Date().toISOString()},sourceMetadata:{status:'degraded_single_host',coverage:'account-ledger-orders-trades-fees-audit',asOf:new Date().toISOString()},support:[{id:account+'-case',account,category:'security',status:'open',createdAt:new Date().toISOString(),message}]}});
    await page.evaluate(value=>renderPrivateAccount(value),snapshot('isolated-native-A','<img src=x onerror=alert(1)> A case'));
    assert.match(await page.locator('#owned-support-cases').innerText(),/A case/u);assert.equal(await page.locator('#owned-support-cases img').count(),0);
    assert.equal(await page.locator('#withdraw-lock').isChecked(),true);assert.equal(await page.locator('#withdraw-lock').isDisabled(),true);
    await page.locator('#support-message').fill('A unfinished support draft');
    await page.evaluate(()=>renderPrivateAccount({phase:'degraded',account:null,snapshot:null,code:'PRIVATE_API_UNAVAILABLE'}));
    assert.doesNotMatch(await page.locator('#owned-support-cases').innerText(),/A case/u);assert.equal(await page.locator('#support-message').inputValue(),'');assert.match(await page.locator('#security-read-state').innerText(),/No verified/u);
    await page.evaluate(value=>renderPrivateAccount(value),snapshot('isolated-native-B','B case '+ 'long-owned-message'.repeat(50)));
    assert.doesNotMatch(await page.locator('#owned-support-cases').innerText(),/A case/u);assert.match(await page.locator('#owned-support-cases').innerText(),/B case/u);assert.equal(await page.locator('#support-message').inputValue(),'');
    await page.locator('#support-message').fill('B unfinished support draft');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'owned case content must not overflow the mobile page');
    await page.evaluate(value=>renderPrivateAccount(value),snapshot('isolated-native-A','A case'));
    assert.equal(await page.locator('#support-message').inputValue(),'A unfinished support draft');assert.doesNotMatch(await page.locator('#owned-support-cases').innerText(),/B case/u);
    await page.evaluate(value=>renderPrivateAccount(value),snapshot('isolated-native-B','B case'));
    assert.equal(await page.locator('#support-message').inputValue(),'B unfinished support draft');
  }finally{await browser.close();}
});

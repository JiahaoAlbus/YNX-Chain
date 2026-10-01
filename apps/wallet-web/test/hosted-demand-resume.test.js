import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Ephemeral browser, synthetic account, fully intercepted HTTPS origins. All
// bundles stay in memory; this is not installed/public acceptance evidence.
const wallet='https://wallet.ynxweb4.com',product='https://finance.ynxweb4.com';
const root=fileURLToPath(new URL('../../',import.meta.url));
const password='isolated hosted unlock password 2026';
async function bundle(entry) { return (await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,platform:'browser',target:'es2022'})).outputFiles[0].text; }

test('closed Wallet reopens from a user click for the same reviewed request; revoke, expiry and account switch deny recovery',async()=>{
  const app=await bundle('wallet-web/src/hosted-wallet-app.js');
  const seed=(await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`import {createHostedVaultStore} from './wallet-web/src/hosted-vault-store.js';import {createEncryptedVault} from './wallet-web/src/extension-vault.js';window.store=createHostedVaultStore();window.addTestAccount=async password=>store.addEncryptedAccount({password,record:await createEncryptedVault({password,secretHex:'22'.repeat(32)})});`},bundle:true,write:false,platform:'browser'})).outputFiles[0].text;
  const consumer=(await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`
    import {createHostedWalletAdapter} from './wallet-web/src/hosted-adapter.js';
    import {createFinanceHostedWalletController} from './finance/web/hosted-wallet-controller.js';
    window.changes=[];window.results=[];
    window.controller=createFinanceHostedWalletController({createHostedWalletAdapter,window,onChange:s=>changes.push(s)});
    document.querySelector('#connect').onclick=()=>controller.connect();
    document.querySelector('#sign').onclick=()=>{
      const reservation=controller.reserve();
      // Model the existing asynchronous server challenge without losing the
      // popup gesture: it is reserved before this delay.
      setTimeout(async()=>{try{await reservation;const result=await controller.request({method:'personal_sign',params:['0x0102',controller.getState().account]});results.push({result});}catch(e){results.push({code:e.code});}},20);
      reservation.catch(()=>{});
    };
    document.querySelector('#revoke').onclick=()=>{controller.revoke().then(result=>results.push(result),e=>results.push({code:e.code}));};
  `},bundle:true,write:false,platform:'browser'})).outputFiles[0].text;
  const html=await readFile(new URL('../public/hosted-wallet.html',import.meta.url),'utf8');
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/*',route=>route.abort());
    await context.route(/^https:\/\/(?:finance|wallet)\.ynxweb4\.com\//,async route=>{
      const url=new URL(route.request().url());let body,contentType='text/html';
      if(url.origin===wallet){
        if(url.pathname==='/seed'){body='<script src="/seed.js"></script>';}
        else if(url.pathname==='/seed.js'){body=seed;contentType='text/javascript';}
        else if(url.pathname==='/hosted/'){body=html;}
        else if(url.pathname==='/hosted/app.js'){body=app;contentType='text/javascript';}
        else return route.fulfill({status:404,body:''});
      }else if(url.pathname==='/'){body='<button id="connect">Connect</button><button id="sign">Sign</button><button id="revoke">Revoke</button><script src="/consumer.js"></script>';}
      else if(url.pathname==='/consumer.js'){body=consumer;contentType='text/javascript';}
      else return route.fulfill({status:404,body:''});
      return route.fulfill({body,contentType});
    });
    const fixture=await context.newPage();await fixture.goto(wallet+'/seed');await fixture.waitForFunction(()=>window.store);
    const created=await fixture.evaluate(password=>window.store.create({password,secretHex:'11'.repeat(32)}),password);
    const account=created.account;
    const page=await context.newPage();await page.goto(product+'/');await page.waitForFunction(()=>window.controller);
    let popupReady=context.waitForEvent('page');await page.locator('#connect').click();let popup=await popupReady;
    await popup.locator('#review').waitFor({state:'visible'});await popup.locator('#approve').click();
    await page.waitForFunction(()=>controller.getState().status==='connected');assert.equal(await page.evaluate(()=>controller.getState().account),account);
    const grant=await fixture.evaluate(async ({origin,account})=>new Promise((resolve,reject)=>{const req=indexedDB.open('ynx-hosted-wallet-v1',5);req.onsuccess=()=>{const db=req.result,r=db.transaction('connections').objectStore('connections').get(origin+'|'+account);r.onsuccess=()=>{db.close();resolve(r.result);};r.onerror=reject;};}),{origin:product,account});
    assert.deepEqual(grant.scopes,['account:read','request:review']);assert.equal(Object.keys(grant).some(key=>/password|secret|signature|token/i.test(key)),false);
    await popup.close();await page.waitForFunction(()=>controller.getState().status==='transport-unavailable');
    assert.equal(await page.evaluate(()=>controller.getState().account),account);
    popupReady=context.waitForEvent('page');await page.locator('#sign').click();popup=await popupReady;
    await popup.locator('#review').waitFor({state:'visible'});assert.equal(await popup.locator('#approval-password').isVisible(),true,'fresh request stays locked until explicit password approval');
    await popup.locator('#reject').click();await page.waitForFunction(()=>results.length===1);assert.equal(await page.evaluate(()=>results[0].code),'USER_REJECTED');
    await page.locator('#sign').click();await popup.locator('#review').waitFor({state:'visible'});await popup.locator('#approval-password').fill(password);await popup.locator('#approve').click();
    await page.waitForFunction(()=>results.length===2);assert.match(await page.evaluate(()=>results[1].result),/^0x[0-9a-f]{130}$/);
    // Closing mid-review cancels only that request; it cannot sign later.
    await page.locator('#sign').click();await popup.locator('#review').waitFor({state:'visible'});await popup.close();
    await page.waitForFunction(()=>results.length===3);assert.equal(await page.evaluate(()=>results[2].code),'HOSTED_POPUP_CLOSED');
    popupReady=context.waitForEvent('page');await page.locator('#sign').click();popup=await popupReady;await popup.locator('#review').waitFor({state:'visible'});await popup.locator('#reject').click();await page.waitForFunction(()=>results.length===4);
    await page.locator('#revoke').click();await page.waitForFunction(()=>results.length===5);assert.equal(await page.evaluate(()=>results[4].permissionRevoked),true);
    assert.equal(await page.evaluate(()=>controller.getState().account),null);
    const denied=await fixture.evaluate(async ({origin,account,grant})=>{try{await store.verifyConnection(origin,account,grant);return null;}catch(e){return e.code;}},{origin:product,account,grant});assert.equal(denied,'HOSTED_GRANT_REVOKED_OR_EXPIRED');
    // Expiry is Wallet-authoritative, not a mutable DApp selection hint.
    const expired=await fixture.evaluate(async ({origin,account})=>{const grant=await store.approveConnection(origin,account);await new Promise(resolve=>{const r=indexedDB.open('ynx-hosted-wallet-v1',5);r.onsuccess=()=>{const db=r.result,tx=db.transaction('connections','readwrite');tx.objectStore('connections').put({...grant,expiresAt:Date.now()-1},origin+'|'+account);tx.oncomplete=()=>{db.close();resolve();};};});try{await store.verifyConnection(origin,account,grant);return null;}catch(e){return e.code;}},{origin:product,account});assert.equal(expired,'HOSTED_GRANT_REVOKED_OR_EXPIRED');
    const switched=await fixture.evaluate(async ({origin,account,password})=>{
      const grant=await store.approveConnection(origin,account),other=await addTestAccount(password);
      await store.selectAccount(other);await store.selectAccount(account);
      try{await store.verifyConnection(origin,account,grant);return null;}catch(e){return e.code;}
    },{origin:product,account,password});assert.equal(switched,'HOSTED_GRANT_REVOKED_OR_EXPIRED');
    await context.close();
  }finally{await browser.close();}
});

test('actual Finance refresh, new tab and closed-page reopen restore only a hint until the next user signing action validates Wallet grant',async()=>{
  const {createEvmProductSessionChallenge,evmProductSessionMessage,issueEvmProductSession}=await import('../../../packages/wallet-auth/src/evm-product-session.js');
  const app=await bundle('wallet-web/src/hosted-wallet-app.js'),finance=await bundle('finance/web/wallet-auth-entry.js'),evm=await bundle('finance/scripts/evm-read-browser-entry.mjs');
  const seed=(await build({absWorkingDir:root,stdin:{resolveDir:root,contents:`import {createHostedVaultStore} from './wallet-web/src/hosted-vault-store.js';window.store=createHostedVaultStore();`},bundle:true,write:false,platform:'browser'})).outputFiles[0].text;
  const walletHTML=await readFile(new URL('../public/hosted-wallet.html',import.meta.url),'utf8'),financeHTML=await readFile(new URL('../../finance/web/index.html',import.meta.url),'utf8');
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});let account,challenge,challengeCount=0,completionCount=0;
    await context.route('**/*',route=>route.abort());
    await context.route(/^https:\/\/(?:finance|wallet)\.ynxweb4\.com\//,async route=>{
      const url=new URL(route.request().url());let body,contentType='text/html';
      if(url.origin===wallet){
        if(url.pathname==='/seed')body='<script src="/seed.js"></script>';
        else if(url.pathname==='/seed.js'){body=seed;contentType='text/javascript';}
        else if(url.pathname==='/hosted/')body=walletHTML;
        else if(url.pathname==='/hosted/app.js'){body=app;contentType='text/javascript';}
        else return route.fulfill({status:404,body:''});
      }else if(url.pathname==='/')body=financeHTML;
      else if(url.pathname==='/wallet-auth.js'){body=finance;contentType='text/javascript';}
      else if(url.pathname==='/evm-read-session.js'){body=evm;contentType='text/javascript';}
      else if(['/app.js','/finance-locale.js'].includes(url.pathname)){body=await readFile(new URL('../../finance/web'+url.pathname,import.meta.url),'utf8');contentType='text/javascript';}
      else if(url.pathname.endsWith('.js')){body='';contentType='text/javascript';}
      else if(url.pathname==='/api/evm-read/challenges'){
        const submitted=route.request().postDataJSON(),at=Date.now();challengeCount++;
        challenge=createEvmProductSessionChallenge({chainId:6423,account,productId:'finance',origin:product,callback:product+'/wallet-auth/callback',scope:'finance.account.read',deviceId:submitted.deviceId,deviceAlgorithm:'p256-sha256',deviceKey:submitted.deviceKey,nonce:'hosted_browser_nonce_0123456789abcdef_'+challengeCount,state:'hosted_browser_state_0123456789abcdef_'+challengeCount,requestId:'hosted-finance-request-0000'+challengeCount,providerKind:'ynx-wallet',issuedAt:new Date(at).toISOString(),expiresAt:new Date(at+300000).toISOString()});
        const message=evmProductSessionMessage(challenge);body=JSON.stringify({schemaVersion:'finance-evm-read-challenge-v1',challenge,signingRequest:{method:'personal_sign',params:['0x'+Buffer.from(message).toString('hex'),account],message},privateFinanceAuthorized:false});contentType='application/json';
      }else if(url.pathname==='/api/evm-read/sessions'){
        const proof=route.request().postDataJSON().proof,at=new Date();
        const session=await issueEvmProductSession(proof,challenge,{sessionId:'hosted_finance_session_0123456789abcdef',expiresAt:new Date(at.getTime()+300000).toISOString()},async()=>true,at);completionCount++;
        body=JSON.stringify({schemaVersion:'finance-evm-read-session-v1',session,evmAccountReadAuthorized:true,privateFinanceAuthorized:false,extensionLiveStateAttested:false});contentType='application/json';
      }else return route.fulfill({status:503,contentType:'application/json',body:'{"code":"ISOLATED_SERVICE_UNAVAILABLE"}'});
      return route.fulfill({body,contentType});
    });
    const fixture=await context.newPage();await fixture.goto(wallet+'/seed');await fixture.waitForFunction(()=>window.store);account=(await fixture.evaluate(password=>store.create({password,secretHex:'33'.repeat(32)}),password)).account;
    let page=await context.newPage();await page.goto(product+'/');await page.evaluate(()=>window.YNXFinanceWallet.ready);
    await page.locator('#wallet-entry').click();let popupReady=context.waitForEvent('page');await page.locator('#picker-hosted').click();let popup=await popupReady;
    await popup.locator('#review').waitFor({state:'visible'});await popup.locator('#approve').click();await page.waitForFunction(()=>YNXFinanceWallet.getStandardWalletState().status==='connected');await page.keyboard.press('Escape');await popup.close();
    for(const recovery of ['refresh','new-tab','close-and-reopen']){
      if(recovery==='refresh')await page.reload();
      else if(recovery==='new-tab'){page=await context.newPage();await page.goto(product+'/');}
      else{await page.close();page=await context.newPage();await page.goto(product+'/');}
      await page.evaluate(()=>YNXFinanceWallet.ready);assert.equal(await page.evaluate(()=>YNXFinanceWallet.getStandardWalletState().status),'selection-pending');
      assert.equal(await page.evaluate(()=>YNXFinanceWallet.privateProviderAvailable()),false);assert.equal(await page.evaluate(()=>YNXFinanceWallet.connected()),false);
      await page.locator('#wallet-connection-details > summary').click(); assert.equal(await page.locator('#wallet-login-verify').isVisible(),true,recovery+' '+JSON.stringify(await page.locator('#wallet-login-verify').evaluate(el=>({hidden:el.hidden,parents:[el.parentElement,el.parentElement.parentElement,el.parentElement.parentElement.parentElement].map(x=>({id:x.id,hidden:x.hidden,open:x.open,className:x.className})),app:typeof window.YNXFinanceEVMRead})))); const before=challengeCount;popupReady=context.waitForEvent('page');await page.locator('#wallet-login-verify').click();popup=await popupReady;
      await popup.locator('#review').waitFor({state:'visible'});assert.equal(await popup.locator('#approval-password').isVisible(),true,'Wallet verifies durable grant without repeating connection consent; this is the separate signing review');
      assert.equal(challengeCount,before+1);assert.equal(completionCount,0);await popup.locator('#reject').click();await page.waitForFunction(()=>!document.querySelector('#wallet-login-verify').disabled);await popup.close();
    }
    popupReady=context.waitForEvent('page');await page.locator('#wallet-login-verify').click();popup=await popupReady;await popup.locator('#review').waitFor({state:'visible'});await popup.locator('#approval-password').fill(password);await popup.locator('#approve').click();await page.waitForFunction(()=>YNXFinanceEVMRead.state().active===true);assert.equal(completionCount,1);assert.equal(await page.evaluate(()=>YNXFinanceEVMRead.state().account),account);
    await context.close();
  }finally{await browser.close();}
});

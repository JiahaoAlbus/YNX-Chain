import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdtemp,chmod,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {ProductSessionGatewayNodeHost} from '../../../packages/wallet-auth/src/product-session-gateway-node-host.js';

// Real local vault/review/signature + durable Gateway + Go schema10 owned read.
// Only canonical HTTPS socket destinations are relayed. No public/installed
// claim, external user account, substituted approval or secret diagnostics.
const root=fileURLToPath(new URL('../../../',import.meta.url)),origin='https://exchange.ynxweb4.com',gatewayOrigin='https://wallet-auth.ynxweb4.com';
const dist=process.env.YNX_EXCHANGE_HOSTED_WALLET_DIST;
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
async function relay(route,base,path,trace){
  const request=route.request(),url=new URL(request.url()),headers={...request.headers()};delete headers.host;delete headers['content-length'];delete headers['accept-encoding'];
  const response=await fetch(base+(path??url.pathname)+url.search,{method:request.method(),headers,redirect:'manual',signal:AbortSignal.timeout(5000),body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer()});
  const returned=Object.fromEntries(response.headers);delete returned['content-encoding'];delete returned['transfer-encoding'];
  const body=Buffer.from(await response.arrayBuffer());
  if(trace){let code;try{const value=JSON.parse(body);const candidate=value.error?.code??value.error??value.code;if(typeof candidate==='string'&&/^[A-Z_]{2,80}$/u.test(candidate))code=candidate}catch{}trace.push({path:path??url.pathname,status:response.status,...(code?{code}:{})})}
  await route.fulfill({status:response.status,headers:returned,body});
}
async function startGo(base){
  const child=spawn('go',['test','./internal/exchangeproduct','-run','^TestLocalNodeHostExchangeBrowserBridge$','-count=1','-v'],{cwd:root,env:{...process.env,YNX_EXCHANGE_QA_GATEWAY_LOOPBACK:base},stdio:['ignore','pipe','pipe']});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});let output='';
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Exchange QA startup deadline'))},15000);child.stdout.on('data',chunk=>{output=(output+chunk).slice(-8192);const match=output.match(/EXCHANGE_QA_LISTEN=(http:\/\/127\.0\.0\.1:[0-9]+)/u);if(match){clearTimeout(timer);resolve(match[1])}});child.on('close',()=>{clearTimeout(timer);reject(new Error('Exchange QA ended before readiness'))})});
  return {url,diagnostics:()=>[...output.matchAll(/EXCHANGE_QA_POLICY_MISMATCH=([A-Za-z,]+)/gu)].map(value=>value[1]),async close(){await fetch(url+'/__qa_stop',{method:'POST',signal:AbortSignal.timeout(5000)});assert.equal(await done,0)}};
}
test('actual Hosted approved Exchange read survives popup close/reload/schema10 restart and rejects revoked proof',{skip:!dist&&'YNX_EXCHANGE_HOSTED_WALLET_DIST not supplied'},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ynx-exchange-hosted-'));await chmod(directory,0o700);
  const registry=JSON.parse(await readFile(resolve(root,'packages/wallet-auth/product-session-registry.json')));
  const host=new ProductSessionGatewayNodeHost(registry,{statePath:join(directory,'gateway.json'),now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url')});
  const gateway=createServer(host.handler());let browser,go;const trace=[];
  try{
    const base=await listen(gateway);go=await startGo(base);browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});const context=await browser.newContext({acceptDownloads:true});
    const routeHandler=async route=>{
      const url=new URL(route.request().url());
      if(url.origin===gatewayOrigin)return relay(route,base,undefined,trace);
      if(url.origin===origin){
        if(url.pathname==='/api/v1/account')return relay(route,go.url,'/v1/account',trace);
        if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"QA_PUBLIC_UPSTREAM_UNAVAILABLE"}'});
        const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!/^[a-zA-Z0-9.-]+$/u.test(name))return route.abort();
        try{return route.fulfill({status:200,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:await readFile(resolve(root,'apps/exchange/web',name))})}catch{return route.fulfill({status:404,body:''})}
      }
      if(url.origin==='https://wallet.ynxweb4.com'&&url.pathname.startsWith('/hosted/')){const name=url.pathname.slice(8)||'index.html';if(!['index.html','app.js','hosted-wallet.css','ynx-logo.png'].includes(name))return route.abort();return route.fulfill({status:200,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:await readFile(resolve(dist,name))})}
      return route.abort();
    };await context.route('**/*',routeHandler);
    const page=await context.newPage(),errors=[];page.on('pageerror',()=>errors.push('pageerror'));await page.goto(origin);
    await page.click('#connect');const opened=context.waitForEvent('page');await page.click('#connect-hosted-ynx');const wallet=await opened;
    const password='isolated Exchange Hosted QA password 2026';await wallet.locator('#setup-password').fill(password);await wallet.locator('#setup-confirm').fill(password);await wallet.locator('#setup-form button[type=submit]').click();await wallet.locator('#backup-confirmation').waitFor({state:'visible'});const backup=wallet.waitForEvent('download');await wallet.click('#export-backup');await backup;await wallet.locator('#backup-ack').check();await wallet.click('#backup-continue');await wallet.locator('#review').waitFor({state:'visible'});await wallet.click('#approve');await page.waitForFunction(()=>window.YNXExchangeWebWallet.getPrivateWalletContext().status==='connected');assert.equal(host.snapshot().authority.sessions.length,0);
    await page.click('#private-begin');await wallet.locator('#review').waitFor({state:'visible'});await wallet.click('#reject');await page.waitForFunction(()=>document.querySelector('#private-status').textContent.includes('PRIVATE_SESSION_DISCONNECTED'));assert.equal(host.snapshot().authority.sessions.length,0);assert.equal(await page.evaluate(()=>window.YNXExchangeWebWallet.getPrivateWalletContext().status),'connected');
    await page.click('#private-begin');await wallet.locator('#review').waitFor({state:'visible'});assert.match(await wallet.locator('#review-text').textContent(),/exchange:read/u);await wallet.locator('#approval-password').fill(password);await wallet.click('#approve');
    await page.waitForFunction(()=>!document.querySelector('#private-details').hidden,null,{timeout:5000}).catch(async()=>{
      const status=await page.evaluate(()=>({phase:'native-approved-owned-read',code:/\(([A-Z_]+)\)$/.exec(document.querySelector('#private-status').textContent)?.[1]??'unknown',standard:window.YNXExchangeWebWallet.getPrivateWalletContext().status}));
      throw new Error(JSON.stringify({trace,policyMismatches:go.diagnostics(),...status}));
    });
    const account=await wallet.locator('#account-ynx').textContent();assert.equal(await page.locator('#private-native-account').textContent(),account);assert.equal(host.snapshot().authority.sessions.length,1);
    const seeded=await fetch(go.url+'/__qa_seed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account}),signal:AbortSignal.timeout(5000)});assert.equal(seeded.status,204);await page.click('#private-refresh');await page.waitForFunction(()=>document.querySelector('#balances').textContent.includes('17'));assert.match(await page.locator('#balances').textContent(),/YUSD_TEST/u);
    await wallet.close();await page.waitForFunction(()=>window.YNXExchangeWebWallet.getPrivateWalletContext().status==='transport-unavailable');assert.equal(await page.locator('#private-details').isHidden(),false);assert.equal(await page.evaluate(async()=>{try{await window.YNXExchangeWebWallet.requestProductSessionV2('untrusted');return false}catch(e){return e.code==='PRIVATE_TRANSPORT_UNAVAILABLE'}}),true);await page.click('#private-refresh');await page.waitForFunction(()=>document.querySelector('#balances').textContent.includes('17'));
    assert.equal((await fetch(go.url+'/__qa_restart',{method:'POST',signal:AbortSignal.timeout(5000)})).status,204);await page.reload();await page.waitForFunction(()=>!document.querySelector('#private-details').hidden);assert.equal(await page.locator('#private-native-account').textContent(),account);assert.match(await page.locator('#balances').textContent(),/17/u);assert.equal(host.snapshot().authority.sessions.length,1);
    // A second isolated account is created/exported by the real Wallet UI in
    // an independent browser profile. Only the encrypted backup stays in RAM.
    const secondContext=await browser.newContext({acceptDownloads:true});await secondContext.route('**/*',routeHandler);const secondPage=await secondContext.newPage();await secondPage.goto('https://wallet.ynxweb4.com/hosted/#account');await secondPage.locator('#setup-password').fill(password);await secondPage.locator('#setup-confirm').fill(password);await secondPage.locator('#setup-form button[type=submit]').click();await secondPage.locator('#backup-confirmation').waitFor({state:'visible'});const secondDownload=secondPage.waitForEvent('download');await secondPage.click('#export-backup');const secondBytes=await readFile(await (await secondDownload).path());await secondPage.locator('#backup-ack').check();await secondPage.click('#backup-continue');const second={account:await secondPage.locator('#account-evm').textContent(),nativeAccount:await secondPage.locator('#account-ynx').textContent(),bytes:secondBytes};await secondContext.close();
    await page.click('#connect');const reopened=context.waitForEvent('page');await page.click('#connect-hosted-ynx');const switchedWallet=await reopened;await switchedWallet.locator('#review').waitFor({state:'visible'});await switchedWallet.click('#approve');await page.waitForFunction(()=>window.YNXExchangeWebWallet.getPrivateWalletContext().status==='connected');
    await switchedWallet.locator('#account-switch-section details').evaluate(node=>{node.open=true});await switchedWallet.locator('#add-account-file').setInputFiles({name:'isolated-second-account.json',mimeType:'application/json',buffer:second.bytes});await switchedWallet.locator('#add-account-password').fill(password);await switchedWallet.locator('#add-account-form button[type=submit]').click();await switchedWallet.waitForFunction(expected=>[...document.querySelector('#account-select').options].some(value=>value.value===expected),second.account);await switchedWallet.selectOption('#account-select',second.account);await switchedWallet.click('#switch-account');await page.waitForFunction(()=>document.querySelector('#private-details').hidden&&window.YNXExchangeWebWallet.getPrivateWalletContext().status!=='connected');assert.ok(!await page.locator('#balances').textContent().then(text=>text.includes('17')));
    await switchedWallet.close();await page.click('#connect');const openedB=context.waitForEvent('page');await page.click('#connect-hosted-ynx');const walletB=await openedB;await walletB.locator('#review').waitFor({state:'visible'});await walletB.click('#approve');await page.waitForFunction(()=>window.YNXExchangeWebWallet.getPrivateWalletContext().status==='connected');await page.click('#private-begin');await walletB.locator('#review').waitFor({state:'visible'});await walletB.locator('#approval-password').fill(password);await walletB.click('#approve');await page.waitForFunction(()=>!document.querySelector('#private-details').hidden);assert.equal(await page.locator('#private-native-account').textContent(),second.nativeAccount);
    assert.equal((await fetch(go.url+'/__qa_seed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:second.nativeAccount,amount:31}),signal:AbortSignal.timeout(5000)})).status,204);await page.click('#private-refresh');await page.waitForFunction(()=>document.querySelector('#balances').textContent.includes('31'));assert.ok(!await page.locator('#balances').textContent().then(text=>text.includes('17')));await walletB.close();
    page.once('dialog',dialog=>dialog.accept());await page.click('#private-disconnect');await page.waitForFunction(()=>document.querySelector('#private-status').textContent.includes('PRIVATE_REVOCATION_CONFIRMED'));assert.ok(host.snapshot().authority.sessions.every(value=>host.snapshot().authority.revokedSessions.includes(value.sessionBinding)));await page.reload();assert.equal(await page.locator('#private-details').isHidden(),true);assert.deepEqual(errors,[]);await context.close();
  }finally{await browser?.close();if(go)await go.close();await new Promise(resolve=>gateway.close(resolve));await rm(directory,{recursive:true,force:true})}
});

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

// Real local vault/review/signature + durable Gateway + Go existing owned records read.
// Only canonical HTTPS socket destinations are relayed. No public/installed
// claim, external user account, substituted approval or secret diagnostics.
const root=fileURLToPath(new URL('../../../',import.meta.url)),origin='https://quant.ynxweb4.com',gatewayOrigin='https://wallet-auth.ynxweb4.com';
const dist=process.env.YNX_QUANT_HOSTED_WALLET_DIST;
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
async function relay(route,base,path,trace){
  const request=route.request(),url=new URL(request.url()),headers={...request.headers()};delete headers.host;delete headers['content-length'];delete headers['accept-encoding'];
  // A canonical remote DApp must not gain local-preview authority just because
  // its isolated QA socket is loopback. This header only denies that capability.
  if(url.origin===origin)headers['x-forwarded-for']='203.0.113.10';
  const response=await fetch(base+(path??url.pathname)+url.search,{method:request.method(),headers,redirect:'manual',signal:AbortSignal.timeout(5000),body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer()});
  const returned=Object.fromEntries(response.headers);delete returned['content-encoding'];delete returned['transfer-encoding'];
  const body=Buffer.from(await response.arrayBuffer());
  if(trace){let code;try{const value=JSON.parse(body);const candidate=value.error?.code??value.error??value.code;if(typeof candidate==='string'&&/^[A-Z_]{2,80}$/u.test(candidate))code=candidate}catch{}trace.push({path:path??url.pathname,status:response.status,...(code?{code}:{})})}
  await route.fulfill({status:response.status,headers:returned,body});
}
async function startGo(base){
  const child=spawn('go',['test','./internal/quantlab','-run','^TestLocalNodeHostQuantBrowserBridge$','-count=1','-v'],{cwd:root,env:{...process.env,YNX_QUANT_QA_GATEWAY_LOOPBACK:base},stdio:['ignore','pipe','pipe']});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});let output='';
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Quant QA startup deadline'))},15000);child.stdout.on('data',chunk=>{output=(output+chunk).slice(-8192);const match=output.match(/QUANT_QA_LISTEN=(http:\/\/127\.0\.0\.1:[0-9]+)/u);if(match){clearTimeout(timer);resolve(match[1])}});child.on('close',()=>{clearTimeout(timer);reject(new Error('Quant QA ended before readiness'))})});
  return {url,diagnostics:()=>[...output.matchAll(/QUANT_QA_POLICY_MISMATCH=([A-Za-z,]+)/gu)].map(value=>value[1]),async close(){await fetch(url+'/__qa_stop',{method:'POST',signal:AbortSignal.timeout(5000)});assert.equal(await done,0)}};
}

test('actual Hosted scoped Quant records read survives close/reload/restart and revoke',{skip:!dist&&'YNX_QUANT_HOSTED_WALLET_DIST not supplied'},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ynx-quant-hosted-'));await chmod(directory,0o700);
 const registry=JSON.parse(await readFile(resolve(root,'packages/wallet-auth/product-session-registry.json')));
 const host=new ProductSessionGatewayNodeHost(registry,{statePath:join(directory,'gateway.json'),now:()=>new Date(),tokenFactory:()=>randomBytes(32).toString('base64url')});
 const gateway=createServer(host.handler());let browser,go;const trace=[];
 try{
  const base=await listen(gateway);go=await startGo(base);browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const context=await browser.newContext({acceptDownloads:true});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===gatewayOrigin)return relay(route,base,undefined,trace);
   if(url.origin===origin){
    if(url.pathname==='/api/v1/wallet/private-records')return relay(route,go.url,'/v1/wallet/private-records',trace);
    if(/^\/api\/v1\/[a-z/-]+$/u.test(url.pathname))return relay(route,go.url,url.pathname.slice(4),trace);
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!/^[a-zA-Z0-9.-]+$/u.test(name))return route.abort();
    try{return route.fulfill({status:200,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:await readFile(resolve(root,'apps/quant-lab/web',name))})}catch{return route.fulfill({status:404,body:''})}
   }
   if(url.origin==='https://wallet.ynxweb4.com'&&url.pathname.startsWith('/hosted/')){const name=url.pathname.slice(8)||'index.html';if(!['index.html','app.js','hosted-wallet.css','ynx-logo.png'].includes(name))return route.abort();return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:await readFile(resolve(dist,name))})}
   return route.abort();
  });
  const page=await context.newPage();await page.goto(origin);
  const opened=context.waitForEvent('page');await page.click('#connect-hosted');const wallet=await opened;
  const password='isolated Quant Hosted QA password 2026';
  await wallet.locator('#setup-password').fill(password);await wallet.locator('#setup-confirm').fill(password);await wallet.locator('#setup-form button[type=submit]').click();await wallet.locator('#backup-confirmation').waitFor({state:'visible'});const download=wallet.waitForEvent('download');await wallet.click('#export-backup');await download;await wallet.locator('#backup-ack').check();await wallet.click('#backup-continue');await wallet.locator('#review').waitFor({state:'visible'});await wallet.click('#approve');
  await page.waitForFunction(()=>window.YNXQuantWallet.getPrivateWalletContext().status==='connected');assert.equal(host.snapshot().authority.sessions.length,0);
  await page.click('#records-authorize');await wallet.locator('#review').waitFor({state:'visible'});await wallet.click('#reject');await page.waitForFunction(()=>document.querySelector('#records-status').dataset.pending==='false');assert.equal(host.snapshot().authority.sessions.length,0);
  await page.click('#records-authorize');await wallet.locator('#review').waitFor({state:'visible'});assert.match(await wallet.locator('#review-text').textContent(),/quant:records:read/u);await wallet.locator('#approval-password').fill(password);await wallet.click('#approve');
  await page.waitForFunction(()=>document.querySelector('#records-status').textContent.includes('ynx1'),null,{timeout:5000}).catch(()=>{throw new Error(JSON.stringify({phase:'native-approved',trace}))});
  const account=await wallet.locator('#account-ynx').textContent();
  assert.equal((await fetch(go.url+'/__qa_seed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account,index:0}),signal:AbortSignal.timeout(5000)})).status,204);
  await page.click('#records-read');await page.waitForFunction(()=>document.querySelector('#records-owned').children.length===2,null,{timeout:5000}).catch(()=>{throw new Error(JSON.stringify({phase:'owned-records',trace}))});
  assert.match(await page.locator('#records-owned').textContent(),/100/);assert.match(await page.locator('#records-owned').textContent(),/exchange-order-1/);
  await page.locator('#backtest button[type=submit], #backtest button.primary').click();await page.waitForFunction(()=>!document.querySelector('#latest-result').hidden&&document.querySelector('#equity-chart').children.length>0);
  assert.match(await page.locator('#result-return').textContent(),/bps/);assert.equal(await page.locator('#paper-submit').isDisabled(),true);assert.ok(trace.some(value=>value.path==='/v1/public/research/backtests/from-market'&&value.status===201));
  await wallet.close();await page.waitForFunction(()=>window.YNXQuantWallet.getPrivateWalletContext().status==='transport-unavailable');await page.click('#records-read');await page.waitForFunction(()=>document.querySelector('#records-owned').children.length===2);
  assert.equal(await page.evaluate(async()=>{try{await window.YNXQuantWallet.requestProductSessionV2('untrusted');return false}catch(e){return e.code==='PRIVATE_TRANSPORT_UNAVAILABLE'}}),true);
  assert.equal((await fetch(go.url+'/__qa_restart',{method:'POST',signal:AbortSignal.timeout(5000)})).status,204);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#records-status').textContent.includes('ynx1'));await page.click('#records-read');await page.waitForFunction(()=>document.querySelector('#records-owned').children.length===2);assert.equal(host.snapshot().authority.sessions.length,1);
  // Independent real Wallet profile creates B. Only its encrypted export is
  // held briefly in memory; EVM selection and approved native subject differ.
  const secondContext=await browser.newContext({acceptDownloads:true});
  // Reuse the exact origin/socket fixture, never a raw provider approval mock.
  await secondContext.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!=='https://wallet.ynxweb4.com'||!u.pathname.startsWith('/hosted/'))return route.abort();const name=u.pathname.slice(8)||'index.html';if(!['index.html','app.js','hosted-wallet.css','ynx-logo.png'].includes(name))return route.abort();return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html',body:await readFile(resolve(dist,name))});});
  const secondPage=await secondContext.newPage();await secondPage.goto('https://wallet.ynxweb4.com/hosted/#account');await secondPage.locator('#setup-password').fill(password);await secondPage.locator('#setup-confirm').fill(password);await secondPage.locator('#setup-form button[type=submit]').click();await secondPage.locator('#backup-confirmation').waitFor({state:'visible'});const exportB=secondPage.waitForEvent('download');await secondPage.click('#export-backup');const bytes=await readFile(await (await exportB).path());await secondPage.locator('#backup-ack').check();await secondPage.click('#backup-continue');const evmB=await secondPage.locator('#account-evm').textContent(),nativeB=await secondPage.locator('#account-ynx').textContent();await secondContext.close();
  const reopen=context.waitForEvent('page');await page.click('#connect-hosted');const switched=await reopen;await switched.locator('#review').waitFor({state:'visible'});await switched.click('#approve');await page.waitForFunction(()=>window.YNXQuantWallet.getPrivateWalletContext().status==='connected');
  await switched.locator('#account-switch-section details').evaluate(node=>{node.open=true});await switched.locator('#add-account-file').setInputFiles({name:'isolated-second-account.json',mimeType:'application/json',buffer:bytes});await switched.locator('#add-account-password').fill(password);await switched.locator('#add-account-form button[type=submit]').click();await switched.waitForFunction(value=>[...document.querySelector('#account-select').options].some(option=>option.value===value),evmB);await switched.selectOption('#account-select',evmB);await switched.click('#switch-account');await page.waitForFunction(()=>!document.querySelector('#records-status').textContent.includes('ynx1'));assert.equal(await page.locator('#records-owned li').count(),0);
  await switched.close();const openB=context.waitForEvent('page');await page.click('#connect-hosted');const walletB=await openB;await walletB.locator('#review').waitFor({state:'visible'});await walletB.click('#approve');await page.waitForFunction(()=>window.YNXQuantWallet.getPrivateWalletContext().status==='connected');await page.click('#records-authorize');await walletB.locator('#review').waitFor({state:'visible'});await walletB.locator('#approval-password').fill(password);await walletB.click('#approve');await page.waitForFunction(()=>document.querySelector('#records-status').textContent.includes('ynx1'));assert.ok((await page.locator('#records-status').textContent()).includes(nativeB));assert.notEqual(nativeB,account);
  assert.equal((await fetch(go.url+'/__qa_seed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:nativeB,index:1}),signal:AbortSignal.timeout(5000)})).status,204);await page.click('#records-read');await page.waitForFunction(()=>document.querySelector('#records-owned').children.length===2);assert.match(await page.locator('#records-owned').textContent(),/101/);assert.doesNotMatch(await page.locator('#records-owned li').first().textContent(),/100/);await walletB.close();
  await page.click('#records-revoke');await page.waitForFunction(()=>!document.querySelector('#records-status').textContent.includes('ynx1'));assert.ok(host.snapshot().authority.sessions.every(s=>host.snapshot().authority.revokedSessions.includes(s.sessionBinding)));await page.reload();assert.equal(await page.locator('#records-owned li').count(),0);
  await context.close();
  // Existing Paper is a separate explicitly local-preview browser capability,
  // not a permission granted by records/identity or by forged remote headers.
  const localContext=await browser.newContext(),localPage=await localContext.newPage();
  await localContext.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==go.url)return route.abort();if(/^\/api\/v1\/[a-z0-9/-]+$/u.test(url.pathname))return relay(route,go.url,url.pathname.slice(4),trace);const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!/^[a-zA-Z0-9.-]+$/u.test(name))return route.abort();try{return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:await readFile(resolve(root,'apps/quant-lab/web',name))})}catch{return route.fulfill({status:404,body:''})}});
await localPage.goto(go.url);await localPage.waitForFunction(()=>document.querySelector('#workspace-boundary').hidden);await localPage.locator('#backtest button.primary').click();await localPage.waitForFunction(()=>document.querySelector('#paper-strategy').options.length>1);await localPage.click('[data-view=paper]');await localPage.selectOption('#paper-strategy',{index:1});await localPage.click('#paper-submit');await localPage.waitForFunction(()=>/paper-[0-9]{6}/u.test(document.querySelector('#audit-rows').textContent),null,{timeout:5000}).catch(()=>{throw new Error(JSON.stringify({phase:'local-paper-result',trace}))});assert.ok(trace.some(value=>value.path==='/v1/paper/orders'&&value.status===201));await localPage.reload();await localPage.click('[data-view=paper]');await localPage.waitForFunction(()=>/paper-[0-9]{6}/u.test(document.querySelector('#audit-rows').textContent),null,{timeout:5000}).catch(()=>{throw new Error(JSON.stringify({phase:'local-paper-result',trace}))});await localContext.close();
 }finally{await browser?.close();if(go)await go.close();await new Promise(resolve=>gateway.close(resolve));await rm(directory,{recursive:true,force:true})}
});

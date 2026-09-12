import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
let port,base;
let server,browser,evidence;

test.before(async()=>{
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));port=probe.address().port;await new Promise(resolve=>probe.close(resolve));base=`http://127.0.0.1:${port}`;
  const work=await mkdtemp(path.join(os.tmpdir(),'ynx-exchange-browser-'));
  evidence=path.join(repo,'tmp','exchange-browser-evidence');await mkdir(evidence,{recursive:true});
	server=spawn('go',['run','./apps/exchange/server'],{cwd:repo,detached:true,env:{...process.env,YNX_EXCHANGE_ADMIN_API_KEY:'browser-test-admin-123456',YNX_EXCHANGE_STATE_PATH:path.join(work,'state.json'),YNX_EXCHANGE_HTTP_ADDR:`127.0.0.1:${port}`},stdio:['ignore','pipe','pipe']});
  let startup='';server.stderr.on('data',chunk=>{startup+=chunk.toString()});
  for(let i=0;i<240;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,250));if(i===239)throw new Error(`exchange server did not become healthy: ${startup.slice(-2000)}`)}
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
});
test.after(async()=>{await browser?.close();if(server?.pid){try{process.kill(-server.pid,'SIGTERM')}catch{}}});

test('desktop terminal is truthful, keyboard reachable and structurally dense',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'YNXT / YUSD_TEST'}).waitFor();
  await page.getByText('No public market depth').waitFor();
  assert.equal(await page.getByText('TESTNET ONLY').count(),1);
  const chart=await page.locator('#market .chart').boundingBox(),book=await page.locator('.book').boundingBox(),order=await page.locator('.order-entry').boundingBox();
  assert.ok(chart&&book&&order&&chart.y===book.y&&book.y===order.y,'desktop panels should share the terminal row');
  await page.keyboard.press('Tab');assert.equal(await page.locator('.skip').evaluate(el=>el===document.activeElement),true);await page.evaluate(()=>document.activeElement?.blur());
  await page.getByRole('button',{name:'Compare executable costs'}).click();await page.getByText('No complete executable route').waitFor();assert.equal(await page.locator('.route-candidate.unavailable').count(),2);
	assert.equal(errors.length,0,errors.join('\n'));await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});await page.screenshot({path:path.join(evidence,'desktop.png'),fullPage:true});await page.close();
});

test('mobile terminal is responsive without horizontal overflow',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});await page.goto(base,{waitUntil:'networkidle'});
  const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));assert.ok(metrics.scroll<=metrics.width,JSON.stringify(metrics));
  const chart=await page.locator('#market .chart').boundingBox(),book=await page.locator('.book').boundingBox();assert.ok(chart&&book&&book.y>chart.y+chart.height-2,'mobile panels should stack');
  await page.getByRole('button',{name:'Assets'}).click();await page.getByRole('heading',{name:'Deposit & withdrawal'}).waitFor();
	assert.ok(await page.getByText('Cross-chain · unavailable').count()>=1);await page.evaluate(()=>{scrollTo(0,0);document.activeElement?.blur()});await page.screenshot({path:path.join(evidence,'mobile.png')});
  await page.locator('#connect').click();await page.locator('#wallet-request').click();await page.getByText('YNX Wallet provider was not detected.',{exact:false}).waitFor();assert.equal(await page.locator('#wallet-dialog').evaluate(el=>el.getBoundingClientRect().width<=document.documentElement.clientWidth),true);await page.screenshot({path:path.join(evidence,'wallet-no-provider-mobile.png')});await page.close();
});

test('read requests recover after two transport failures while unsigned POST never leaves the browser',async()=>{
  const page=await browser.newPage({viewport:{width:1100,height:760}});let reads=0,posts=0;
  await page.route('**/api/v1/orderbook',async route=>{const method=route.request().method();if(method==='GET'&&++reads<3)return route.abort('failed');if(method==='POST'){posts++;return route.abort('failed')}return route.continue()});
  await page.goto(base);for(let i=0;i<40&&reads<3;i++)await page.waitForTimeout(250);assert.ok(reads>=3&&reads<=4,`bounded retry plus at most one stream snapshot refresh expected, got ${reads}`);await page.getByText(/YNX Testnet (live stream )?connected/).waitFor({timeout:15000});
  await page.evaluate(async()=>{try{await api('/v1/orderbook',{method:'POST'})}catch{}});assert.equal(posts,0);
  await page.close();
});

test('real local HTTP serves the exact wallet bundle as JavaScript with fixed private CSP authority',async()=>{
  const response=await fetch(base+'/wallet-auth.js'),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.deepEqual(bytes,readFileSync(path.join(repo,'apps/exchange/web/wallet-auth.js')));
  const root=await fetch(base+'/');assert.match(root.headers.get('content-security-policy'),/connect-src 'self' https:\/\/wallet-auth\.ynxweb4\.com;/);assert.doesNotMatch(root.headers.get('content-security-policy'),/rpc\.ynxweb4/);
  assert.equal(createHash('sha256').update(bytes).digest('hex').length,64);
});

test('real Chrome absent-provider routes preserve guest URL/tab and expose official independent fallbacks',async()=>{
  const context=await browser.newContext({viewport:{width:1200,height:850}}),page=await context.newPage();const writes=[],external=[];
  page.on('request',request=>{if(request.method()!=='GET')writes.push(request.url());if(!request.url().startsWith(base))external.push(request.url())});
  await page.goto(base,{waitUntil:'networkidle'});const before=page.url();await page.locator('#connect').click();await page.locator('#wallet-request').click();await page.getByText('YNX Wallet provider was not detected.',{exact:false}).waitFor();
  await page.locator('#metamask-request').click();await page.getByText('MetaMask provider was not detected.',{exact:false}).waitFor();
  assert.equal(await page.locator('#wallet-downloads a[href="https://www.ynxweb4.com/dapp/download"]').count(),1);assert.equal(await page.locator('#wallet-downloads a[href="https://metamask.io/download/"]').count(),1);
  assert.equal(page.url(),before);assert.equal(context.pages().length,1);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);await page.screenshot({path:path.join(evidence,'wallet-no-provider-desktop.png')});await context.close();
});

test('local browser HTML fallback and legacy callback cannot become account data or auto-submit an order',async()=>{
  const context=await browser.newContext(),page=await context.newPage();let posts=0;
  page.on('request',request=>{if(request.method()!=='GET')posts++});
  await page.goto(base+'/wallet-action/callback?result=legacy-opaque',{waitUntil:'networkidle'});
  await page.route('**/api/v1/not-json',route=>route.fulfill({status:200,contentType:'text/html',body:'<html>Fallback</html>'}));
  const error=await page.evaluate(async()=>{try{await api('/v1/not-json');return null}catch(error){return error.message}});assert.match(error,/HTML fallback/);
  const write=await page.evaluate(async()=>{try{await window.YNXExchangeWallet.placeSpotOrder({});return null}catch(error){return error.message}});assert.match(write,/Nothing was submitted/);assert.equal(posts,0);assert.equal(await page.evaluate(()=>window.YNXExchangeWallet.connected()),false);assert.equal(context.pages().length,1);await context.close();
});

test('offline fixture providers exercise chooser close, silent restore, events and private degradation in real Chrome; not real approval',async()=>{
  const context=await browser.newContext({viewport:{width:1200,height:850}});
  // The shared Standard SDK correctly requires HTTPS. Route this test-only
  // reserved origin to local server bytes; no DNS/public request is performed.
  const fixtureOrigin='https://exchange.test.invalid';
  await context.route(fixtureOrigin+'/**',async route=>{const url=new URL(route.request().url());const response=await fetch(base+url.pathname+url.search);await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})});
  await context.routeWebSocket('**',socket=>socket.close());
  await context.addInitScript(()=>{
    const make=kind=>{const listeners=new Map();let account='0x0123456789abcdef0123456789abcdef01234567',chain='0x1917';return {isYNXWallet:kind==='ynx',isMetaMask:kind==='metamask',providerInfo:{rdns:kind==='ynx'?'com.ynx.wallet':'io.metamask'},calls:[],on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},removeListener(name,fn){listeners.get(name)?.delete(fn)},emit(name,value){if(name==='accountsChanged')account=value[0]||null;if(name==='chainChanged')chain=value;for(const fn of listeners.get(name)||[])fn(value)},async request(request){this.calls.push(request.method);if(request.method==='wallet_switchEthereumChain'||request.method==='wallet_addEthereumChain')return null;if(request.method==='eth_chainId')return chain;if(request.method==='eth_accounts'||request.method==='eth_requestAccounts')return account?[account]:[];if(request.method==='wallet_revokePermissions'){account=null;return null}throw Error('Unexpected fixture method')}}};
    window.fixtureYNX=make('ynx');window.fixtureMetaMask=make('metamask');window.ethereum={providers:[window.fixtureYNX,window.fixtureMetaMask]};
  });
  const page=await context.newPage();await page.goto(fixtureOrigin,{waitUntil:'networkidle'});const before=page.url();await page.locator('#connect').click();await page.locator('#metamask-request').click();await page.waitForFunction(()=>window.YNXExchangeWebWallet.state().status==='connected');
  assert.equal(await page.locator('#wallet-dialog').evaluate(el=>el.open),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'connect');assert.match(await page.locator('#connect').textContent(),/MetaMask/);assert.deepEqual(await page.evaluate(()=>window.fixtureYNX.calls),[]);assert.equal(await page.evaluate(()=>window.fixtureMetaMask.calls.filter(x=>x==='eth_requestAccounts').length),1);
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));assert.equal(await page.evaluate(()=>window.YNXExchangeWebWallet.state().status),'connected');assert.match(await page.locator('#private-state').textContent(),/Standard Wallet connection is unchanged/);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.YNXExchangeWebWallet.state().status==='connected');assert.deepEqual(await page.evaluate(()=>window.fixtureMetaMask.calls),['eth_accounts','eth_chainId']);
  await page.locator('#connect').click();await page.locator('#standard-wallet-account').waitFor();await page.screenshot({path:path.join(evidence,'wallet-fixture-details.png')});
  await page.evaluate(()=>window.fixtureMetaMask.emit('chainChanged','0x1'));assert.notEqual(await page.evaluate(()=>window.YNXExchangeWebWallet.state().status),'connected');await page.evaluate(()=>window.fixtureMetaMask.emit('chainChanged','0x1917'));await page.locator('#connect').click();await page.locator('#wallet-disconnect').click();assert.notEqual(await page.evaluate(()=>window.YNXExchangeWebWallet.state().status),'connected');
  assert.equal(page.url(),before);assert.equal(context.pages().length,1);await context.close();
});

test('market WebSocket reconnects with a persisted sequence cursor',async()=>{
  const page=await browser.newPage({viewport:{width:1100,height:760}});const sockets=[];page.on('websocket',socket=>sockets.push(socket));await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>marketSocket?.readyState===WebSocket.OPEN,null,{timeout:15000});assert.equal(sockets.length,1);const firstURL=sockets[0].url();assert.match(firstURL,/\/api\/v1\/ws\/market$/);const cursor=await page.evaluate(()=>marketCursor);assert.ok(cursor>=0);await page.evaluate(()=>marketSocket.close());for(let i=0;i<40&&sockets.length<2;i++)await page.waitForTimeout(250);assert.ok(sockets.length>=2,'market stream did not reconnect');await page.waitForFunction(()=>marketSocket?.readyState===WebSocket.OPEN,null,{timeout:15000});await page.getByText('YNX Testnet live stream connected').waitFor({timeout:15000});if(cursor>0)assert.match(sockets.at(-1).url(),new RegExp(`after=${cursor}`));await page.close();
});

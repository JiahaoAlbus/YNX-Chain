// Original shipped viewer, synthetic SDK authority and local intercepted network.
// The formal origin is emulated inside this headless context only; no public QA claim.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:['/Users/huangjiahao/.codex/worktrees/android-installed-gate-main-20261001/apps/finance']}));
const root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));let pending=[],returned='ynx1a',fail=false;
 await page.addInitScript(()=>{window.identityFixture={account:'ynx1a',sessionBinding:'fixture_original_a',deviceId:'original',deviceKey:'original',expiresAt:new Date(Date.now()+300000).toISOString()};window.notifyIdentity=null;});
 await page.route('https://video.ynxweb4.com/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/product-session.js'){await route.fulfill({contentType:'text/javascript',body:`export const VIDEO_ORIGIN='https://video.ynxweb4.com';export const videoProductSession={atRegisteredOrigin:()=>true,restore:async()=>({status:'connected',session:window.identityFixture}),authorization:async()=>({'X-YNX-Product-Session-Proof-V2':'isolated-fixture','X-YNX-Product-Business-Proof-V2':'isolated-fixture'}),subscribe:fn=>{window.notifyIdentity=fn;return ()=>{}},disconnect:async()=>({status:'disconnected'}),rememberReturn(){},consumeReturn(){}};export function dispatchPreparedProductRequest(){throw Error('not tested')}`});return}
  if(url.pathname.startsWith('/video/api/')){
   calls.push(url.pathname);if(url.pathname==='/video/api/v1/account'){pending.push({route,account:returned,fail});return}
   await route.fulfill({contentType:'application/json',body:'[]'});return;
  }
  const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep)){await route.fulfill({status:403});return}
  try{await route.fulfill({contentType:file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.png')?'image/png':'text/html',body:fs.readFileSync(file)})}catch{await route.fulfill({status:404})}
 });
 async function waitPending(){await page.waitForFunction(()=>document.querySelector('#product-status').textContent.startsWith('Checking your Video account'));while(!pending.length)await new Promise(r=>setTimeout(r,10));}
 async function reply(){const item=pending.shift();await item.route.fulfill({status:item.fail?503:200,contentType:'application/json',body:JSON.stringify(item.fail?{error:'Original Video service unavailable'}:{schemaVersion:1,account:item.account})});}
 await page.goto('https://video.ynxweb4.com/',{waitUntil:'domcontentloaded'});await waitPending();assert.equal(await page.locator('#comment button').isDisabled(),true);assert.equal(calls.some(x=>/history|playlists|subscriptions/.test(x)),false);await reply();await page.waitForFunction(()=>document.querySelector('#product-status').textContent.startsWith('Signed in as'));assert.equal(await page.locator('#comment button').isDisabled(),false);console.log('PASS shipped viewer holds private actions until original account GET succeeds');
 returned='ynx1wrong';await page.evaluate(()=>notifyIdentity());await waitPending();await reply();await page.waitForFunction(()=>document.querySelector('#product-status').textContent.includes('different account'));assert.equal(await page.locator('#comment button').isDisabled(),true);console.log('PASS original service actor mismatch refuses signed-in library');
 returned='ynx1a';await page.evaluate(()=>notifyIdentity());await waitPending();const late=pending.shift();returned='ynx1b';await page.evaluate(()=>{identityFixture={...identityFixture,account:'ynx1b',sessionBinding:'fixture_original_b'};notifyIdentity()});await waitPending();await reply();await page.waitForFunction(()=>document.querySelector('#product-status').textContent.startsWith('Signed in as'));await late.route.fulfill({contentType:'application/json',body:JSON.stringify({schemaVersion:1,account:'ynx1a'})}).catch(()=>{});assert.match(await page.locator('#product-status').innerText(),/ynx1b/);console.log('PASS replacement B readback wins and late A cannot overwrite it');
 fail=true;await page.evaluate(()=>notifyIdentity());await waitPending();await reply();await page.waitForFunction(()=>document.querySelector('#product-status').textContent.includes('Original Video service unavailable'));assert.equal(await page.locator('#comment button').isDisabled(),true);console.log('PASS unavailable business service retains guest playback and refuses private actions');
 assert.deepEqual(errors,[]);await page.screenshot({path:path.resolve(root,'audit/evidence/business-identity-20261003/viewer-readback-unavailable-390.png'),fullPage:true});
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

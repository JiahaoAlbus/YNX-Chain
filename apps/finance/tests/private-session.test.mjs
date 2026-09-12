import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

// Adapted from the sibling Quant owner's local fixture structure, with Finance's
// independent exact product bindings and actual shipped assets.
// Actual Chromium/WebCrypto/IndexedDB + unchanged bundled SDK. HTTPS requests
// are intercepted in-process. No public service, installed Wallet or approval.
const ORIGIN='https://finance.ynxweb4.com',AUTH='https://wallet-auth.ynxweb4.com';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});});
test.after(async()=>{await browser.close();});
async function setup(){
  const context=await browser.newContext();const calls=[];let time=Date.now(),clockOffline=false,clockGate=null;
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===AUTH){
      calls.push({url:request.url(),method:request.method()});
      if(clockOffline)return route.abort('failed');
      if(clockGate){const pending=clockGate;clockGate=null;pending.onEnter();await pending;}
      assert.equal(url.pathname,'/v2/product-sessions/time');
      const cors={'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'x-request-id, content-type, x-ynx-product-session-proof-v2','access-control-expose-headers':'x-request-id, cache-control'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
      const requestId=request.headers()['x-request-id'];
      return route.fulfill({status:200,headers:{...cors,'content-type':'application/json','cache-control':'no-store','x-request-id':requestId},body:canonical({ok:true,requestId,result:{serverTime:new Date(time).toISOString()},schemaVersion:2})});
    }
    assert.equal(url.origin,ORIGIN,'no unapproved external request');
    if(url.pathname==='/health')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,chainId:'ynx_6423-1',portfolio:'read-only'})});
    const file=url.pathname==='/'||url.pathname==='/wallet-auth/callback'?'index.html':url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/.test(file))return route.fulfill({status:404,body:''});
    try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../web/'+file,import.meta.url))});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();await page.goto(ORIGIN);
  await page.waitForFunction(()=>!!window.YNXFinanceWallet);
  return {context,page,calls,advance:ms=>{time+=ms;},offline:value=>{clockOffline=value;},holdClock:()=>{let release,onEnter;const entered=new Promise(resolve=>{onEnter=resolve;});clockGate=new Promise(resolve=>{release=resolve;});clockGate.onEnter=onEnter;release.entered=entered;return release;}};
}
async function records(page){return page.evaluate(async()=>{
  if(!(await indexedDB.databases()).some(db=>db.name==='ynx-product-session-web-v2'))return null;
  return new Promise((resolve,reject)=>{const open=indexedDB.open('ynx-product-session-web-v2');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['devices','state'],'readonly'),devices=tx.objectStore('devices').getAll(),states=tx.objectStore('state').getAll();tx.oncomplete=()=>{const d=devices.result.find(x=>x.authority==='https://wallet-auth.ynxweb4.com'),s=states.result.find(x=>x.authority==='https://wallet-auth.ynxweb4.com');db.close();resolve({deviceId:d?.deviceId,privateExtractable:d?.privateKey?.extractable,publicKey:d?.deviceKey,values:s?.values||{}});};};});
});}
async function begin(page){await page.locator('#private-begin').click();await page.waitForFunction(()=>['connecting','retry-required','degraded','network-unavailable'].includes(window.YNXFinanceWallet.getPrivateState().status));}
const pending=data=>JSON.parse(Object.entries(data.values).find(([key])=>key.endsWith(':pending'))?.[1]||'null');

test('guest creates no private key/session or account request; explicit Sign in persists canonical pending and never launches a tab',async()=>{
  const f=await setup();try{
    assert.equal(await records(f.page),null);assert.deepEqual(f.calls,[]);
    await begin(f.page);const r=await records(f.page),request=pending(r);
    assert.ok(request,JSON.stringify({state:await f.page.evaluate(()=>window.YNXFinanceWallet.getPrivateState()),records:r,calls:f.calls}));
    assert.equal(r.privateExtractable,false);assert.equal(request.productId,'finance');assert.deepEqual(request.scopes,['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write']);
    assert.equal(request.callback,ORIGIN+'/wallet-auth/callback');assert.equal(request.origin,ORIGIN);assert.equal(request.platform,'web');
    assert.equal(f.context.pages().length,1);assert.equal(f.page.url(),ORIGIN+'/');
    const href=await f.page.locator('#private-open').getAttribute('href');assert.match(href,/^ynxwallet:\/\/authorize\?request=/);assert.equal(await f.page.locator('#private-open').getAttribute('target'),null);
    assert.equal((await f.page.evaluate(()=>window.YNXFinanceWallet.getPrivateState())).installation,'unverified');
    assert.equal((await f.page.evaluate(()=>window.YNXFinanceWallet.getPrivateState())).session,null);
    assert.equal(f.calls.every(x=>x.url===AUTH+'/v2/product-sessions/time'),true);
  }finally{await f.context.close();}
});
test('two actual tabs reuse nonextractable device; complete rejected callback is bound and late replay grants nothing',async()=>{
  const f=await setup();try{
    await begin(f.page);const a=await records(f.page),old=pending(a);
    const second=await f.context.newPage();await second.goto(ORIGIN);await second.waitForFunction(()=>window.YNXFinanceWallet?.getPrivateState().status==='connecting');
    const b=await records(second);assert.equal(a.deviceId,b.deviceId);assert.equal(b.privateExtractable,false);
    assert.equal(pending(b).nonce,old.nonce);
    const request=pending(b),callback=new URL(ORIGIN+'/wallet-auth/callback');for(const [key,value] of Object.entries({result:'rejected',reason:'user_rejected',nonce:request.nonce,state:request.state}))callback.searchParams.set(key,value);
    await second.goto(callback.href);await second.waitForFunction(()=>window.YNXFinanceWallet?.getPrivateState().status==='disconnected');
    assert.equal(pending(await records(second)),null);
    callback.searchParams.set('nonce',old.nonce);callback.searchParams.set('state',old.state);
    await f.page.goto(callback.href);await f.page.waitForFunction(()=>window.YNXFinanceWallet?.getPrivateState().status==='retry-required');
    assert.equal((await f.page.evaluate(()=>window.YNXFinanceWallet.getPrivateState())).session,null);
    assert.equal(f.calls.some(x=>/challenge|complete/.test(x.url)),false);
  }finally{await f.context.close();}
});
test('cold pending restore uses the fixed SDK and preserves exact original URI, nonce, state and device',async()=>{
  const f=await setup();try{
    await begin(f.page);const before=await records(f.page),request=pending(before),href=await f.page.locator('#private-open').getAttribute('href');
    await f.page.reload();await f.page.waitForFunction(()=>window.YNXFinanceWallet?.getPrivateState().status==='connecting');
    const after=await records(f.page);assert.deepEqual(pending(after),request);assert.equal(after.deviceId,before.deviceId);assert.equal(after.privateExtractable,false);
    assert.equal(await f.page.locator('#private-open').getAttribute('href'),href);
    assert.equal((await f.page.evaluate(()=>window.YNXFinanceWallet.getPrivateState())).installation,'unverified');
    assert.equal(await f.page.evaluate(()=>window.YNXFinanceWallet.connected()),false);assert.equal(f.page.url(),ORIGIN+'/');assert.equal(f.context.pages().length,1);
    assert.equal(f.calls.filter(x=>x.method==='GET'&&x.url===AUTH+'/v2/product-sessions/time').length,2);
  }finally{await f.context.close();}
});
test('pending cold restore during clock outage retains the request; explicit Retry offers the same URL',async()=>{
  const f=await setup();try{
    await begin(f.page);const before=await records(f.page),href=await f.page.locator('#private-open').getAttribute('href');
    f.offline(true);await f.page.reload();await f.page.waitForFunction(()=>window.YNXFinanceWallet?.getPrivateState().status==='network-unavailable');
    assert.deepEqual(pending(await records(f.page)),pending(before));assert.equal(await f.page.locator('#private-open').isVisible(),false);
    f.offline(false);await f.page.locator('#private-retry').click();await f.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='connecting');
    assert.equal(await f.page.locator('#private-open').getAttribute('href'),href);assert.deepEqual(pending(await records(f.page)),pending(before));
    assert.equal(await f.page.evaluate(()=>window.YNXFinanceWallet.connected()),false);assert.equal(f.context.pages().length,1);
  }finally{await f.context.close();}
});
test('expired pending cold restore keeps exact request but never offers a stale approval URL or new request',async()=>{
  const f=await setup();try{
    await begin(f.page);const before=await records(f.page);f.advance(10*60*1000);
    await f.page.reload();await f.page.waitForFunction(()=>window.YNXFinanceWallet?.getPrivateState().status==='retry-required');
    assert.deepEqual(pending(await records(f.page)),pending(before));assert.equal(await f.page.locator('#private-open').isVisible(),false);
    assert.equal(await f.page.evaluate(()=>window.YNXFinanceWallet.connected()),false);assert.equal(f.context.pages().length,1);
  }finally{await f.context.close();}
});
test('foreign binding in pending cold restore is retained and rejected before any new authority lookup',async()=>{
  const f=await setup();try{
    await begin(f.page);
    await f.page.evaluate(()=>new Promise(resolve=>{const q=indexedDB.open('ynx-product-session-web-v2');q.onsuccess=()=>{const db=q.result,tx=db.transaction('state','readwrite'),cursor=tx.objectStore('state').openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;if(row.value.authority==='https://wallet-auth.ynxweb4.com'){const value=row.value,key=Object.keys(value.values).find(k=>k.endsWith(':pending')),request=JSON.parse(value.values[key]);request.origin='https://foreign.example';value.values[key]=JSON.stringify(request);row.update(value);}else row.continue();};tx.oncomplete=()=>{db.close();resolve();};};}));
    const tampered=pending(await records(f.page)),beforeCalls=f.calls.length;
    await f.page.reload();await f.page.waitForFunction(()=>['retry-required','degraded'].includes(window.YNXFinanceWallet?.getPrivateState().status));
    // The browser storage validator may reject the foreign record before the
    // recoverable client is constructed; that shared fail-closed error is
    // rendered as private degraded, never converted into a new request.
    assert.deepEqual(pending(await records(f.page)),tampered);assert.equal(f.calls.length,beforeCalls);
    assert.equal(await f.page.locator('#private-open').isVisible(),false);assert.equal(await f.page.evaluate(()=>window.YNXFinanceWallet.connected()),false);
  }finally{await f.context.close();}
});
test('late authority clock response after explicit Guest cannot reopen the saved request',async()=>{
  const f=await setup();let release;try{
    await begin(f.page);const calls=f.calls.length;release=f.holdClock();
    await f.page.reload();await f.page.waitForFunction(()=>window.YNXFinanceWallet?.getPrivateState().status==='checking');await release.entered;
    await f.page.locator('#private-guest').click();release();release=null;
    await f.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='guest');await f.page.waitForTimeout(100);
    assert.equal(await f.page.locator('#private-open').isVisible(),false);assert.equal(await f.page.evaluate(()=>window.YNXFinanceWallet.connected()),false);
    assert.equal(f.context.pages().length,1);assert.equal(f.page.url(),ORIGIN+'/');assert.ok(f.calls.length>=calls);
  }finally{release?.();await f.context.close();}
});
test('expired pending callback, network loss and retry never create private authority',async()=>{
  const f=await setup();try{
    await begin(f.page);const p=pending(await records(f.page));f.advance(10*60*1000);
    const url=new URL(ORIGIN+'/wallet-auth/callback');for(const [k,v] of Object.entries({result:'rejected',reason:'user_rejected',nonce:p.nonce,state:p.state}))url.searchParams.set(k,v);
    await f.page.goto(url.href);await f.page.waitForFunction(()=>window.YNXFinanceWallet?.getPrivateState().status==='retry-required');
    assert.equal(pending(await records(f.page)),null);
    f.offline(true);await f.page.locator('#private-retry').click();await f.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='network-unavailable');
    f.offline(false);await f.page.locator('#private-retry').click();await f.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='retry-required');
    assert.equal(f.context.pages().length,1);
  }finally{await f.context.close();}
});
test('unknown or old authority records are preserved and never adopted by new authority',async()=>{
  const f=await setup();try{
    await f.page.evaluate(async()=>{await new Promise(resolve=>{const q=indexedDB.open('ynx-product-session-web-v2',1);q.onupgradeneeded=()=>{q.result.createObjectStore('devices');q.result.createObjectStore('state');};q.onsuccess=()=>{const db=q.result,tx=db.transaction(['devices','state'],'readwrite');for(const name of ['devices','state']){tx.objectStore(name).put({version:1,sentinel:'legacy-not-imported'},'legacy-namespace');tx.objectStore(name).put({version:2,authority:'https://old-auth.example',sentinel:'old-authority-not-imported'},'old-authority-namespace');}tx.oncomplete=()=>{db.close();resolve();};};});});
    await begin(f.page);assert.equal((await f.page.evaluate(()=>window.YNXFinanceWallet.getPrivateState())).status,'connecting');
    const preserved=await f.page.evaluate(()=>new Promise(resolve=>{const q=indexedDB.open('ynx-product-session-web-v2');q.onsuccess=()=>{const db=q.result,tx=db.transaction(['devices','state'],'readonly'),results=[];for(const name of ['devices','state'])for(const key of ['legacy-namespace','old-authority-namespace']){const request=tx.objectStore(name).get(key);request.onsuccess=()=>results.push(request.result.sentinel);}tx.oncomplete=()=>{db.close();resolve(results);};};}));
    assert.deepEqual(preserved.sort(),['legacy-not-imported','legacy-not-imported','old-authority-not-imported','old-authority-not-imported']);
    assert.equal(f.calls.every(x=>x.url===AUTH+'/v2/product-sessions/time'),true);
  }finally{await f.context.close();}
});
test('private failure/revoke pending request does not disconnect restored Standard wallet or expose native proof',async()=>{
  const f=await setup();try{
    await f.page.addInitScript(()=>{localStorage.setItem('ynx.finance.standard-wallet.provider.v2','metamask');window.__providerCalls=[];window.ethereum={isMetaMask:true,isYNXWallet:false,request:async({method})=>{window.__providerCalls.push(method);if(method==='eth_accounts')return ['0x'+'a'.repeat(40)];if(method==='eth_chainId')return '0x1917';throw Error('Unapproved fixture request');},on(){},removeListener(){}};});
    await f.page.reload();await f.page.waitForFunction(()=>window.YNXFinanceWallet?.getStandardWalletState().status==='connected');
    await begin(f.page);await f.page.locator('#private-revoke').click();await f.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='disconnected');
    assert.equal(pending(await records(f.page)),null);assert.equal((await f.page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState())).status,'connected');
    assert.deepEqual((await f.page.evaluate(()=>window.__providerCalls)).slice(0,2),['eth_accounts','eth_chainId']);
    assert.equal((await f.page.evaluate(()=>window.__providerCalls)).some(x=>/requestAccounts|sign|send|switch/.test(x)),false);
    const e=await f.page.evaluate(()=>window.YNXFinanceWallet.requireProof('finance.portfolio.read').catch(e=>e.message));assert.match(e,/PRIVATE_SERVICE_DEGRADED/);
  }finally{await f.context.close();}
});

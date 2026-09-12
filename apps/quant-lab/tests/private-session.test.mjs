import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {privateSessionCopy,privateSessionLocales} from '../web/private-session-copy.js';

// Actual Chromium/WebCrypto/IndexedDB + unchanged bundled SDK. HTTPS requests
// are intercepted in-process. No public service, installed Wallet or approval.
const ORIGIN='https://quant.ynxweb4.com',AUTH='https://wallet-auth.ynxweb4.com';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});});
test.after(async()=>{await browser.close();});
async function setup(){
  const context=await browser.newContext();const calls=[];let time=Date.now(),clockOffline=false;
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===AUTH){
      calls.push({url:request.url(),method:request.method()});
      if(clockOffline)return route.abort('failed');
      assert.equal(url.pathname,'/v2/product-sessions/time');
      const cors={'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'x-request-id, content-type, x-ynx-product-session-proof-v2','access-control-expose-headers':'x-request-id, cache-control'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
      const requestId=request.headers()['x-request-id'];
      return route.fulfill({status:200,headers:{...cors,'content-type':'application/json','cache-control':'no-store','x-request-id':requestId},body:canonical({ok:true,requestId,result:{serverTime:new Date(time).toISOString()},schemaVersion:2})});
    }
    assert.equal(url.origin,ORIGIN,'no unapproved external request');
    if(url.pathname==='/api/v1/snapshot')return route.fulfill({contentType:'application/json',body:JSON.stringify({paper:{Cash:100,Position:0,ReconciliationDelta:0},strategies:{},experiments:{},audit:[]})});
    const file=url.pathname==='/'||url.pathname==='/wallet-auth/callback'?'index.html':url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/.test(file))return route.fulfill({status:404,body:''});
    try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../web/'+file,import.meta.url))});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();await page.goto(ORIGIN);
  await page.waitForFunction(()=>!!window.YNXQuantWallet);
  return {context,page,calls,advance:ms=>{time+=ms;},offline:value=>{clockOffline=value;}};
}
async function records(page){return page.evaluate(async()=>{
  if(!(await indexedDB.databases()).some(db=>db.name==='ynx-product-session-web-v2'))return null;
  return new Promise((resolve,reject)=>{const open=indexedDB.open('ynx-product-session-web-v2');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['devices','state'],'readonly'),devices=tx.objectStore('devices').getAll(),states=tx.objectStore('state').getAll();tx.oncomplete=()=>{const d=devices.result.find(x=>x.authority==='https://wallet-auth.ynxweb4.com'),s=states.result.find(x=>x.authority==='https://wallet-auth.ynxweb4.com');db.close();resolve({deviceId:d?.deviceId,privateExtractable:d?.privateKey?.extractable,publicKey:d?.deviceKey,values:s?.values||{}});};};});
});}
async function begin(page){await page.locator('#private-sign-in').click();await page.waitForFunction(()=>['connecting','retry-required','degraded','network-unavailable'].includes(window.YNXQuantWallet.getPrivateSessionState().status));}
const pending=data=>JSON.parse(Object.entries(data.values).find(([key])=>key.endsWith(':pending'))?.[1]||'null');

test('private controls and dynamic failures follow every locale without signing in a guest',async()=>{
  const f=await setup();try{
    assert.deepEqual(privateSessionLocales,await f.page.evaluate(()=>window.QuantI18n.locales));
    assert.equal(await f.page.locator('#locale').inputValue(),'en');
    for(const locale of privateSessionLocales){
      const copy=privateSessionCopy(locale);await f.page.setViewportSize({width:390,height:844});await f.page.selectOption('#locale',locale);
      assert.equal(await f.page.locator('#private-sign-in').textContent(),copy.signIn);
      const layout=await f.page.evaluate(()=>{const h=document.querySelector('header').getBoundingClientRect(),p=document.querySelector('.private-session-controls').getBoundingClientRect(),buttons=[...document.querySelectorAll('.wallet-controls button')].filter(b=>!b.hidden).map(b=>b.getBoundingClientRect());return {contained:buttons.every(b=>b.top>=h.top&&b.bottom<=h.bottom&&b.left>=h.left&&b.right<=h.right),separate:p.top>=h.bottom,noOverflow:document.documentElement.scrollWidth===document.documentElement.clientWidth};});
      assert.deepEqual(layout,{contained:true,separate:true,noOverflow:true},locale);
      await f.page.locator('#private-account').click();
      assert.ok((await f.page.locator('#private-session-status').textContent()).startsWith(copy.unavailable));
      assert.equal(await f.page.locator('#private-session-status').getAttribute('data-code'),'PRIVATE_SIGN_IN_REQUIRED');
    }
    assert.equal(await records(f.page),null);assert.deepEqual(f.calls,[]);
    f.offline(true);await f.page.selectOption('#locale','fr');await begin(f.page);
    assert.ok((await f.page.locator('#private-session-status').textContent()).startsWith(privateSessionCopy('fr').unavailable));
    await f.page.selectOption('#locale','ar');
    assert.ok((await f.page.locator('#private-session-status').textContent()).startsWith(privateSessionCopy('ar').unavailable));
    assert.equal(f.context.pages().length,1);
  }finally{await f.context.close();}
});

test('guest creates no private key/session or account request; explicit Sign in persists canonical pending and never launches a tab',async()=>{
  const f=await setup();try{
    assert.equal(await records(f.page),null);assert.deepEqual(f.calls,[]);
    await begin(f.page);const r=await records(f.page),request=pending(r);
    assert.ok(request,JSON.stringify({state:await f.page.evaluate(()=>window.YNXQuantWallet.getPrivateSessionState()),records:r,calls:f.calls}));
    assert.equal(r.privateExtractable,false);assert.equal(request.productId,'quant');assert.deepEqual(request.scopes,['quant:account']);
    assert.equal(request.callback,ORIGIN+'/wallet-auth/callback');assert.equal(request.origin,ORIGIN);assert.equal(request.platform,'web');
    assert.equal(f.context.pages().length,1);assert.equal(f.page.url(),ORIGIN+'/');
    const href=await f.page.locator('#private-open-wallet').getAttribute('href');assert.match(href,/^ynxwallet:\/\/authorize\?request=/);assert.equal(await f.page.locator('#private-open-wallet').getAttribute('target'),null);
    assert.equal((await f.page.evaluate(()=>window.YNXQuantWallet.getPrivateSessionState())).installation,'unverified');
    assert.equal((await f.page.evaluate(()=>window.YNXQuantWallet.getPrivateSessionState())).account,null);
    assert.equal(f.calls.every(x=>x.url===AUTH+'/v2/product-sessions/time'),true);
  }finally{await f.context.close();}
});
test('two actual tabs reuse nonextractable device; complete rejected callback is bound and late replay grants nothing',async()=>{
  const f=await setup();try{
    await begin(f.page);const a=await records(f.page),old=pending(a);
    const second=await f.context.newPage();await second.goto(ORIGIN);await second.waitForFunction(()=>window.YNXQuantWallet?.getPrivateSessionState().status==='awaiting-return');
    const b=await records(second);assert.equal(a.deviceId,b.deviceId);assert.equal(b.privateExtractable,false);
    assert.equal(pending(b).nonce,old.nonce);
    const request=pending(b),callback=new URL(ORIGIN+'/wallet-auth/callback');for(const [key,value] of Object.entries({result:'rejected',reason:'user_rejected',nonce:request.nonce,state:request.state}))callback.searchParams.set(key,value);
    await second.goto(callback.href);await second.waitForFunction(()=>window.YNXQuantWallet?.getPrivateSessionState().status==='disconnected');
    assert.equal(pending(await records(second)),null);
    callback.searchParams.set('nonce',old.nonce);callback.searchParams.set('state',old.state);
    await f.page.goto(callback.href);await f.page.waitForFunction(()=>window.YNXQuantWallet?.getPrivateSessionState().status==='retry-required');
    assert.equal((await f.page.evaluate(()=>window.YNXQuantWallet.getPrivateSessionState())).account,null);
    assert.equal(f.calls.some(x=>/challenge|complete/.test(x.url)),false);
  }finally{await f.context.close();}
});
test('expired pending callback, network loss and retry never create private authority',async()=>{
  const f=await setup();try{
    await begin(f.page);const p=pending(await records(f.page));f.advance(10*60*1000);
    const url=new URL(ORIGIN+'/wallet-auth/callback');for(const [k,v] of Object.entries({result:'rejected',reason:'user_rejected',nonce:p.nonce,state:p.state}))url.searchParams.set(k,v);
    await f.page.goto(url.href);await f.page.waitForFunction(()=>window.YNXQuantWallet?.getPrivateSessionState().status==='retry-required');
    assert.equal(pending(await records(f.page)),null);
    f.offline(true);await f.page.locator('#private-retry').click();await f.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='network-unavailable');
    f.offline(false);await f.page.locator('#private-retry').click();await f.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='retry-required');
    assert.equal(f.context.pages().length,1);
  }finally{await f.context.close();}
});
test('unknown or old authority records are preserved and never adopted by new authority',async()=>{
  const f=await setup();try{
    await f.page.evaluate(async()=>{await new Promise(resolve=>{const q=indexedDB.open('ynx-product-session-web-v2',1);q.onupgradeneeded=()=>{q.result.createObjectStore('devices');q.result.createObjectStore('state');};q.onsuccess=()=>{const db=q.result,tx=db.transaction(['devices','state'],'readwrite');for(const name of ['devices','state']){tx.objectStore(name).put({version:1,sentinel:'legacy-not-imported'},'legacy-namespace');tx.objectStore(name).put({version:2,authority:'https://old-auth.example',sentinel:'old-authority-not-imported'},'old-authority-namespace');}tx.oncomplete=()=>{db.close();resolve();};};});});
    await begin(f.page);assert.equal((await f.page.evaluate(()=>window.YNXQuantWallet.getPrivateSessionState())).status,'connecting');
    const preserved=await f.page.evaluate(()=>new Promise(resolve=>{const q=indexedDB.open('ynx-product-session-web-v2');q.onsuccess=()=>{const db=q.result,tx=db.transaction(['devices','state'],'readonly'),results=[];for(const name of ['devices','state'])for(const key of ['legacy-namespace','old-authority-namespace']){const request=tx.objectStore(name).get(key);request.onsuccess=()=>results.push(request.result.sentinel);}tx.oncomplete=()=>{db.close();resolve(results);};};}));
    assert.deepEqual(preserved.sort(),['legacy-not-imported','legacy-not-imported','old-authority-not-imported','old-authority-not-imported']);
    assert.equal(f.calls.every(x=>x.url===AUTH+'/v2/product-sessions/time'),true);
  }finally{await f.context.close();}
});
test('private failure/revoke pending request does not disconnect restored Standard wallet or expose native proof',async()=>{
  const f=await setup();try{
    await f.page.addInitScript(()=>{localStorage.setItem('ynx.quant.standard-wallet.v1.provider','metamask');window.__providerCalls=[];window.ethereum={isMetaMask:true,isYNXWallet:false,request:async({method})=>{window.__providerCalls.push(method);if(method==='eth_accounts')return ['0x'+'a'.repeat(40)];if(method==='eth_chainId')return '0x1917';throw Error('Unapproved fixture request');},on(){},removeListener(){}};});
    await f.page.reload();await f.page.waitForFunction(()=>window.YNXQuantWallet?.getStandardWalletState().status==='connected');
    await begin(f.page);await f.page.locator('#private-sign-out').click();await f.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='disconnected');
    assert.equal(pending(await records(f.page)),null);assert.equal((await f.page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState())).status,'connected');
    assert.deepEqual((await f.page.evaluate(()=>window.__providerCalls)).slice(0,2),['eth_accounts','eth_chainId']);
    assert.equal((await f.page.evaluate(()=>window.__providerCalls)).some(x=>/requestAccounts|sign|send|switch/.test(x)),false);
    const e=await f.page.evaluate(()=>window.YNXQuantWallet.requireProof('quant:mandate:create').catch(e=>e.code));assert.equal(e,'NATIVE_MANDATE_SIGNATURE_AND_EXCHANGE_V2_ADAPTER_REQUIRED');
  }finally{await f.context.close();}
});

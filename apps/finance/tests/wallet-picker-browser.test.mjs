import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

// Actual Finance DOM, controller, QR renderer and original Pair adapter run in
// Chromium. Only the adapter's SignClient factory is replaced at build time by
// an isolated transport fixture. This is not real Relay/installed/public QA.
let server,browser,base;
test.before(async()=>{
  const web=new URL('../web/',import.meta.url);
  const compiled=await build({entryPoints:[new URL('wallet-auth-entry.js',web).pathname],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',plugins:[{name:'isolated-pair-transport',setup(build){build.onLoad({filter:/walletconnect-dapp-connection\.js$/},async({path})=>({contents:(await readFile(path,'utf8')).replace('clientFactory??(options=>officialClient','clientFactory??window.__pickerQA.factory??(options=>officialClient'),loader:'js'}));}}]});
  server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://fixture').pathname;
    if(path==='/wallet-auth.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(compiled.outputFiles[0].contents);}
    if(path.startsWith('/api/')||path==='/health'){res.writeHead(path==='/health'?200:401,{'content-type':'application/json'});return res.end(JSON.stringify(path==='/health'?{ok:true}:{error:{code:'UNAUTHORIZED'}}));}
    const file=path==='/'?'index.html':path.slice(1);if(!/^[a-z0-9.-]+$/.test(file)){res.writeHead(404);return res.end();}
    try{res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html'});res.end(await readFile(new URL(file,web)));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;browser=await chromium.launch(await financeBrowserLaunchOptions());
});
test.after(async()=>{await browser?.close();server?.closeAllConnections();await new Promise(resolve=>server?.close(resolve));});
async function pageFixture({reject=false,deferYNX=false}={}){
  const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('https://**',route=>route.abort());
  await page.addInitScript(({reject,deferYNX})=>{
    const q={counts:{connect:0,sign:0,init:0,pair:0,disconnect:0,cancel:0},events:new Map()};window.__pickerQA=q;
    const account='0x'+'1'.repeat(40),topic='a'.repeat(64);let current=null;
    q.factory=async()=>{q.counts.init++;return {on:(name,fn)=>q.events.set(name,fn),session:{getAll:()=>current?[current]:[]},core:{pairing:{disconnect:async()=>{q.counts.cancel++;if(q.failCancel)throw new Error('offline');}}},connect:async input=>{q.counts.pair++;q.proposalMethods=input.requiredNamespaces.eip155.methods;if(q.relayFailure)throw new Error('wc:secret-untrusted-network-detail');if(q.deferRelay)return new Promise((_,reject)=>q.finishRelay=()=>reject(new Error('wc:late-network-detail')));return {uri:`wc:${topic}@2?relay-protocol=irn&symKey=${'2'.repeat(64)}`,approval:()=>new Promise((resolve,reject)=>{q.approve=()=>{current={topic,expiry:Math.floor(Date.now()/1000)+600,peer:{metadata:{url:'https://wallet.ynxweb4.com'}},namespaces:{eip155:{accounts:[`eip155:6423:${account}`],chains:['eip155:6423'],methods:q.proposalMethods,events:['accountsChanged','chainChanged']}}};resolve(current);};q.reject=()=>reject(Object.assign(new Error('untrusted Pair detail'),{code:q.rejectionCode??4001}));})};},disconnect:async()=>{q.counts.disconnect++;if(q.failDisconnect)throw new Error('offline');current=null;},request:async({request,expiry})=>{q.counts.sign++;q.requestMethod=request.method;q.transportExpiry=expiry;return {version:2,returnUrl:'isolated-return'};}};};
    function provider(kind){return {isYNXWallet:kind==='ynx',isMetaMask:kind==='meta',on(){},removeListener(){},request:async({method})=>{if(method==='eth_requestAccounts'){q.counts.connect++;if(kind==='ynx'&&deferYNX)return new Promise(resolve=>q.finishYNX=()=>resolve([account]));if(reject)throw Object.assign(new Error('untrusted secret-like detail'),{code:4001});}if(method==='personal_sign')q.counts.sign++;if(['eth_accounts','eth_requestAccounts'].includes(method))return [account];if(method==='eth_chainId')return '0x1917';if(method==='wallet_switchEthereumChain')return null;throw new Error('fixture unavailable');}};}
    const ynx=provider('ynx'),meta=provider('meta');ynx.providerInfo={rdns:'com.ynx.wallet',name:'YNX Wallet',uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};ynx.__ynxCompanion=true;meta.providerInfo={rdns:'io.metamask',name:'MetaMask',uuid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
    window.ethereum={providers:[ynx,meta]};window.addEventListener('eip6963:requestProvider',()=>{for(const provider of [ynx,meta])window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{provider,info:provider.providerInfo}}));});
  },{reject,deferYNX});await page.goto(base);await page.evaluate(()=>window.YNXFinanceWallet.ready);return page;
}
test('four choices are accessible, responsive and localized; opening and Escape issue zero authorizations',async()=>{
  const page=await pageFixture();try{
    for(const locale of ['en','zh-CN','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
      assert.equal(await page.evaluate(locale=>window.YNXFinanceLocale.set(locale),locale),true);await page.locator('#wallet-entry').click();
      assert.equal(await page.locator('#wallet-picker-choices button').count(),4);
      assert.equal(await page.locator('#wallet-picker-qr').isVisible(),false);
      assert.equal(await page.locator('#wallet-picker-step').isVisible(),false);
      assert.equal(await page.locator('#connect-ynx').isVisible(),false);assert.equal(await page.locator('#connect-hosted-ynx').isVisible(),false);
      assert.equal(await page.evaluate(()=>document.querySelector('#wallet-picker').scrollWidth<=document.querySelector('#wallet-picker').clientWidth),true);
      assert.equal(await page.locator('#picker-mobile').getAttribute('aria-label'),null);
      assert.ok((await page.locator('#picker-mobile').innerText()).trim());
      await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-entry');
    }
    assert.deepEqual(await page.evaluate(()=>window.__pickerQA.counts),{connect:0,sign:0,init:0,pair:0,disconnect:0,cancel:0});
  }finally{await page.close();}
});
test('selected MetaMask has one step; rejection recovers without fallback, connect-only never signs',async()=>{
  const page=await pageFixture({reject:true});try{
    await page.locator('#wallet-entry').click();await page.locator('#picker-metamask').click();
    await page.waitForFunction(()=>document.querySelector('#wallet-picker-state').textContent===window.YNXFinanceLocale.text('pickerRejected'));
    assert.equal(await page.locator('#wallet-picker-choices').isVisible(),false);assert.equal(await page.locator('#wallet-picker-selected').innerText(),'MetaMask');
    assert.equal(await page.locator('#wallet-picker-details').getAttribute('open'),null);assert.equal(await page.locator('#wallet-picker-qr').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.__pickerQA.counts.sign),0);assert.equal(await page.evaluate(()=>window.__pickerQA.counts.pair),0);
    await page.locator('#wallet-picker-back').click();assert.equal(await page.locator('#wallet-picker-choices').isVisible(),true);
  }finally{await page.close();}
  const success=await pageFixture();try{
    await success.locator('#wallet-entry').click();await success.locator('#picker-metamask').click();await success.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='connected');
    assert.equal(await success.evaluate(()=>window.__pickerQA.counts.sign),0);assert.equal(await success.locator('#wallet-picker').isVisible(),true);
    await success.locator('#wallet-picker-action').click();assert.equal(await success.locator('#wallet-picker').isVisible(),false);
  }finally{await success.close();}
});
test('all twelve locales update active rejection and guest identity copy without duplicate boundaries',async()=>{
  const page=await pageFixture({reject:true});try{
    await page.locator('#wallet-entry').click();await page.locator('#picker-metamask').click();await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='disconnected'&&!document.querySelector('#wallet-picker-action').hidden);
    await page.evaluate(()=>document.querySelector('#browser-signin-state').textContent=window.YNXFinanceLocale.text('browserSignInBoundary'));
    for(const locale of ['en','zh-CN','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.evaluate(locale=>window.YNXFinanceLocale.set(locale),locale);
      assert.equal(await page.locator('#wallet-picker-state').innerText(),await page.evaluate(()=>window.YNXFinanceLocale.text('pickerRejected')));
      assert.equal(await page.locator('#browser-signin-state').textContent(),await page.evaluate(()=>window.YNXFinanceLocale.text('browserSignInBoundary')));
      assert.equal(await page.locator('#browser-signin [data-finance-i18n="browserSignInBoundary"]').count(),0);
      assert.equal((await page.locator('#wallet-picker-step').innerText()).includes('untrusted secret-like detail'),false);
    }
    await page.evaluate(()=>window.YNXFinanceLocale.set('en'));assert.equal((await page.locator('#browser-signin-state').textContent()).includes('浏览器'),false);
  }finally{await page.close();}
});
test('real Pair adapter facade renders temporary QR, coalesces pending and requires actual approval before native requests',async()=>{
  const page=await pageFixture();try{
    await page.locator('#wallet-entry').click();await page.locator('#picker-mobile').click();await page.waitForFunction(()=>typeof window.__pickerQA.approve==='function');
    await page.waitForFunction(()=>!document.querySelector('#wallet-picker-qr').hidden);
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connecting');
    assert.equal(await page.evaluate(()=>{const a=window.YNXFinanceWallet.connectPair(),b=window.YNXFinanceWallet.connectPair();return a===b;}),true);
    assert.equal(await page.evaluate(()=>window.__pickerQA.counts.pair),1);
    await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('ynx-finance-pair-state',{detail:{status:'opening',stage:'relay'}}));window.dispatchEvent(new CustomEvent('ynx-finance-private-state',{detail:{status:'checking'}}));});assert.equal(await page.locator('#wallet-picker-qr').isVisible(),true);assert.equal(await page.locator('#wallet-picker-deeplink').isVisible(),true);assert.equal(await page.locator('#wallet-picker-state').innerText(),await page.evaluate(()=>YNXFinanceLocale.text('pickerScan')));
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>/wc:|symKey/.test(localStorage.getItem(key)))),false);
    await page.evaluate(()=>window.__pickerQA.approve());await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='connected');
    assert.equal(await page.locator('#wallet-picker-qr').isVisible(),false);assert.equal(await page.evaluate(()=>window.__pickerQA.counts.sign),0);
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.privateProviderAvailable()),true);
    const result=await page.evaluate(()=>window.YNXFinanceWallet.requestProductSessionV2('https://wallet.ynxweb4.com/isolated-sdk-route'));
    assert.equal(result.version,2);assert.equal(await page.evaluate(()=>window.__pickerQA.requestMethod),'ynx_requestProductSessionV2');assert.equal(await page.evaluate(()=>window.__pickerQA.transportExpiry),300);
    await page.evaluate(()=>window.__pickerQA.events.get('session_delete')({topic:'a'.repeat(64)}));
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.privateProviderAvailable()),false);
  }finally{await page.close();}
});
test('URI-less relay failure is recoverable network UI; cancelled handshake cannot override another wallet',async()=>{
  for(const mode of ['failure','cancel']){
    const page=await pageFixture();try{
      await page.evaluate(mode=>{window.__pickerQA.relayFailure=mode==='failure';window.__pickerQA.deferRelay=mode==='cancel';},mode);
      await page.locator('#wallet-entry').click();await page.locator('#picker-mobile').click();
      if(mode==='failure'){
        await page.waitForFunction(()=>YNXFinanceWallet.getPairState().errorCode==='YNX_PAIR_RELAY_UNAVAILABLE');
        assert.equal(await page.locator('#wallet-picker-state').innerText(),await page.evaluate(()=>YNXFinanceLocale.text('pairTransportUnavailable')));
        assert.equal((await page.locator('#wallet-picker-step').innerText()).includes('secret-untrusted'),false);
      }else {await page.waitForFunction(()=>typeof __pickerQA.finishRelay==='function');assert.equal(await page.locator('#wallet-picker-state').innerText(),await page.evaluate(()=>YNXFinanceLocale.text('pairTransportWaiting')));await page.evaluate(()=>window.dispatchEvent(new CustomEvent('ynx-finance-private-state',{detail:{status:'checking'}})));assert.equal(await page.locator('#wallet-picker-state').innerText(),await page.evaluate(()=>YNXFinanceLocale.text('pairTransportWaiting')));}
      assert.equal(await page.locator('#wallet-picker-qr').isVisible(),false);assert.equal(await page.evaluate(()=>__pickerQA.counts.sign),0);
      await page.locator('#wallet-picker-back').click();await page.locator('#picker-metamask').click();
      await page.waitForFunction(()=>YNXFinanceWallet.getStandardWalletState().providerKind==='metamask'&&YNXFinanceWallet.getStandardWalletState().status==='connected');
      if(mode==='cancel')await page.evaluate(()=>__pickerQA.finishRelay());
      assert.equal(await page.evaluate(()=>__pickerQA.counts.init),1);assert.equal(await page.evaluate(()=>__pickerQA.counts.pair),1);
      assert.equal(await page.evaluate(()=>YNXFinanceWallet.getStandardWalletState().providerKind),'metamask');assert.equal(await page.locator('#wallet-picker-qr').isVisible(),false);
    }finally{await page.close();}
  }
});
test('official Pair rejection codes recover without exposing transport details or signing',async()=>{
  for(const code of [5000,5001,5002,5003,'USER_REJECTED']){
    const page=await pageFixture();try{
      await page.locator('#wallet-entry').click();await page.locator('#picker-mobile').click();await page.waitForFunction(()=>typeof window.__pickerQA.reject==='function');
      await page.evaluate(code=>{window.__pickerQA.rejectionCode=code;window.__pickerQA.reject();},code);
      await page.waitForFunction(()=>window.YNXFinanceWallet.getPairState().errorCode==='USER_REJECTED');
      assert.equal(await page.locator('#wallet-picker-state').innerText(),await page.evaluate(()=>window.YNXFinanceLocale.text('pickerRejected')));
      assert.equal((await page.locator('#wallet-picker-step').innerText()).includes('untrusted Pair detail'),false);
      assert.equal(await page.locator('#wallet-picker-qr').isVisible(),false);assert.equal(await page.locator('#wallet-picker-action').isVisible(),true);
      assert.equal(await page.evaluate(()=>window.__pickerQA.counts.sign),0);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');
    }finally{await page.close();}
  }
});
test('cancelled Pair rejects late approval and never reopens QR or adopts a session',async()=>{
  const page=await pageFixture();try{
    await page.locator('#wallet-entry').click();await page.locator('#picker-mobile').click();await page.waitForFunction(()=>typeof window.__pickerQA.approve==='function');
    await page.locator('#wallet-picker-close').click();await page.evaluate(()=>window.__pickerQA.approve());
    await page.waitForFunction(()=>window.__pickerQA.counts.disconnect===1);
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');assert.equal(await page.locator('#wallet-picker').isVisible(),false);assert.equal(await page.evaluate(()=>document.querySelector('#wallet-picker-qr').getAttribute('src')===null),true);
  }finally{await page.close();}
});
test('Pair back selects MetaMask immediately and retires late mobile approval without overriding it',async()=>{
  const page=await pageFixture();try{
    await page.locator('#wallet-entry').click();await page.locator('#picker-mobile').click();await page.waitForFunction(()=>typeof window.__pickerQA.approve==='function');
    await page.locator('#wallet-picker-back').click();await page.locator('#picker-metamask').click();
    await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().providerKind==='metamask'&&window.YNXFinanceWallet.getStandardWalletState().status==='connected');
    await page.evaluate(()=>window.__pickerQA.approve());await page.waitForFunction(()=>window.__pickerQA.counts.disconnect===1);
    assert.equal(await page.locator('#wallet-picker-selected').innerText(),'MetaMask');assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().providerKind),'metamask');assert.equal(await page.evaluate(()=>document.querySelector('#wallet-picker-qr').getAttribute('src')===null),true);
  }finally{await page.close();}
});
test('stale cleanup failure preserves a newer QR; current unconfirmed cancellation remains explicit',async()=>{
  const page=await pageFixture();try{
    await page.locator('#wallet-entry').click();await page.locator('#picker-mobile').click();await page.waitForFunction(()=>typeof window.__pickerQA.approve==='function');
    await page.evaluate(()=>window.__pickerQA.approveOld=window.__pickerQA.approve);
    await page.locator('#wallet-picker-back').click();await page.locator('#picker-mobile').click();await page.waitForFunction(()=>window.__pickerQA.counts.pair===2&&!document.querySelector('#wallet-picker-qr').hidden);
    await page.evaluate(()=>{window.__pickerQA.failDisconnect=true;window.__pickerQA.approveOld();});await page.waitForFunction(()=>window.__pickerQA.counts.disconnect===1);
    assert.equal(await page.locator('#wallet-picker-qr').isVisible(),true);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getPairState().status),'pairing');
    await page.evaluate(async()=>{window.__pickerQA.failCancel=true;await window.YNXFinanceWallet.cancelPair();});
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getPairState().status),'cancel-unconfirmed');assert.equal(await page.locator('#wallet-picker-state').innerText(),await page.evaluate(()=>window.YNXFinanceLocale.text('pickerCancelUnknown')));assert.equal(await page.locator('#wallet-picker-qr').isVisible(),false);
  }finally{await page.close();}
});
test('pending extension back and cancel release only their operation; late approval cannot replace a newer choice',async()=>{
  for(const action of ['back','cancel']){
    const page=await pageFixture({deferYNX:true});try{
      await page.locator('#wallet-entry').click();await page.locator('#picker-ynx').click();await page.waitForFunction(()=>typeof window.__pickerQA.finishYNX==='function');
      if(action==='back')await page.locator('#wallet-picker-back').click();else{await page.locator('#wallet-picker-close').click();await page.locator('#wallet-entry').click();}
      await page.locator('#picker-metamask').click();await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().providerKind==='metamask'&&window.YNXFinanceWallet.getStandardWalletState().status==='connected');
      await page.evaluate(()=>window.__pickerQA.finishYNX());
      assert.equal(await page.locator('#wallet-picker-selected').innerText(),'MetaMask');assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().providerKind),'metamask');assert.equal(await page.evaluate(()=>window.__pickerQA.counts.sign),0);
    }finally{await page.close();}
  }
});

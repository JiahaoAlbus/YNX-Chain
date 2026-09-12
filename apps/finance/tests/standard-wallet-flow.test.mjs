import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

// Real local Chrome executes the exact Finance bundle. Providers/accounts below
// are injected test fixtures, not installed-wallet or public authorization proof.
const web=new URL('../web/',import.meta.url),key='ynx.finance.standard-wallet.provider.v2';
let server,browser,base;
test.before(async()=>{
  server=createServer(async(req,res)=>{
    if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,chainId:'ynx_6423-1',portfolio:'read-only'}));}
    const file=req.url==='/'?'index.html':req.url.slice(1);
    if(!/^[a-z0-9.-]+$/.test(file)){res.writeHead(404);return res.end();}
    try{const bytes=await readFile(new URL(file,web));res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(bytes);}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
async function fixture({saved=null,missing=false,revoke='success',deferSwitch=false,deferRevoke=false}={}){
  const page=await browser.newPage();
  page.financeErrors=[];page.on('pageerror',error=>page.financeErrors.push(error.message));
  await page.addInitScript(({saved,missing,revoke,deferSwitch,deferRevoke,key})=>{
    if(saved)localStorage.setItem(key,saved);
    const f={calls:[],revoke,deferSwitch,deferRevoke,pendingSwitch:null,pendingRevoke:null};
    function provider(kind,account){const listeners=new Map();return {isYNXWallet:kind==='ynx-wallet',isMetaMask:kind==='metamask',account,chain:'0x1917',on(e,fn){if(!listeners.has(e))listeners.set(e,new Set());listeners.get(e).add(fn);},removeListener(e,fn){listeners.get(e)?.delete(fn);},emit(e,v){if(e==='accountsChanged')this.account=v[0];if(e==='chainChanged')this.chain=v;for(const fn of listeners.get(e)||[])fn(v);},async request({method,params}){f.calls.push({kind,method,params});if(method==='wallet_switchEthereumChain'){if(f.deferSwitch)return new Promise(resolve=>{f.pendingSwitch=()=>{this.chain='0x1917';resolve(null);};});this.chain='0x1917';return null;}if(method==='wallet_addEthereumChain')return null;if(method==='eth_chainId')return this.chain;if(method==='eth_accounts'||method==='eth_requestAccounts')return this.account?[this.account]:[];if(method==='wallet_revokePermissions'){if(f.revoke==='unsupported')throw Object.assign(new Error('fixture unsupported'),{code:4200});if(f.revoke==='reject')throw Object.assign(new Error('fixture rejected'),{code:4001});const done=()=>{if(f.revoke!=='nonempty')this.account=null;return null;};if(f.deferRevoke)return new Promise(resolve=>{f.pendingRevoke=()=>resolve(done());});return done();}throw new Error('Forbidden fixture method: '+method);}};}
    f.metamask=provider('metamask','0x'+'a'.repeat(40));f.ynx=provider('ynx-wallet','0x'+'b'.repeat(40));
    f.ynx.providerInfo={rdns:'com.ynx.wallet',name:'YNX Wallet',uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
    f.metamask.providerInfo={rdns:'io.metamask',name:'MetaMask',uuid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
    window.addEventListener('eip6963:requestProvider',()=>{for(const p of missing?[f.ynx]:[f.ynx,f.metamask])window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:p.providerInfo,provider:p}}));});window.__financeFixture=f;
    window.ethereum={providers:missing?[f.ynx]:[f.ynx,f.metamask]};
  },{saved,missing,revoke,deferSwitch,deferRevoke,key});
  await page.goto(base);await page.evaluate(()=>window.YNXFinanceWallet.ready);return page;
}
async function connect(page,id='#connect-metamask'){await page.locator(id).click();try{await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='connected',{},{timeout:3000});}catch(error){throw new Error(JSON.stringify({errors:page.financeErrors,state:await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState()),calls:await calls(page)}),{cause:error});}}
const calls=page=>page.evaluate(()=>window.__financeFixture.calls);

test('SDK artifact is exact, and Finance source no longer creates or transports a legacy device secret',async()=>{
  const sdk=await readFile(new URL('vendor/standard-wallet-browser-c97f85e9.mjs',web));
  assert.equal(sdk.length,22417);assert.equal(createHash('sha256').update(sdk).digest('hex'),'b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43');
  const source=await readFile(new URL('wallet-auth-entry.js',web),'utf8');
  for(const banned of ['productDeviceSecret','createProductDeviceIdentity','location.href=','window.open(','iframe','indexedDB.open('])assert.equal(source.includes(banned),false,banned);
});
test('guest starts without account requests, missing selected wallet never falls back or navigates',async()=>{
  const page=await fixture({missing:true});try{assert.deepEqual(await calls(page),[]);await page.locator('#connect-metamask').click();await page.waitForTimeout(300);assert.deepEqual(await calls(page),[]);assert.equal(page.url(),base+'/');assert.equal(page.context().pages().length,1);assert.equal(await page.locator('#install-wallet').getAttribute('href'),'https://www.ynxweb4.com/dapp/download');assert.equal(await page.locator('#install-metamask').getAttribute('href'),'https://metamask.io/download/');assert.equal(await page.locator('#signed-out').isVisible(),true);}finally{await page.close();}
});
test('MetaMask is selected distinctly, chooser closes, private failure does not disconnect, refresh silently restores',async()=>{
  const page=await fixture();try{await connect(page);assert.equal(await page.locator('#wallet-choice').isVisible(),false);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().providerKind),'metamask');assert.equal((await calls(page)).some(call=>call.kind==='ynx-wallet'),false);await page.evaluate(()=>window.YNXFinanceWallet.reportPrivateFailure());assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');await page.reload();await page.evaluate(()=>window.YNXFinanceWallet.ready);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');assert.deepEqual((await calls(page)).map(call=>call.method),['eth_accounts','eth_chainId']);}finally{await page.close();}
});
test('local disconnect sends no revocation; late events cannot repopulate account',async()=>{
  const page=await fixture();try{await connect(page);await page.locator('#wallet-disconnect').click();await page.evaluate(()=>window.__financeFixture.metamask.emit('accountsChanged',['0x'+'c'.repeat(40)]));assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');assert.equal((await calls(page)).some(call=>call.method==='wallet_revokePermissions'),false);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);await page.reload();await page.evaluate(()=>window.YNXFinanceWallet.ready);assert.deepEqual(await calls(page),[]);}finally{await page.close();}
});
test('cancellation fences delayed chain switching before any account request',async()=>{
  const page=await fixture({deferSwitch:true});try{await page.locator('#connect-metamask').click();await page.waitForFunction(()=>window.__financeFixture.pendingSwitch);await page.locator('#wallet-disconnect').click();await page.evaluate(()=>window.__financeFixture.pendingSwitch());await page.waitForTimeout(50);assert.deepEqual((await calls(page)).map(call=>call.method),['wallet_switchEthereumChain']);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');}finally{await page.close();}
});
for(const [mode,status,confirmed] of [['success','revoked',true],['unsupported','unsupported',false],['reject','rejected',false],['nonempty','failed',false]])test('revoke '+mode+' uses SDK acknowledgement/readback contract',async()=>{
  const page=await fixture({revoke:mode});try{await connect(page);const result=await page.evaluate(()=>window.YNXFinanceWallet.revokeStandardWallet());assert.equal(result.status,status);assert.equal(result.permissionRevoked,confirmed);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),confirmed?'disconnected':'connected');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),confirmed?null:'metamask');}finally{await page.close();}
});
test('old revocation result cannot clear a newer YNX connection',async()=>{
  const page=await fixture({deferRevoke:true});try{await connect(page);await page.evaluate(()=>{window.__financeFixture.promise=window.YNXFinanceWallet.revokeStandardWallet();});await page.waitForFunction(()=>window.__financeFixture.pendingRevoke);await page.locator('#wallet-switch').click();await connect(page,'#connect-ynx');await page.evaluate(()=>window.__financeFixture.pendingRevoke());const result=await page.evaluate(()=>window.__financeFixture.promise);assert.equal(result.permissionRevoked,false);assert.equal(result.status,'superseded');assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().providerKind),'ynx-wallet');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),'ynx-wallet');}finally{await page.close();}
});
test('4902 follows add, re-switch and exact chain readback before requesting accounts',async()=>{
  const page=await fixture();try{await page.evaluate(()=>{const p=window.__financeFixture.metamask,request=p.request.bind(p);let first=true;p.request=async args=>{if(args.method==='wallet_switchEthereumChain'&&first){first=false;window.__financeFixture.calls.push({kind:'metamask',method:args.method});throw Object.assign(new Error('fixture unknown chain'),{code:4902});}return request(args);};});await connect(page);assert.deepEqual((await calls(page)).map(c=>c.method),['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain','eth_chainId','eth_requestAccounts','eth_chainId']);assert.equal((await calls(page))[1].params[0].chainId,'0x1917');assert.deepEqual(page.financeErrors,[]);}finally{await page.close();}
});
test('account and chain events update identity; disconnect clears remembered provider',async()=>{
  const page=await fixture();try{await connect(page);await page.evaluate(()=>window.__financeFixture.metamask.emit('accountsChanged',['0x'+'c'.repeat(40)]));assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().account),'0x'+'c'.repeat(40));await page.evaluate(()=>window.__financeFixture.metamask.emit('chainChanged','0x1'));assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'wrong-chain');await page.evaluate(()=>window.__financeFixture.metamask.emit('chainChanged','0x1917'));assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');await page.evaluate(()=>window.__financeFixture.metamask.emit('disconnect',{code:4900}));assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);}finally{await page.close();}
});
test('Finance API discards late account-bound response after Standard identity changes',async()=>{
  const page=await fixture();try{await connect(page);await page.evaluate(()=>{const actual=window.YNXFinanceWallet;window.YNXFinanceWallet={...actual,requireProof:async()=>({proofHeader:'LOCAL-TEST-ONLY',requestId:'local-test-request'})};const original=window.fetch;window.fetch=(url,options)=>url==='/api/overview'?new Promise(resolve=>{window.__financeFixture.apiResolve=()=>resolve(new Response(JSON.stringify({account:'old-account-fixture'}),{status:200,headers:{'content-type':'application/json'}}));}):original(url,options);window.__financeFixture.apiResult=api('/api/overview').then(()=>({accepted:true}),error=>({accepted:false,error:error.message}));});await page.waitForFunction(()=>window.__financeFixture.apiResolve);await page.evaluate(()=>{window.__financeFixture.metamask.emit('accountsChanged',['0x'+'c'.repeat(40)]);window.__financeFixture.apiResolve();});const result=await page.evaluate(()=>window.__financeFixture.apiResult);assert.equal(result.accepted,false);assert.match(result.error,/FINANCE_CONTEXT_CHANGED/);}finally{await page.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

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
  browser=await chromium.launch(await financeBrowserLaunchOptions());
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});
async function fixture({saved=null,missing=false,revoke='success',deferSwitch=false,deferRevoke=false,rejectSign=false,deferSign=false}={}){
  const page=await browser.newPage();
  page.financeErrors=[];page.on('pageerror',error=>page.financeErrors.push(error.message));
  await page.addInitScript(({saved,missing,revoke,deferSwitch,deferRevoke,rejectSign,deferSign,key})=>{
    if(saved)localStorage.setItem(key,saved);
    const f={calls:[],revoke,deferSwitch,deferRevoke,rejectSign,deferSign,pendingSwitch:null,pendingRevoke:null,pendingSign:null};
    function provider(kind,account){const listeners=new Map();return {isYNXWallet:kind==='ynx-wallet',isMetaMask:kind==='metamask',account,chain:'0x1917',on(e,fn){if(!listeners.has(e))listeners.set(e,new Set());listeners.get(e).add(fn);},removeListener(e,fn){listeners.get(e)?.delete(fn);},emit(e,v){if(e==='accountsChanged')this.account=v[0];if(e==='chainChanged')this.chain=v;for(const fn of listeners.get(e)||[])fn(v);},async request({method,params}){f.calls.push({kind,method,params});if(method==='wallet_switchEthereumChain'){if(f.deferSwitch)return new Promise(resolve=>{f.pendingSwitch=()=>{this.chain='0x1917';resolve(null);};});this.chain='0x1917';return null;}if(method==='wallet_addEthereumChain')return null;if(method==='eth_chainId')return this.chain;if(method==='eth_accounts'||method==='eth_requestAccounts')return this.account?[this.account]:[];if(method==='personal_sign'){if(f.rejectSign)throw Object.assign(new Error('fixture user rejected'),{code:4001});if(f.deferSign)return new Promise(resolve=>{f.pendingSign=()=>resolve('0x'+'1'.repeat(130));});return '0x'+'1'.repeat(130);}if(method==='wallet_revokePermissions'){if(f.revoke==='unsupported')throw Object.assign(new Error('fixture unsupported'),{code:4200});if(f.revoke==='reject')throw Object.assign(new Error('fixture rejected'),{code:4001});const done=()=>{if(f.revoke!=='nonempty')this.account=null;return null;};if(f.deferRevoke)return new Promise(resolve=>{f.pendingRevoke=()=>resolve(done());});return done();}throw new Error('Forbidden fixture method: '+method);}};}
    f.metamask=provider('metamask','0x'+'a'.repeat(40));f.ynx=provider('ynx-wallet','0x'+'b'.repeat(40));
    f.ynx.providerInfo={rdns:'com.ynx.wallet',name:'YNX Wallet',uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
    f.metamask.providerInfo={rdns:'io.metamask',name:'MetaMask',uuid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
    window.addEventListener('eip6963:requestProvider',()=>{for(const p of missing?[f.ynx]:[f.ynx,f.metamask])window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:p.providerInfo,provider:p}}));});window.__financeFixture=f;
    window.ethereum={providers:missing?[f.ynx]:[f.ynx,f.metamask]};
  },{saved,missing,revoke,deferSwitch,deferRevoke,rejectSign,deferSign,key});
  await page.goto(base);await page.evaluate(()=>window.YNXFinanceWallet.ready);return page;
}
async function connect(page,id='#connect-metamask'){await page.locator(id).click();try{await page.waitForFunction(()=>window.YNXFinanceWallet.getStandardWalletState().status==='connected',{},{timeout:3000});}catch(error){throw new Error(JSON.stringify({errors:page.financeErrors,state:await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState()),calls:await calls(page)}),{cause:error});}}
const calls=page=>page.evaluate(()=>window.__financeFixture.calls);

test('guest navigation keeps eight product destinations visible and localizes Wallet status without account access',async()=>{
  const page=await fixture();try{
    for(const width of [360,390,768,1440,1920]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`horizontal overflow at ${width}`);
      assert.equal(await page.locator('#nav a').count(),8);
      for(const link of await page.locator('#nav a').all())assert.equal(await link.isVisible(),true,`navigation hidden at ${width}`);
      assert.equal(await page.locator('.account-menu > summary').isVisible(),true);
      await page.locator('#nav a[href="#assets"]').click();
      await page.waitForFunction(()=>document.querySelector('#guest-gate').classList.contains('active-view'));
      assert.equal(await page.locator('#guest-gate').isVisible(),true);
      await page.locator('#nav a[href="#markets"]').click();
      await page.waitForFunction(()=>document.querySelector('#markets').classList.contains('active-view'));
      assert.equal(await page.locator('#markets').isVisible(),true);
      await page.locator('#nav a[href="#orders"]').click();
      await page.waitForFunction(()=>document.querySelector('#broker-sandbox').classList.contains('active-view'));
      assert.equal(await page.locator('#broker-sandbox').isVisible(),true);
    }
    await page.locator('#finance-language').selectOption('zh-CN');
    await page.locator('.account-menu > summary').click();
    assert.equal(await page.locator('.account-menu-panel a[href="#settings"]').innerText(),'设置');
    await page.locator('.account-menu > summary').click();
    assert.match(await page.locator('#wallet-state').innerText(),/标准钱包未连接/);
    await page.locator('#nav a[href="#strategies"]').click();
    await page.waitForFunction(()=>document.querySelector('#guest-gate-heading').textContent==='策略');
    assert.match(await page.locator('#guest-gate').innerText(),/策略/);
    assert.deepEqual(await calls(page),[]);
    assert.equal(page.context().pages().length,1);
    assert.deepEqual(page.financeErrors,[]);
  }finally{await page.close();}
});

for(const scenario of ['disabled','missing-credentials','configured','network-failure'])test('Broker Sandbox guest '+scenario+' is visible, never submits and leaves Wallet untouched',async()=>{
  const page=await fixture();try{
    await page.route('**/api/broker/status',route=>scenario==='network-failure'?route.abort():route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schema:'ynx-finance-broker-status-v1',status:{enabled:scenario!=='disabled',tradingEnvironment:'sandbox',chainEnvironment:'testnet',submissionEnabled:false,state:scenario==='configured'?'CONFIGURED_NOT_VERIFIED':scenario==='disabled'?'DISABLED':'NOT_CONFIGURED'}})}));
    await page.locator('#broker-nav').click();await page.locator('#broker-refresh').click();
    await page.waitForFunction(expected=>document.querySelector('#broker-status').textContent.includes(expected),scenario==='configured'?'not verified':scenario==='disabled'?'module disabled':scenario==='network-failure'?'check unavailable':'Not configured');
	assert.equal(await page.locator('#broker-sandbox').isVisible(),true);assert.equal(await page.locator('[data-broker-order-execute]').count(),0);
    assert.equal(await page.locator('#broker-cash').textContent(),'Unknown — not zero');assert.equal(await page.locator('#broker-cash').isVisible(),false);assert.equal(page.context().pages().length,1);assert.deepEqual(await calls(page),[]);assert.deepEqual(page.financeErrors,[]);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
	await page.reload();await page.waitForFunction(()=>document.querySelector('#broker-sandbox').classList.contains('active-view'));assert.equal(await page.locator('[data-broker-order-execute]').count(),0);assert.deepEqual(await calls(page),[]);
  }finally{await page.close();}
});

test('local Chrome planning view shows fixture observations, not false complete budget totals',async()=>{
  const page=await fixture();try{
    await page.evaluate(()=>{
      location.hash='#planning';
      // This exercises rendering only; no private authorization is inferred.
      state.connected=true;
      state.overview={portfolio:{account:'LOCAL_RENDER_FIXTURE_NOT_AUTHORIZATION',activity:[],payReceipts:[],explorerStatus:{available:false,error:'Local fixture'},payStatus:{available:false,error:'Local fixture'}},profile:{categories:[],budgets:[{id:'budget-fixture',name:'Local rendering fixture',period:'weekly',limitYnxt:100}],reminders:[],privacy:{}},budgetProgress:[{budgetId:'budget-fixture',spentYnxt:null,remainingYnxt:null,observedSpentYnxt:12,coverageComplete:false,calculationStatus:'partial',periodTimezone:'UTC',periodStart:'2026-09-07T00:00:00Z',effectiveFrom:'2026-09-07T00:00:00Z',coverage:'Latest 100 global records only'}],alerts:[],support:{}};
      render(state.overview);
    });
    assert.equal(await page.locator('#planning').isVisible(),true);
    const text=await page.locator('#budgets').innerText();
    assert.match(text,/Observed spending: 12 YNXT/);assert.match(text,/Full-period spending: Unknown/);assert.match(text,/Remaining budget: Unknown/);
    assert.match(text,/2026-09-07T00:00:00Z/);assert.doesNotMatch(text,/88 YNXT|12%/);
    assert.match(text,/Latest 100 global records only/);
    await page.evaluate(()=>window.YNXFinanceLocale.set('zh-CN'));
    assert.match(await page.locator('#budgets').innerText(),/Latest 100 global records only/);
    assert.deepEqual(await calls(page),[]);assert.deepEqual(page.financeErrors,[]);
  }finally{await page.close();}
});

test('local Chrome statement separates observed records from unknown period totals',async()=>{
  const page=await fixture();try{
    await page.evaluate(()=>{
      renderStatement({schemaVersion:'finance-statement-v2',network:'ynx_6423-1',symbol:'YNXT',from:'2026-09-01T00:00:00Z',toExclusive:'2026-10-01T00:00:00Z',activity:[{id:'fixture'}],totals:{incomingYnxt:null,outgoingYnxt:null,feesYnxt:null},observedTotals:{incomingYnxt:0,outgoingYnxt:12,feesYnxt:1},coverageComplete:false,coverage:'Latest 100 global indexed transactions; complete period history is not proven',calculationStatus:'partial',openingBalance:'unavailable'});
    });
    const text=await page.locator('#statement').innerText();
    assert.match(text,/Full-period totals: Unknown/);
    assert.match(text,/Observed outgoing\s*12 YNXT/);
    assert.match(text,/Observed incoming\s*0 YNXT/);
    assert.match(text,/Returned records\s*1/);
    assert.doesNotMatch(text,/Outgoing\s+12 YNXT|Full-period totals: 0/);
    await assert.rejects(page.evaluate(()=>renderStatement({schemaVersion:'finance-statement-v2',activity:[],totals:{incomingYnxt:0,outgoingYnxt:12,feesYnxt:1},coverageComplete:false})),/Statement coverage response is invalid/);
    assert.deepEqual(await calls(page),[]);
  }finally{await page.close()}
});

test('local Chrome refuses imprecise or missing chain-unit amounts',async()=>{
  const page=await fixture();try{
    const values=await page.evaluate(()=>[fmt(0),fmt(null),fmt(undefined),fmt(Number.MAX_SAFE_INTEGER+1),fmt(-1),fmt(1.5)]);
    assert.deepEqual(values,['0','Unknown','Unknown','Unknown','Unknown','Unknown']);
    await page.evaluate(()=>renderActivity([{id:'fixture-tx',type:'fixture',direction:'outgoing',timestamp:'2026-09-01T00:00:00Z',amountYnxt:Number.MAX_SAFE_INTEGER+1,feeYnxt:null}]));
    assert.match(await page.locator('#activity-body').innerText(),/Unknown YNXT/);
    assert.doesNotMatch(await page.locator('#activity-body').innerText(),/9,007,199,254,740,992/);
    assert.deepEqual(await calls(page),[]);
    assert.deepEqual(page.financeErrors,[]);
  }finally{await page.close()}
});

test('SDK artifact is exact, and Finance source no longer creates or transports a legacy device secret',async()=>{
  const sdk=await readFile(new URL('vendor/standard-wallet-browser-c97f85e9.mjs',web));
  assert.equal(sdk.length,22417);assert.equal(createHash('sha256').update(sdk).digest('hex'),'b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43');
  const source=await readFile(new URL('wallet-auth-entry.js',web),'utf8');
  for(const banned of ['productDeviceSecret','createProductDeviceIdentity','location.href=','window.open(','iframe','indexedDB.open('])assert.equal(source.includes(banned),false,banned);
});
test('guest starts without account requests, missing selected wallet never falls back or navigates',async()=>{
  const page=await fixture({missing:true});try{assert.deepEqual(await calls(page),[]);await page.locator('#connect-metamask').click();await page.waitForTimeout(300);assert.deepEqual(await calls(page),[]);assert.equal(page.url(),base+'/');assert.equal(page.context().pages().length,1);assert.equal(await page.locator('#install-wallet').getAttribute('href'),'https://www.ynxweb4.com/dapp/download');assert.equal(await page.locator('#install-metamask').getAttribute('href'),'https://metamask.io/download/');assert.equal(await page.locator('#signed-out').isVisible(),true);}finally{await page.close();}
});
test('pending shared authority blocks private Finance before any Wallet Gateway request',async()=>{
  const page=await fixture(),gatewayRequests=[];page.on('request',request=>{if(new URL(request.url()).origin==='https://wallet-auth.ynxweb4.com')gatewayRequests.push(request.url());});
  try{await page.locator('#wallet-more').locator('summary').click();await page.locator('#private-begin').click();await page.waitForFunction(()=>document.querySelector('#private-state').title==='PRIVATE_SERVICE_DEGRADED');assert.deepEqual(gatewayRequests,[]);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getPrivateState().status),'degraded');assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');}finally{await page.close();}
});
test('MetaMask is selected distinctly, chooser closes, private failure does not disconnect, refresh silently restores',async()=>{
  const page=await fixture();try{await connect(page);assert.equal(await page.locator('#wallet-choice').isVisible(),false);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().providerKind),'metamask');assert.equal((await calls(page)).some(call=>call.kind==='ynx-wallet'),false);await page.evaluate(()=>window.YNXFinanceWallet.reportPrivateFailure());assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');await page.reload();await page.evaluate(()=>window.YNXFinanceWallet.ready);assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');assert.deepEqual((await calls(page)).map(call=>call.method),['eth_accounts','eth_chainId']);}finally{await page.close();}
});
test('local Chrome requires an explicit identity click and preserves Standard Wallet on unavailable authority',async()=>{
  const page=await fixture();try{
    await connect(page);
    assert.equal(await page.locator('#wallet-login-verify').isVisible(),true);
    assert.equal((await calls(page)).some(call=>call.method==='personal_sign'),false);
    await page.locator('#wallet-login-verify').click();
    await page.waitForFunction(()=>document.querySelector('#wallet-login-state').textContent.includes('not verified')&&sessionStorage.getItem('ynx.finance.evm-login.pending.v1')===null);
    assert.equal((await calls(page)).some(call=>call.method==='personal_sign'),false);
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');
    assert.equal(page.context().pages().length,1);
  }finally{await page.close();}
});
test('local Chrome rejects a message/hex mismatch before selected provider signing',async()=>{
  const page=await fixture();try{
    await connect(page);
    const result=await page.evaluate(()=>window.YNXFinanceWallet.signEVMLoginRequest({method:'personal_sign',message:'Safe text',params:['0x6576696c','0x'+'a'.repeat(40)]}).then(()=>null,error=>error.message));
    assert.equal(result,'WALLET_LOGIN_MESSAGE_MISMATCH');
    assert.equal((await calls(page)).some(call=>call.method==='personal_sign'),false);
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');
  }finally{await page.close();}
});
test('local Chrome binds selected provider proof and never promotes mocked identity to private Finance',async()=>{
  const page=await fixture();try{
    await connect(page);
    const account='0x'+'a'.repeat(40),requestId='finance-login-'+'c'.repeat(32);
    await page.route('**/api/wallet-login/challenges',route=>route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({schemaVersion:'finance-evm-login-challenge-v1',privateFinanceAuthorized:false,challenge:{account,providerKind:'metamask',chainId:6423,productId:'finance',scopes:['finance.account.read'],requestId,expirationTime:'2030-01-01T00:00:00.000Z'},signingRequest:{method:'personal_sign',message:'LOCAL',params:['0x4c4f43414c',account]}})}));
    let postedProof=null;
    await page.route('**/api/wallet-login/verify',async route=>{postedProof=route.request().postDataJSON()?.proof;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schemaVersion:'finance-evm-login-verification-v1',verified:true,account,providerKind:'metamask',chainId:6423,scopes:['finance.account.read'],requestId,privateFinanceAuthorized:false,standardWalletUnchanged:true})});});
    await page.locator('#wallet-login-verify').click();
    await page.waitForFunction(()=>document.querySelector('#wallet-login-state').textContent.includes('Wallet identity verified'));
    assert.equal(postedProof?.challenge?.requestId,requestId);
    assert.equal(postedProof?.message,'LOCAL');
    assert.equal((await calls(page)).filter(call=>call.method==='personal_sign').length,1);
    assert.equal((await calls(page)).some(call=>call.kind==='ynx-wallet'),false);
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.connected()),false);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('ynx.finance.evm-login.pending.v1')),null);
    assert.equal(page.context().pages().length,1);
  }finally{await page.close();}
});
test('local Chrome reject of personal_sign leaves selected Standard Wallet connected and clears pending identity',async()=>{
  const page=await fixture({rejectSign:true});try{
    await connect(page);
    const account='0x'+'a'.repeat(40);
    await page.route('**/api/wallet-login/challenges',route=>route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({schemaVersion:'finance-evm-login-challenge-v1',privateFinanceAuthorized:false,challenge:{account,providerKind:'metamask',chainId:6423,productId:'finance',scopes:['finance.account.read'],requestId:'finance-login-'+'d'.repeat(32),expirationTime:'2030-01-01T00:00:00.000Z'},signingRequest:{method:'personal_sign',message:'LOCAL',params:['0x4c4f43414c',account]}})}));
    await page.locator('#wallet-login-verify').click();
    await page.waitForFunction(()=>document.querySelector('#wallet-login-state').textContent.includes('not verified'));
    assert.equal((await calls(page)).filter(call=>call.method==='personal_sign').length,1);
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('ynx.finance.evm-login.pending.v1')),null);
    assert.equal(page.context().pages().length,1);
  }finally{await page.close();}
});
test('local Chrome account change during a pending signature cannot submit stale Finance proof',async()=>{
  const page=await fixture({deferSign:true});try{
    await connect(page);
    const account='0x'+'a'.repeat(40);
    await page.route('**/api/wallet-login/challenges',route=>route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({schemaVersion:'finance-evm-login-challenge-v1',privateFinanceAuthorized:false,challenge:{account,providerKind:'metamask',chainId:6423,productId:'finance',scopes:['finance.account.read'],requestId:'finance-login-'+'e'.repeat(32),expirationTime:'2030-01-01T00:00:00.000Z'},signingRequest:{method:'personal_sign',message:'LOCAL',params:['0x4c4f43414c',account]}})}));
    let verifyCount=0;
    await page.route('**/api/wallet-login/verify',route=>{verifyCount++;return route.abort();});
    await page.locator('#wallet-login-verify').click();
    await page.waitForFunction(()=>typeof window.__financeFixture.pendingSign==='function');
    await page.evaluate(()=>{window.__financeFixture.metamask.emit('accountsChanged',['0x'+'c'.repeat(40)]);window.__financeFixture.pendingSign();});
    await page.waitForFunction(()=>document.querySelector('#wallet-login-state').textContent.includes('not verified')&&sessionStorage.getItem('ynx.finance.evm-login.pending.v1')===null);
    assert.equal(verifyCount,0);
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().account),'0x'+'c'.repeat(40));
    assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('ynx.finance.evm-login.pending.v1')),null);
  }finally{await page.close();}
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
test('4902 adds canonical Testnet EVM RPC first, retains the legacy fallback and verifies the chain before accounts',async()=>{
  const page=await fixture();try{await page.evaluate(()=>{const p=window.__financeFixture.metamask,request=p.request.bind(p);let first=true;p.request=async args=>{if(args.method==='wallet_switchEthereumChain'&&first){first=false;window.__financeFixture.calls.push({kind:'metamask',method:args.method});throw Object.assign(new Error('fixture unknown chain'),{code:4902});}return request(args);};});await connect(page);const observed=await calls(page),addition=observed[1].params[0];assert.deepEqual(observed.map(c=>c.method),['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain','eth_chainId','eth_requestAccounts','eth_chainId']);assert.equal(addition.chainId,'0x1917');assert.deepEqual(addition.rpcUrls,['https://rpc-testnet.ynxweb4.com/evm','https://rpc.ynxweb4.com/evm']);assert.deepEqual(page.financeErrors,[]);}finally{await page.close();}
});
test('account and chain events update identity; disconnect clears remembered provider',async()=>{
  const page=await fixture();try{await connect(page);await page.evaluate(()=>window.__financeFixture.metamask.emit('accountsChanged',['0x'+'c'.repeat(40)]));assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().account),'0x'+'c'.repeat(40));await page.evaluate(()=>window.__financeFixture.metamask.emit('chainChanged','0x1'));assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'wrong-chain');await page.evaluate(()=>window.__financeFixture.metamask.emit('chainChanged','0x1917'));assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'connected');await page.evaluate(()=>window.__financeFixture.metamask.emit('disconnect',{code:4900}));assert.equal(await page.evaluate(()=>window.YNXFinanceWallet.getStandardWalletState().status),'disconnected');assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);}finally{await page.close();}
});
test('Finance API discards late account-bound response after Standard identity changes',async()=>{
  const page=await fixture();try{await connect(page);await page.evaluate(()=>{const actual=window.YNXFinanceWallet;window.YNXFinanceWallet={...actual,requireProof:async()=>({proofHeader:'LOCAL-TEST-ONLY',requestId:'local-test-request'})};const original=window.fetch;window.fetch=(url,options)=>url==='/api/overview'?new Promise(resolve=>{window.__financeFixture.apiResolve=()=>resolve(new Response(JSON.stringify({account:'old-account-fixture'}),{status:200,headers:{'content-type':'application/json'}}));}):original(url,options);window.__financeFixture.apiResult=api('/api/overview').then(()=>({accepted:true}),error=>({accepted:false,error:error.message}));});await page.waitForFunction(()=>window.__financeFixture.apiResolve);await page.evaluate(()=>{window.__financeFixture.metamask.emit('accountsChanged',['0x'+'c'.repeat(40)]);window.__financeFixture.apiResolve();});const result=await page.evaluate(()=>window.__financeFixture.apiResult);assert.equal(result.accepted,false);assert.match(result.error,/FINANCE_CONTEXT_CHANGED/);}finally{await page.close();}
});

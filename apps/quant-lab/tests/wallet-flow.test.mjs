import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

// Local browser fixtures only: injected providers return test accounts and
// balances. Shared Wallet discovery/reducer and the built Quant UI execute
// unchanged. No installed wallet, signature, order or network is exercised.
let server,browser,base;
const web=new URL('../web/',import.meta.url);
test.before(async()=>{
  server=createServer(async(req,res)=>{
    if(req.url==='/api/v1/snapshot'){
      res.writeHead(200,{'content-type':'application/json'});
      return res.end(JSON.stringify({access:{statefulPreview:true},paper:{Cash:100,Position:2,ReconciliationDelta:0},strategies:{},experiments:{},audit:[]}));
    }
    const file=req.url==='/'?'index.html':String(req.url).slice(1);
    if(!/^[a-z0-9.-]+$/.test(file)){res.writeHead(404);return res.end();}
    try{const bytes=await readFile(new URL(file,web));res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(bytes);}
    catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve));});

async function pageWithProviders({onlyYNX=false,saved=null,deferSwitch=false,chainAfterApproval=null,revokeMode='success',deferRevoke=false,initiallyEmpty=false}={}){
  const page=await browser.newPage();
  await page.addInitScript(({onlyYNX,saved,deferSwitch,chainAfterApproval,revokeMode,deferRevoke,initiallyEmpty})=>{
    if(saved)localStorage.setItem('ynx.quant.standard-wallet.v1.provider',saved);
    const fixture={calls:[],deferSwitch,pendingSwitch:null,deferBalance:false,pendingBalance:null,revokeMode,deferRevoke,pendingRevoke:null,revokeResult:null};
    const make=(kind,address)=>{
      const listeners=new Map();
      const provider={
        isYNXWallet:kind==='ynx-wallet',isMetaMask:kind==='metamask',
        providerInfo:{rdns:kind==='ynx-wallet'?'com.ynx.wallet':'io.metamask'},
        account:initiallyEmpty?null:address,chain:'0x1917',
        on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},
        removeListener(event,fn){listeners.get(event)?.delete(fn);},
        emit(event,value){if(event==='accountsChanged')this.account=value[0];if(event==='chainChanged')this.chain=value;for(const fn of listeners.get(event)||[])fn(value);},
        async request({method,params}){
          fixture.calls.push({kind,method,params});
          if(method==='wallet_switchEthereumChain'){
            if(fixture.deferSwitch)return new Promise(resolve=>{fixture.pendingSwitch=()=>{fixture.deferSwitch=false;this.chain='0x1917';resolve(null);};});
            this.chain='0x1917';return null;
          }
          if(method==='wallet_addEthereumChain')return null;
          if(method==='wallet_revokePermissions'){
            if(fixture.revokeMode==='unsupported')throw Object.assign(new Error('Fixture wallet does not support revocation'),{code:4200});
            if(fixture.revokeMode==='rejected')throw Object.assign(new Error('Fixture user rejected revocation'),{code:4001});
            const acknowledge=()=>{
              if(fixture.revokeMode!=='nonempty')this.account=null;
              if(fixture.revokeMode==='success-event')this.emit('accountsChanged',[]);
              return null;
            };
            if(fixture.deferRevoke)return new Promise(resolve=>{fixture.pendingRevoke=()=>{fixture.deferRevoke=false;resolve(acknowledge());};});
            return acknowledge();
          }
          if(method==='eth_chainId')return this.chain;
          if(method==='eth_requestAccounts'&&chainAfterApproval)this.chain=chainAfterApproval;
          if(method==='eth_requestAccounts'||method==='eth_accounts')return this.account?[this.account]:[];
          if(method==='eth_blockNumber')return '0x2a';
          if(method==='eth_getBalance'){
            const balance=params[0]===`0x${'b'.repeat(40)}`?'0x1bc16d674ec80000':'0xde0b6b3a7640000';
            if(fixture.deferBalance)return new Promise(resolve=>{fixture.pendingBalance=()=>{fixture.deferBalance=false;resolve(balance);};});
            return balance;
          }
          throw new Error(`Unapproved provider method in local fixture: ${method}`);
        },
      };
      return provider;
    };
    fixture.ynx=make('ynx-wallet',`0x${'c'.repeat(40)}`);
    fixture.metamask=make('metamask',`0x${'a'.repeat(40)}`);
    window.__quantWalletFixture=fixture;
    window.ethereum={providers:onlyYNX?[fixture.ynx]:[fixture.ynx,fixture.metamask]};
  },{onlyYNX,saved,deferSwitch,chainAfterApproval,revokeMode,deferRevoke,initiallyEmpty});
  await page.goto(base);
  return page;
}
async function connectMetaMask(page){
  await page.locator('#connect-metamask').click();
  await page.waitForFunction(()=>window.YNXQuantWallet.getStandardWalletState().status==='connected');
  assert.equal(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().providerKind),'metamask');
}
async function calls(page){return page.evaluate(()=>window.__quantWalletFixture.calls);}

test('explicit MetaMask selection restores only MetaMask and exposes block-bound wallet assets separately from Paper',async()=>{
  const page=await pageWithProviders();
  try{
    await page.waitForTimeout(1700);
    assert.deepEqual(await calls(page),[]);
    await connectMetaMask(page);
    await page.getByRole('button',{name:'Portfolio',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#wallet-portfolio-balance')?.textContent.includes('1 YNXT'));
    assert.match(await page.locator('#wallet-portfolio-account').textContent(),/0x[a]{40}/);
    assert.match(await page.locator('#wallet-portfolio-block').textContent(),/42/);
    const first=await calls(page);
    assert.deepEqual(first.filter(x=>x.method==='eth_requestAccounts').map(x=>x.kind),['metamask']);
    assert.equal(first.filter(x=>x.kind==='ynx-wallet').length,0);
    assert.deepEqual(first.find(x=>x.method==='eth_getBalance').params,[`0x${'a'.repeat(40)}`,'0x2a']);
    const degraded=await page.evaluate(async()=>{
      window.YNXQuantWallet.reportRpcProbe({ready:false,code:'RPC_UNAVAILABLE'});
      let privateError='';
      try{await window.YNXQuantWallet.requireProof('quant:mandate:create');}catch(error){privateError=error.message;}
      return {privateError,state:window.YNXQuantWallet.getStandardWalletState()};
    });
    assert.match(degraded.privateError,/PRIVATE_SERVICE_DEGRADED/);
    assert.equal(degraded.state.status,'connected');
    assert.equal(degraded.state.account,`0x${'a'.repeat(40)}`);
    await page.reload();
    await page.waitForFunction(()=>window.YNXQuantWallet.getStandardWalletState().status==='connected');
    const restored=await calls(page);
    assert.equal(restored.filter(x=>x.method==='eth_requestAccounts').length,0);
    assert.equal(restored.filter(x=>x.kind==='ynx-wallet').length,0);
    assert.equal(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().providerKind),'metamask');
  }finally{await page.close();}
});

test('disconnect persists across reload and stale provider events cannot repopulate portfolio',async()=>{
  const page=await pageWithProviders();
  try{
    await connectMetaMask(page);
    await page.locator('#wallet-disconnect').click();
    assert.equal((await calls(page)).filter(call=>call.method==='wallet_revokePermissions').length,0,'local disconnect must never revoke wallet permissions');
    await page.evaluate(()=>window.__quantWalletFixture.metamask.emit('accountsChanged',[`0x${'b'.repeat(40)}`]));
    assert.equal(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().status),'disconnected');
    assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.standard-wallet.v1.provider')),null);
    await page.reload();await page.waitForTimeout(1700);
    assert.deepEqual(await calls(page),[]);
    assert.notEqual(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().status),'connected');
    assert.equal(await page.locator('#backtest').isVisible(),true);
  }finally{await page.close();}
});

test('missing saved MetaMask does not fall back to the available YNX provider',async()=>{
  const page=await pageWithProviders({onlyYNX:true,saved:'metamask'});
  try{await page.waitForTimeout(1800);assert.deepEqual(await calls(page),[]);assert.notEqual(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().status),'connected');}
  finally{await page.close();}
});

test('cancel during discovery prevents account and chain requests',async()=>{
  const page=await pageWithProviders();
  try{
    await page.locator('#connect-metamask').click();
    await page.locator('#wallet-disconnect').click();
    await page.waitForTimeout(1800);
    assert.deepEqual(await calls(page),[]);
    assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.standard-wallet.v1.provider')),null);
  }finally{await page.close();}
});

test('cancel during chain switch prevents later account permission and persistence',async()=>{
  const page=await pageWithProviders({deferSwitch:true});
  try{
    await page.locator('#connect-metamask').click();
    await page.waitForFunction(()=>typeof window.__quantWalletFixture.pendingSwitch==='function');
    await page.locator('#wallet-disconnect').click();
    await page.evaluate(()=>window.__quantWalletFixture.pendingSwitch());
    await page.waitForTimeout(100);
    assert.deepEqual((await calls(page)).map(x=>x.method),['wallet_switchEthereumChain']);
    assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.standard-wallet.v1.provider')),null);
  }finally{await page.close();}
});

test('chain is reverified after account approval and wrong-chain state is never persisted as connected',async()=>{
  const page=await pageWithProviders({chainAfterApproval:'0x1'});
  try{
    await page.locator('#connect-metamask').click();
    await page.waitForFunction(()=>window.__quantWalletFixture.calls.some(call=>call.method==='eth_requestAccounts'));
    await page.waitForFunction(()=>!document.querySelector('#connect-metamask').disabled);
    assert.notEqual(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().status),'connected');
    assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.standard-wallet.v1.provider')),null);
    assert.equal((await calls(page)).filter(call=>call.method==='eth_getBalance').length,0);
    assert.deepEqual((await calls(page)).slice(-2).map(call=>call.method),['eth_requestAccounts','eth_chainId']);
  }finally{await page.close();}
});

test('account changes invalidate signing drafts and delayed old-account balance results',async()=>{
  const page=await pageWithProviders();
  try{
    await connectMetaMask(page);
    await page.getByRole('button',{name:'Portfolio',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#wallet-portfolio-balance')?.textContent.includes('1 YNXT'));
    await page.evaluate(()=>{
      document.querySelector('#mandate-signature').value='fixture-old-signature';
      document.querySelector('#order-signature').value='fixture-old-order-signature';
      window.__quantWalletFixture.deferBalance=true;
    });
    await page.locator('#wallet-portfolio-refresh').click();
    await page.waitForFunction(()=>typeof window.__quantWalletFixture.pendingBalance==='function');
    await page.evaluate(()=>{
      window.__quantWalletFixture.deferBalance=false;
      window.__quantWalletFixture.metamask.emit('accountsChanged',[`0x${'b'.repeat(40)}`]);
    });
    await page.waitForFunction(()=>document.querySelector('#wallet-portfolio-balance')?.textContent.includes('2 YNXT'));
    await page.evaluate(()=>window.__quantWalletFixture.pendingBalance());
    await page.waitForTimeout(100);
    assert.match(await page.locator('#wallet-portfolio-account').textContent(),/0x[b]{40}/);
    assert.match(await page.locator('#wallet-portfolio-balance').textContent(),/2 YNXT/);
    assert.equal(await page.locator('#mandate-signature').inputValue(),'');
    assert.equal(await page.locator('#order-signature').inputValue(),'');
    await page.evaluate(()=>window.__quantWalletFixture.metamask.emit('chainChanged','0x1'));
    await page.waitForFunction(()=>window.YNXQuantWallet.getStandardWalletState().status!=='connected');
    assert.doesNotMatch(await page.locator('#wallet-portfolio-balance').textContent(),/2 YNXT/);
  }finally{await page.close();}
});

test('saved provider restore silently reads accounts then chain without a new permission request',async()=>{
  const page=await pageWithProviders({saved:'metamask'});
  try{
    await page.waitForFunction(()=>window.YNXQuantWallet.getStandardWalletState().status==='connected');
    const observed=await calls(page);
    assert.deepEqual(observed.slice(0,2).map(call=>call.method),['eth_accounts','eth_chainId']);
    assert.equal(observed.every(call=>call.kind==='metamask'),true);
    assert.equal(observed.some(call=>['eth_requestAccounts','wallet_requestPermissions','wallet_switchEthereumChain','wallet_addEthereumChain'].includes(call.method)),false);
    const state=await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState());
    assert.equal(state.account,`0x${'a'.repeat(40)}`);
    assert.equal(state.chainId,'0x1917');
  }finally{await page.close();}
});

test('saved provider with no exposed accounts remains disconnected without requesting a grant',async()=>{
  const page=await pageWithProviders({saved:'metamask',initiallyEmpty:true});
  try{
    await page.waitForFunction(()=>window.__quantWalletFixture.calls.some(call=>call.method==='eth_accounts'));
    await page.waitForTimeout(100);
    assert.notEqual(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().status),'connected');
    assert.deepEqual((await calls(page)).map(call=>call.method),['eth_accounts']);
  }finally{await page.close();}
});

test('explicit revoke accepts null acknowledgement only after empty accounts readback and clears the saved connection',async()=>{
  const page=await pageWithProviders();
  try{
    await connectMetaMask(page);
    assert.equal(await page.getByRole('button',{name:'Revoke wallet access',exact:true}).isVisible(),true);
    const before=await page.evaluate(()=>window.__quantWalletFixture.calls.length);
    const result=await page.evaluate(()=>window.YNXQuantWallet.revokeStandardWallet());
    assert.equal(result.status,'revoked');
    assert.equal(result.permissionRevoked,true);
    assert.equal(result.locallyDisconnected,true);
    const observed=(await calls(page)).slice(before);
    assert.deepEqual(observed.filter(call=>call.method==='wallet_revokePermissions').map(call=>({kind:call.kind,params:call.params})),[{kind:'metamask',params:[{eth_accounts:{}}]}]);
    const revokeIndex=observed.findIndex(call=>call.method==='wallet_revokePermissions');
    assert.equal(observed.slice(revokeIndex+1).some(call=>call.method==='eth_accounts'&&call.kind==='metamask'),true);
    assert.equal(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().status),'disconnected');
    assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.standard-wallet.v1.provider')),null);
    assert.equal(page.url(),base+'/');
    assert.equal(page.context().pages().length,1);
    await page.reload();await page.waitForTimeout(1700);
    assert.deepEqual(await calls(page),[]);
  }finally{await page.close();}
});

test('revoke button performs the standard permission action and tolerates the expected empty-accounts event',async()=>{
  const page=await pageWithProviders({revokeMode:'success-event'});
  try{
    await connectMetaMask(page);
    await page.locator('#wallet-revoke').click();
    await page.waitForFunction(()=>window.YNXQuantWallet.getStandardWalletState().status==='disconnected');
    assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.standard-wallet.v1.provider')),null);
    const observed=await calls(page);
    assert.equal(observed.filter(call=>call.method==='wallet_revokePermissions').length,1);
    assert.equal(observed.filter(call=>call.method==='eth_requestAccounts').length,1);
    assert.equal(await page.locator('#backtest').isVisible(),true);
  }finally{await page.close();}
});

for(const [mode,status,code] of [['unsupported','unsupported',4200],['rejected','rejected',4001],['nonempty','failed',4100]]){
  test(`unconfirmed revoke ${mode} preserves selected provider, account and saved preference`,async()=>{
    const page=await pageWithProviders({revokeMode:mode});
    try{
      await connectMetaMask(page);
      const before=await page.evaluate(()=>window.__quantWalletFixture.calls.length);
      const result=await page.evaluate(()=>window.YNXQuantWallet.revokeStandardWallet());
      assert.equal(result.status,status);
      assert.equal(result.permissionRevoked,false);
      assert.equal(result.locallyDisconnected,false);
      assert.equal(result.error.code,code);
      const state=await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState());
      assert.equal(state.status,'connected');
      assert.equal(state.providerKind,'metamask');
      assert.equal(state.account,`0x${'a'.repeat(40)}`);
      assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.standard-wallet.v1.provider')),'metamask');
      assert.equal(await page.locator('#wallet-details').isVisible(),true);
      const observed=(await calls(page)).slice(before);
      assert.equal(observed.filter(call=>call.method==='wallet_revokePermissions').length,1);
      assert.equal(observed.some(call=>call.method==='eth_requestAccounts'),false);
      assert.equal(observed.some(call=>call.kind!=='metamask'),false);
      assert.equal(page.url(),base+'/');
      assert.equal(page.context().pages().length,1);
    }finally{await page.close();}
  });
}

for(const intent of ['disconnect','switch']){
  test(`pending revoke cannot override a newer explicit ${intent} intent`,async()=>{
    const page=await pageWithProviders({deferRevoke:true});
    try{
      await connectMetaMask(page);
      await page.evaluate(()=>{window.__quantWalletFixture.revokePromise=window.YNXQuantWallet.revokeStandardWallet().then(result=>{window.__quantWalletFixture.revokeResult=result;return result;});});
      await page.waitForFunction(()=>typeof window.__quantWalletFixture.pendingRevoke==='function');
      await page.locator(intent==='switch'?'#wallet-switch':'#wallet-disconnect').click();
      if(intent==='switch'){
        await page.locator('#connect-wallet').click();
        await page.waitForFunction(()=>window.YNXQuantWallet.getStandardWalletState().providerKind==='ynx-wallet'&&window.YNXQuantWallet.getStandardWalletState().status==='connected');
      }
      await page.evaluate(()=>window.__quantWalletFixture.pendingRevoke());
      const result=await page.evaluate(()=>window.__quantWalletFixture.revokePromise);
      assert.equal(result.status,'superseded');
      assert.equal(result.permissionRevoked,false);
      const state=await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState());
      assert.equal(state.status,intent==='switch'?'connected':'disconnected');
      if(intent==='switch'){
        assert.equal(state.providerKind,'ynx-wallet');
        assert.equal(state.account,`0x${'c'.repeat(40)}`);
      }
      assert.equal(await page.evaluate(()=>localStorage.getItem('ynx.quant.standard-wallet.v1.provider')),intent==='switch'?'ynx-wallet':null);
      const observed=await calls(page);
      assert.deepEqual(observed.filter(call=>call.method==='wallet_revokePermissions').map(call=>call.kind),['metamask']);
      assert.equal(observed.filter(call=>call.method==='eth_requestAccounts').length,intent==='switch'?2:1);
    }finally{await page.close();}
  });
}

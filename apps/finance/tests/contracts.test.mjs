import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const base=new URL('../',import.meta.url);
const html=await readFile(new URL('web/index.html',base),'utf8');
const js=await readFile(new URL('web/app.js',base),'utf8');
const css=await readFile(new URL('web/styles.css',base),'utf8');
const wallet=await readFile(new URL('mobile/src/wallet.ts',base),'utf8');
const webWallet=await readFile(new URL('web/wallet-auth-entry.js',base),'utf8');
const webWalletRuntime=await readFile(new URL('web/standard-wallet-runtime.js',base),'utf8');
function browserWalletContext(ethereum){
  const document={readyState:'complete',querySelector:()=>null,addEventListener:()=>{},removeEventListener:()=>{}};
  const context=vm.createContext({document,ethereum,Promise,Error,Object,Date,CustomEvent:class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail}},Event:class Event{constructor(type){this.type=type}},setTimeout,clearTimeout,crypto:{randomUUID:()=>"12345678-1234-1234-8234-123456789abc"},dispatchEvent:()=>true,addEventListener:()=>{},removeEventListener:()=>{}});
  context.window=context;
  vm.runInContext(webWalletRuntime,context,{filename:'standard-wallet-runtime.js'});
  vm.runInContext(webWallet,context,{filename:'wallet-auth-entry.js'});
  return context;
}

test('product states its non-bank and non-custodial boundary',()=>{
  for(const phrase of ['No custody','bank account','No fiat conversion inferred','Finance cannot freeze assets']) assert.ok(html.includes(phrase),phrase);
  assert.ok(js.includes('This is not a bank statement'));
  for(const disclosure of ['Counterparty','Custody','Contract','Principal-loss risk','Fee','Liquidity risk','Jurisdiction risk','Signature boundary']) assert.ok(html.includes(disclosure),disclosure);
  for(const prohibited of ['APY 8%','Guaranteed return','Visa card balance']) assert.equal(html.includes(prohibited),false);
});
test('wallet consumes the accepted Provider discovery runtime while private service routes degrade',()=>{
  for(const marker of ['@ynx/dapp-connect-sdk','StandardWalletConnection','PRODUCT_SESSION_UNAVAILABLE','WALLET_NOT_FOUND']) assert.ok(wallet.includes(marker),marker);
  for(const prohibited of ['createGatewayChallenge','signGatewayChallenge','createProductSessionProof','sessions/complete','p256']) assert.equal(wallet.includes(prohibited),false,prohibited);
  assert.ok(js.includes('API_UNAVAILABLE'));
  assert.equal(js.includes('/api/auth/session'),false,'legacy local auth must be absent');
  for(const marker of ['YNXFinanceStandardWalletRuntime','discoverWalletProviders','createStandardWalletConnectState','reduceStandardWalletConnectState','98c6d5d784d212df8981a53b17118a511e246ad2','51a60a362d4ad5dd748bcdefb101f71b1d9e0cee'])assert.ok(webWallet.includes(marker),marker);
  assert.ok(webWallet.includes('PRODUCT_SESSION_UNAVAILABLE'));
  assert.ok(webWallet.includes("productApi:'PENDING'"));
  assert.equal(js.includes('Bearer '),false,'legacy browser bearer session must be absent');
  assert.ok(js.includes("crypto.randomUUID()"));
  assert.ok(js.includes("No receipt placeholders are shown"));
  assert.ok(js.includes("data-ai=apply"));
  assert.ok(js.includes("Delete draft data"));
  assert.ok(js.includes("window.confirm"));
});
test('web wallet chooser keeps YNX Wallet and MetaMask distinct',()=>{
  for(const marker of ['Download YNX Wallet','Connect YNX Wallet','Connect MetaMask','Wallet version details','id="connect-metamask"']) assert.ok(html.includes(marker),marker);
  for(const marker of ['0x1917','evmRpc','discoverWalletProviders','WALLET_NOT_FOUND']) assert.ok(webWallet.includes(marker),marker);
  const distribution=html.indexOf('src="/standard-wallet-runtime.js"');
  const entry=html.indexOf('src="/wallet-auth-entry.js"');
  const application=html.indexOf('src="/app.js"');
  assert.ok(distribution>=0,'the accepted browser SDK distribution must load');
  assert.ok(entry>distribution,'Finance wallet entry must load after its SDK distribution');
  assert.ok(application>entry,'Finance application must load after window.YNXFinanceWallet is defined');
  assert.equal(html.includes('test-signed.apk'),false);
});
test('shared runtime and Finance entry define the fail-closed wallet bridge before application code',async()=>{
  const context=browserWalletContext();
  await context.YNXFinanceWallet.ready;
  assert.equal(typeof context.YNXFinanceWallet.connect,'function');
  assert.equal(typeof context.YNXFinanceWallet.disconnect,'function');
  assert.equal(context.YNXFinanceWallet.connected(),false);
  const authority=context.YNXFinanceWallet.providerAuthority();
  assert.equal(authority.sourceCommit,'98c6d5d784d212df8981a53b17118a511e246ad2');assert.equal(authority.sourceTree,'51a60a362d4ad5dd748bcdefb101f71b1d9e0cee');assert.equal(authority.evidenceCommit,'c3ab255c32bdeb9c8e056882c315f8ad43c29c7f');
  assert.throws(()=>context.YNXFinanceWallet.requireProof(),/PRODUCT_SESSION_UNAVAILABLE/);
});
test('web restores an approved provider and clears only the standard connection on provider lifecycle events',async()=>{
  const first='0x1111111111111111111111111111111111111111',second='0x2222222222222222222222222222222222222222';
  const state={accounts:[first],chainId:'0x1917'},listeners=new Map();
  const provider={
    request:async({method})=>method==='eth_accounts'?state.accounts:method==='eth_chainId'?state.chainId:Promise.reject(new Error(`unexpected ${method}`)),
    on:(event,listener)=>listeners.set(event,listener),removeListener:(event,listener)=>{if(listeners.get(event)===listener)listeners.delete(event)},
  };
  provider.isMetaMask=true;
  const context=browserWalletContext(provider);
  await context.YNXFinanceWallet.ready;
  assert.equal(context.YNXFinanceWallet.connection()?.account,first);
  assert.equal(context.YNXFinanceWallet.connection()?.chainId,'0x1917');
  state.accounts=[second];listeners.get('accountsChanged')(state.accounts);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(context.YNXFinanceWallet.connection()?.account,second);
  assert.equal(context.YNXFinanceWallet.connection()?.chainId,'0x1917');
  listeners.get('chainChanged')('0x1');
  assert.equal(context.YNXFinanceWallet.connected(),false,'wrong-chain event must clear standard Wallet permissions');
  assert.equal(context.YNXFinanceWallet.session(),null,'Product Session remains unavailable rather than fabricated');
});
test('web verifies or adds YNX Testnet before requesting a Finance account',async()=>{
  const calls=[],state={accounts:['0x1111111111111111111111111111111111111111'],chainId:'0x1',switches:0};
  const provider={request:async({method})=>{calls.push(method);if(method==='eth_accounts')return [];if(method==='wallet_switchEthereumChain'&&++state.switches===1)throw Object.assign(new Error('unknown chain'),{code:4902});if(method==='wallet_switchEthereumChain'){state.chainId='0x1917';return null}if(method==='wallet_addEthereumChain')return null;if(method==='eth_chainId')return state.chainId;if(method==='eth_requestAccounts')return state.accounts;throw new Error(`unexpected ${method}`)}};
  provider.isMetaMask=true;
  const context=browserWalletContext(provider);await context.YNXFinanceWallet.ready;calls.length=0;
  await context.YNXFinanceWallet.connect('metamask');
  assert.deepEqual(calls,['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain','eth_chainId','eth_requestAccounts']);
});
test('default YNX Wallet action never substitutes a detected MetaMask provider',async()=>{
  const calls=[],provider={isMetaMask:true,request:async({method})=>{calls.push(method);if(method==='eth_accounts')return [];if(method==='eth_chainId')return '0x1917';throw new Error(`unexpected ${method}`)}};
  const context=browserWalletContext(provider);await context.YNXFinanceWallet.ready;calls.length=0;
  await assert.rejects(context.YNXFinanceWallet.connect(),/WALLET_NOT_FOUND/);
  assert.deepEqual(calls,[],'default YNX selection must not request from MetaMask');
});
test('web wrong-chain failure never requests a Finance account',async()=>{
  const calls=[],provider={request:async({method})=>{calls.push(method);if(method==='eth_accounts')return [];if(method==='wallet_switchEthereumChain')return null;if(method==='eth_chainId')return '0x1';throw new Error(`unexpected ${method}`)}};
  provider.isMetaMask=true;
  const context=browserWalletContext(provider);await context.YNXFinanceWallet.ready;calls.length=0;
  await assert.rejects(context.YNXFinanceWallet.connect('metamask'),/WRONG_CHAIN/);assert.deepEqual(calls,['wallet_switchEthereumChain','eth_chainId']);
});
test('public and private read reconnect are bounded and mutations are never automatically replayed',()=>{
  for(const marker of ['id="network-retry"','Reconnect YNX Chain']) assert.ok(html.includes(marker),marker);
  for(const marker of ['READ_RETRY_DELAYS=[0,600,1600]','fetch(\'/health\'','AbortSignal.timeout(10_000)',"window.addEventListener('online'",'FINANCE_SERVICE_UNAVAILABLE','Finance service reachable · Wallet not connected']) assert.ok(js.includes(marker),marker);
  for(const forbidden of ['publicEndpoints()','cosmos/base/tendermint/v1beta1/blocks/latest','rpc.ynxweb4.com']) assert.equal(js.includes(forbidden),false,`browser chain probe must stay out of Finance reconnect: ${forbidden}`);
});
test('a standard Wallet connection has a visible no-data state while the Finance API is pending',()=>{
  for(const marker of ['id="connected-degraded"','Standard Wallet connected','Nothing is inferred','no Finance data request was sent']) assert.ok(html.includes(marker),marker);
  for(const marker of ['async function signIn(){try{await window.YNXFinanceWallet.connect();await load()}','function renderConnectedDegraded()','function applyStandardWalletState(wallet)','ynx-finance-standard-wallet-state','renderConnectedDegraded();try{await publicHealth()','connected-degraded\').classList.remove(\'hidden\')']) assert.ok(js.includes(marker),marker);
  assert.equal(js.includes("await api('/api/overview')"),false,'pending product API must not be queried after Wallet connection');
});
test('responsive and accessibility contracts exist',()=>{
  assert.ok(html.includes('class="skip"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(css.includes('@media(max-width:720px)'));
  assert.ok(css.includes('prefers-reduced-motion'));
  assert.ok(css.includes('#002FA7'));
});

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
const webWalletDistribution=await readFile(new URL('web/wallet-auth.js',base),'utf8');

test('product states its non-bank and non-custodial boundary',()=>{
  for(const phrase of ['No custody','bank account','No fiat conversion inferred','Finance cannot freeze assets']) assert.ok(html.includes(phrase),phrase);
  assert.ok(js.includes('This is not a bank statement'));
  for(const disclosure of ['Counterparty','Custody','Contract','Principal-loss risk','Fee','Liquidity risk','Jurisdiction risk','Signature boundary']) assert.ok(html.includes(disclosure),disclosure);
  for(const prohibited of ['APY 8%','Guaranteed return','Visa card balance']) assert.equal(html.includes(prohibited),false);
});
test('wallet uses the accepted standard SDK while private service routes degrade',()=>{
  for(const marker of ['@ynx/dapp-connect-sdk','StandardWalletConnection','PRODUCT_SESSION_UNAVAILABLE','WALLET_NOT_FOUND']) assert.ok(wallet.includes(marker),marker);
  for(const prohibited of ['createGatewayChallenge','signGatewayChallenge','createProductSessionProof','sessions/complete','p256']) assert.equal(wallet.includes(prohibited),false,prohibited);
  assert.ok(js.includes('API_UNAVAILABLE'));
  assert.equal(js.includes('/api/auth/session'),false,'legacy local auth must be absent');
  assert.ok(webWallet.includes('StandardWalletConnection'));
  assert.ok(webWallet.includes('PRODUCT_SESSION_UNAVAILABLE'));
  assert.ok(webWallet.includes("productApi:'PENDING'"));
  assert.equal(js.includes('Bearer '),false,'legacy browser bearer session must be absent');
  assert.ok(js.includes("crypto.randomUUID()"));
  assert.ok(js.includes("No receipt placeholders are shown"));
  assert.ok(js.includes("data-ai=apply"));
  assert.ok(js.includes("Delete draft data"));
  assert.ok(js.includes("window.confirm"));
});
test('web wallet chooser links to the centrally managed downloads page and standard connection',()=>{
  for(const marker of ['Download YNX Wallet','Connect compatible wallet','Wallet version details','id="connect-metamask"']) assert.ok(html.includes(marker),marker);
  for(const marker of ['0x1917','evmRpc','StandardWalletConnection','WALLET_NOT_FOUND']) assert.ok(webWallet.includes(marker),marker);
  const distribution=html.indexOf('src="/wallet-auth.js"');
  const entry=html.indexOf('src="/wallet-auth-entry.js"');
  const application=html.indexOf('src="/app.js"');
  assert.ok(distribution>=0,'the accepted browser SDK distribution must load');
  assert.ok(entry>distribution,'Finance wallet entry must load after its SDK distribution');
  assert.ok(application>entry,'Finance application must load after window.YNXFinanceWallet is defined');
  assert.equal(html.includes('test-signed.apk'),false);
});
test('web SDK distribution and Finance entry define the fail-closed wallet bridge before application code',async()=>{
  const window={};
  const context=vm.createContext({window,document:{querySelector:()=>null},Promise,Error,Object,Date,CustomEvent:class CustomEvent{}});
  vm.runInContext(webWalletDistribution,context,{filename:'wallet-auth.js'});
  vm.runInContext(webWallet,context,{filename:'wallet-auth-entry.js'});
  await window.YNXFinanceWallet.ready;
  assert.equal(typeof window.YNXFinanceWallet.connect,'function');
  assert.equal(typeof window.YNXFinanceWallet.disconnect,'function');
  assert.equal(window.YNXFinanceWallet.connected(),false);
  assert.throws(()=>window.YNXFinanceWallet.requireProof(),/PRODUCT_SESSION_UNAVAILABLE/);
});
test('public and private read reconnect are bounded and mutations are never automatically replayed',()=>{
  for(const marker of ['id="network-retry"','Reconnect YNX Chain']) assert.ok(html.includes(marker),marker);
  for(const marker of ['READ_RETRY_DELAYS=[0,600,1600]','fetch(\'/health\'','AbortSignal.timeout(10_000)',"window.addEventListener('online'",'FINANCE_SERVICE_UNAVAILABLE','Finance service reachable · Wallet not connected']) assert.ok(js.includes(marker),marker);
  for(const forbidden of ['publicEndpoints()','cosmos/base/tendermint/v1beta1/blocks/latest','rpc.ynxweb4.com']) assert.equal(js.includes(forbidden),false,`browser chain probe must stay out of Finance reconnect: ${forbidden}`);
});
test('a standard Wallet connection has a visible no-data state while the Finance API is pending',()=>{
  for(const marker of ['id="connected-degraded"','Standard Wallet connected','Nothing is inferred','no Finance data request was sent']) assert.ok(html.includes(marker),marker);
  for(const marker of ['async function signIn(){try{await window.YNXFinanceWallet.connect();await load()}','function renderConnectedDegraded()','renderConnectedDegraded();try{await publicHealth()','connected-degraded\').classList.remove(\'hidden\')']) assert.ok(js.includes(marker),marker);
  assert.equal(js.includes("await api('/api/overview')"),false,'pending product API must not be queried after Wallet connection');
});
test('responsive and accessibility contracts exist',()=>{
  assert.ok(html.includes('class="skip"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(css.includes('@media(max-width:720px)'));
  assert.ok(css.includes('prefers-reduced-motion'));
  assert.ok(css.includes('#002FA7'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL('../',import.meta.url);
const html=await readFile(new URL('web/index.html',base),'utf8');
const js=await readFile(new URL('web/app.js',base),'utf8');
const css=await readFile(new URL('web/styles.css',base),'utf8');
const wallet=await readFile(new URL('mobile/src/wallet.ts',base),'utf8');
const webWallet=await readFile(new URL('web/wallet-auth-entry.js',base),'utf8');

test('product states its non-bank and non-custodial boundary',()=>{
  for(const phrase of ['No custody','bank account','No fiat conversion inferred','Finance cannot freeze assets']) assert.ok(html.includes(phrase),phrase);
  assert.ok(js.includes('This is not a bank statement'));
  for(const disclosure of ['Counterparty','Custody','Contract','Principal-loss risk','Fee','Liquidity risk','Jurisdiction risk','Signature boundary']) assert.ok(html.includes(disclosure),disclosure);
  for(const prohibited of ['APY 8%','Guaranteed return','Visa card balance']) assert.equal(html.includes(prohibited),false);
});
test('wallet, real-source, export and AI review paths are wired',()=>{
  for(const path of ['/v1/wallet/sessions/complete','/v1/wallet/sessions/introspect']) assert.ok(wallet.includes(path),path);
  assert.ok(wallet.includes('createProductSessionProof'));
  for(const path of ['/api/overview','/api/statements','/api/export?format=json','/api/ai/jobs']) assert.ok(js.includes(path),path);
  assert.equal(js.includes('/api/auth/session'),false,'legacy local auth must be absent');
  assert.ok(webWallet.includes('createProductSessionProof'));
  assert.ok(webWallet.includes('/v1/wallet/sessions/revoke'));
  assert.ok(webWallet.includes('https://finance.ynxweb4.com/wallet-auth/callback'));
  assert.equal(js.includes('Bearer '),false,'legacy browser bearer session must be absent');
  assert.ok(js.includes("crypto.randomUUID()"));
  assert.ok(js.includes("No receipt placeholders are shown"));
  assert.ok(js.includes("data-ai=apply"));
  assert.ok(js.includes("Delete draft data"));
  assert.ok(js.includes("window.confirm"));
});
test('web wallet chooser offers the official Wallet release and bounded MetaMask compatibility',()=>{
  for(const marker of ['Download YNX Wallet','Connect MetaMask','Wallet version details','id="connect-metamask"']) assert.ok(html.includes(marker),marker);
  for(const marker of ['ynx-wallet-1.0.1-testnet-preview-dc31c9a8-test-signed.apk','0x1917','wallet_switchEthereumChain','wallet_addEthereumChain','eth_chainId','eth_requestAccounts']) assert.ok(webWallet.includes(marker),marker);
  assert.ok(webWallet.includes('only for EVM compatibility'));
});
test('public and private read reconnect are bounded and mutations are never automatically replayed',()=>{
  for(const marker of ['id="network-retry"','Reconnect YNX Chain']) assert.ok(html.includes(marker),marker);
  for(const marker of ['READ_RETRY_DELAYS=[0,600,1600]','readOnly?READ_RETRY_DELAYS.length:1',"method==='GET'",'AbortSignal.timeout(10_000)',"window.addEventListener('online'",'Connection unavailable',"fetch('/health'",'YNX Testnet reachable · Wallet not connected']) assert.ok(js.includes(marker),marker);
});
test('responsive and accessibility contracts exist',()=>{
  assert.ok(html.includes('class="skip"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(css.includes('@media(max-width:720px)'));
  assert.ok(css.includes('prefers-reduced-motion'));
  assert.ok(css.includes('#002FA7'));
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {verifyExchangeVersionedAssets} from '../web/verify-versioned-assets.mjs';import {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_RPC_PROBE,STANDARD_WALLET_RPC_PROBE_TRANSPORT} from '../web/node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js';
const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');const css=fs.readFileSync(new URL('../web/styles.css',import.meta.url),'utf8');const js=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');const walletEntry=fs.readFileSync(new URL('../web/wallet-connect-entry.js',import.meta.url),'utf8');
const localeSource=fs.readFileSync(new URL('../web/locale.js',import.meta.url),'utf8');
function assertNoCredentialStorage(source){
  const preference="let languageStorage;try{languageStorage=window.localStorage}catch{}";
  assert.equal(source.split(preference).length,2,'only the exact public language preference accessor is permitted');
  assert.match(source,/installExchangeLocale\(\{document,storage:languageStorage,/u);
  assert.doesNotMatch(source.replace(preference,''),/sessionStorage|localStorage|session_token|auth\/challenges|auth\/sessions/);
  assert.deepEqual([...localeSource.matchAll(/storage\?\.(?:getItem|setItem)\('([^']+)'/gu)].map(m=>m[1]),['ynx-exchange-language','ynx-exchange-language']);
  assert.match(localeSource,/setItem\('ynx-exchange-language',locale\)/u);
}
function assertQuietIdentityNavigation(source){
  const start=source.indexOf('async function restoreBrowserIdentityQuietly(){'),end=source.indexOf('\nfunction resumeDeferredBrowserIdentity()',start);
  assert.ok(start>=0&&end>start,'complete ordinary identity recovery function must be present');
  const quiet=source.slice(start,end);
  assert.equal((source.match(/location\.assign\(/gu)||[]).length,0);
  for(const marker of ['browserIdentityRestoreDeferred=false','browserIdentitySilentAttempted=true'])assert.ok(quiet.includes(marker),marker);
  assert.doesNotMatch(quiet,/personal_sign|ynx_request|beginExplicit|\.connect\(|window\.open|iframe|ynxwallet:|location\.(assign|replace)|browserIdentityRequest\(/u);
  for(const forbidden of ['ynxwallet:','iframe','window.open','location.assign','location.href='])assert.equal(source.replace(quiet,'').includes(forbidden),false,forbidden);
  return quiet;
}
test('truthful venue and unsupported-route disclosures are visible',()=>{for(const phrase of ['TESTNET ONLY','No third-party price, liquidity, public volume, users or counterparties','Cross-chain · unavailable','non-withdrawable venue credit'])assert.match(html,new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))) });
test('guest market reads are independent of pending private account and order authority',()=>{assert.match(html,/Recent venue matches/);assert.match(html,/Actual persisted price-time matches/);assert.match(html,/id="public-trades"/);assert.match(js,/createMarketFeed/);assert.match(js,/marketFeed\.retry/);assert.match(js,/API_UNAVAILABLE/);assert.match(js,/No request was sent/);assert.match(html,/id="market-retry"/);assert.match(html,/type="module"/)});
test('responsive and reduced-motion foundations exist',()=>{assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.match(html,/name="viewport"/)});
test('accessibility landmarks, labels, live status and keyboard focus exist',()=>{for(const marker of ['<main id="main"','aria-label="Primary"','aria-live="polite"','Skip to trading workspace','focus-visible'])assert.ok(html.includes(marker)||css.includes(marker),marker)});
test('AI is bounded and cannot execute an order',()=>{assert.match(html,/AI can draft values only/);assert.match(js,/API_UNAVAILABLE/);const fn=js.slice(js.indexOf('async function requestAI'));assert.doesNotMatch(fn,/\/v1\/orders|place_order|fetch\(/)});
test('legacy browser sessions are absent and record rendering avoids unsafe HTML',()=>{assertNoCredentialStorage(js);assert.match(js,/requireProductSession/);assert.match(js,/textContent=v/) });
test('Web Wallet exposes distinct YNX Wallet and MetaMask choices while keeping guest data available',()=>{for(const marker of ['connect-ynx-wallet','connect-metamask','wallet-retry','YNXExchangeWebWallet.connectYNX','YNXExchangeWebWallet.connectMetaMask','showWalletFallback','Download YNX Wallet','Use MetaMask'])assert.ok((html+js).includes(marker),marker);assertQuietIdentityNavigation(js)});
test('MetaMask route selects only the discovered MetaMask provider',()=>{for(const marker of ['WALLET_PROVIDER_KIND.METAMASK','discovery.metamask','connectMetaMask'])assert.ok(walletEntry.includes(marker),marker);assert.match(walletEntry,/kind===WALLET_PROVIDER_KIND\.METAMASK\?discovery\.metamask:discovery\.ynx/)});
test('guest identity recheck never starts automatic top-level SSO navigation',()=>{
  assertQuietIdentityNavigation(js);
});
test('precise source checks still reject credential persistence and extra or permission-seeking navigation',()=>{
  for(const bad of [js+"\nlocalStorage.setItem('token',secret)",js+"\nsessionStorage.setItem('session',secret)",js+"\nconst session_token='bad'"])assert.throws(()=>assertNoCredentialStorage(bad));
  const quiet=assertQuietIdentityNavigation(js);
  const mutations=[quiet.replace('browserIdentitySilentAttempted=true;',"browserIdentitySilentAttempted=true;window.open('ynxwallet://authorize');"),quiet.replace('browserIdentitySilentAttempted=true;',"browserIdentitySilentAttempted=true;location.assign('/sso/start?prompt=none');")];
  assert.throws(()=>assertQuietIdentityNavigation(js+"\nlocation.assign('https://attacker.invalid')"));
  for(const mutated of mutations){assert.notEqual(mutated,quiet,'negative case must change the inspected function');assert.throws(()=>assertQuietIdentityNavigation(js.replace(quiet,mutated)))}
});
test('standard Wallet switches or adds the accepted shared 0x1917 chain before requesting an account',()=>{for(const marker of ['wallet_switchEthereumChain','wallet_addEthereumChain','STANDARD_WALLET_CHAIN_ID','METAMASK_EVM_CHAIN','current.connect()','connection.restore()','reduceStandardWalletConnectState'])assert.ok(walletEntry.includes(marker),marker);assert.ok(walletEntry.indexOf('wallet_switchEthereumChain')<walletEntry.indexOf('current.connect()'));assert.doesNotMatch(walletEntry,/fetch\s*\(\s*[`'"]https:\/\/rpc\.ynxweb4\.com\/evm/);for(const forbidden of ['ynxwallet:','iframe','window.open','location.assign','location.href='])assert.equal(walletEntry.includes(forbidden),false,forbidden)});
test('accepted RPC probe degradation cannot clear a completed standard Wallet connection',()=>{const account='0x0123456789abcdef0123456789abcdef01234567';let value=createStandardWalletConnectState();value=reduceStandardWalletConnectState(value,{type:'BEGIN',pendingIntent:'exchangeconnectintent_20260821'});value=reduceStandardWalletConnectState(value,{type:'PROVIDER_SELECTED',providerKind:'metamask'});value=reduceStandardWalletConnectState(value,{type:'ACCOUNT_APPROVED',account});value=reduceStandardWalletConnectState(value,{type:'CHAIN_CONFIRMED',chainId:'0x1917'});assert.throws(()=>reduceStandardWalletConnectState(value,{type:'RPC_PROBE_DEGRADED',probeTransport:'direct-browser-rpc-fetch',code:'RPC_UNAVAILABLE'}),{code:'UNSAFE_BROWSER_RPC_PROBE'});value=reduceStandardWalletConnectState(value,{type:'RPC_PROBE_DEGRADED',probeTransport:STANDARD_WALLET_RPC_PROBE_TRANSPORT,code:'RPC_UNAVAILABLE'});assert.equal(value.status,'connected');assert.equal(value.rpcProbe,STANDARD_WALLET_RPC_PROBE.DEGRADED);assert.equal(value.chooserOpen,false);assert.equal(value.pendingIntent,null)});
test('Exchange HTML and its static module graph bind final asset bytes, not unversioned cache keys',()=>{
  const readAsset=name=>fs.readFileSync(new URL(`../web/${name}`,import.meta.url));
  assert.deepEqual(verifyExchangeVersionedAssets(html,js,readAsset),{status:'pass',pageAssets:4,moduleAssets:7});
  assert.throws(()=>verifyExchangeVersionedAssets(html.replace('/wallet-connect.js?v=','/wallet-connect.js?old='),js,readAsset),/EXCHANGE_ASSET_HASH_MISMATCH/);
  assert.throws(()=>verifyExchangeVersionedAssets(html,js.replace('./market-data.js?v=','./market-data.js?old='),readAsset),/EXCHANGE_MODULE_HASH_MISMATCH/);
  assert.throws(()=>verifyExchangeVersionedAssets(html,js,name=>name==='private-session.js'?Buffer.from('changed bundle'):readAsset(name)),/EXCHANGE_MODULE_HASH_MISMATCH/);
  assert.throws(()=>verifyExchangeVersionedAssets(html,js+"\nimport {x} from './foreign.js';",readAsset),/EXCHANGE_UNTRACKED_MODULE/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL('../',import.meta.url);
const html=await readFile(new URL('web/index.html',base),'utf8');
const js=await readFile(new URL('web/app.js',base),'utf8');
const css=await readFile(new URL('web/styles.css',base),'utf8');
const wallet=await readFile(new URL('mobile/src/wallet.ts',base),'utf8');
const manifest=await readFile(new URL('mobile/contract/public-endpoint-manifest.json',base),'utf8');
const webWallet=await readFile(new URL('web/wallet-auth.js',base),'utf8');
const providerEvidence=JSON.parse(await readFile(new URL('evidence/p0-finance-provider-connect-state-20260821.json',base),'utf8'));
const migrationEvidence=JSON.parse(await readFile(new URL('evidence/p0-finance-product-wallet-migration-evidence-20260821.json',base),'utf8'));
const {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_RPC_PROBE,STANDARD_WALLET_RPC_PROBE_TRANSPORT}=await import(new URL('../web/node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js',import.meta.url));
const {evaluateProductWalletMigrationEvidence}=await import(new URL('../web/node_modules/@ynx-chain/wallet-auth/src/index.js',import.meta.url));

test('product states its non-bank and non-custodial boundary',()=>{
  for(const phrase of ['No custody','bank account','No fiat conversion inferred','Finance cannot freeze assets']) assert.ok(html.includes(phrase),phrase);
  assert.ok(js.includes('This is not a bank statement'));
  for(const disclosure of ['Counterparty','Custody','Contract','Principal-loss risk','Fee','Liquidity risk','Jurisdiction risk','Signature boundary']) assert.ok(html.includes(disclosure),disclosure);
  for(const prohibited of ['APY 8%','Guaranteed return','Visa card balance']) assert.equal(html.includes(prohibited),false);
});

test('mobile source keeps the accepted Wallet contracts while the public frontend keeps its reviewed 75f Wallet semantics',()=>{
  for(const marker of ['@ynx/dapp-connect-sdk','StandardWalletConnection','@ynx-chain/wallet-auth','createProductWalletConnection','PRODUCT_SESSION_UNAVAILABLE','WALLET_NOT_FOUND']) assert.ok(wallet.includes(marker),marker);
  for(const required of ['encodeRequestDeepLink','parseAuthorizationCallbackURL','CANONICAL_AUTHORIZATION_PENDING_KEY']) assert.ok(wallet.includes(required),required);
  for(const prohibited of ['createGatewayChallenge','signGatewayChallenge','createProductSessionProof','sessions/complete','gatewayEndpoint','deviceSecret']) assert.equal(wallet.includes(prohibited),false,prohibited);
  assert.equal(/Linking\.openURL\(\s*['"`]ynxwallet:\/\/authorize/.test(wallet),false);
  for(const route of ["fetch('/health'",'/api/overview','/api/export?format=json']) assert.ok(js.includes(route),route);
  assert.equal(js.includes('Bearer '),false,'legacy browser bearer session must be absent');
  assert.ok(manifest.includes('1.0.0-p0.2'));
  assert.ok(manifest.includes('"finance":{"status":"PENDING"'));
});

test('responsive and accessibility contracts exist',()=>{
  assert.ok(html.includes('class="skip"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(css.includes('@media(max-width:720px)'));
  assert.ok(css.includes('prefers-reduced-motion'));
  assert.ok(css.includes('#002FA7'));
});

test('public Wallet frontend is pinned to the reviewed 75f resources and never emits a bare authorization request',()=>{
  for(const marker of ['Download YNX Wallet','Connect MetaMask','Wallet version details','wallet-auth.js'])assert.ok(html.includes(marker),marker);
  for(const marker of ['ynxwallet://authorize?request=','productClientId','bundleId','callback','scopes','nonce','issuedAt','expiresAt','productDeviceKey','wallet_switchEthereumChain','wallet_addEthereumChain','eth_chainId','eth_requestAccounts'])assert.ok(webWallet.includes(marker),marker);
  assert.equal(webWallet.includes('ynxwallet://authorize\"'),false,'a bare authorization deep link must not be emitted');
  assert.equal(/fetch\s*\(\s*[`'"]https:\/\/rpc\.ynxweb4\.com\/evm/.test(webWallet),false,'direct browser RPC probing cannot gate provider connection');
  assert.equal(html.includes('wallet-connect.js'),false,'the candidate must not restore the publicly absent legacy asset');
});

test('shared provider connection state keeps a selected approved 0x1917 Wallet connected when an accepted RPC probe degrades',()=>{
  const account='0x1234567890abcdef1234567890abcdef12345678';
  let value=createStandardWalletConnectState();
  value=reduceStandardWalletConnectState(value,{type:'BEGIN',pendingIntent:'financeconnectintent_20260821'});
  value=reduceStandardWalletConnectState(value,{type:'PROVIDER_SELECTED',providerKind:'metamask'});
  value=reduceStandardWalletConnectState(value,{type:'ACCOUNT_APPROVED',account});
  value=reduceStandardWalletConnectState(value,{type:'CHAIN_CONFIRMED',chainId:'0x1917'});
  assert.equal(value.status,'connected');
  assert.equal(value.chooserOpen,false);
  assert.equal(value.pendingIntent,null);
  assert.throws(()=>reduceStandardWalletConnectState(value,{type:'RPC_PROBE_DEGRADED',probeTransport:'direct-browser-rpc-fetch',code:'RPC_UNAVAILABLE'}),{code:'UNSAFE_BROWSER_RPC_PROBE'});
  value=reduceStandardWalletConnectState(value,{type:'RPC_PROBE_DEGRADED',probeTransport:STANDARD_WALLET_RPC_PROBE_TRANSPORT,code:'RPC_UNAVAILABLE'});
  assert.equal(value.status,'connected');
  assert.equal(value.account,account);
  assert.equal(value.chainId,'0x1917');
  assert.equal(value.rpcProbe,STANDARD_WALLET_RPC_PROBE.DEGRADED);
  assert.equal(value.chooserOpen,false);
});

test('provider evidence binds the accepted source tree rather than its vendored package subtree',()=>{
  const dependency=providerEvidence.acceptedDependency;
  assert.equal(providerEvidence.schemaVersion,2);
  assert.equal(dependency.sourceCommit,'98c6d5d784d212df8981a53b17118a511e246ad2');
  assert.equal(dependency.sourceTree,'51a60a362d4ad5dd748bcdefb101f71b1d9e0cee');
  assert.equal(dependency.evidenceCommit,'c3ab255c32bdeb9c8e056882c315f8ad43c29c7f');
  assert.equal(dependency.walletAuthPackageTree,'69ba84eaef503932ba1b66f42a9caa0a125e0608');
  assert.notEqual(dependency.sourceTree,dependency.walletAuthPackageTree);
  assert.match(dependency.treeBinding,/complete accepted source-commit tree/);
});

test('Finance evaluates the accepted migration-evidence gate without promoting source-only proof',()=>{
  const authority=migrationEvidence.evaluatorAuthority;
  assert.equal(authority.sourceCommit,'e8125d56f8c28efbfa0f87c673717c620ca023e7');
  assert.equal(authority.sourceTree,'3e22e2854912eaec6f9f464e35d8c281f0957306');
  assert.equal(authority.rootExport,'evaluateProductWalletMigrationEvidence');
  assert.equal(authority.blob,'c0ba159099c3040df9f4c2a25cef79cbcbf7cc08');
  assert.equal(authority.blobSha256,'dac1e57bf989e5ad9e63c568df3c2eb9af7b154501b21f7cf182194a35af694e');
  assert.equal(authority.vendoredArchive,'web/vendor/ynx-chain-wallet-auth-1.0.0-product-migration-evidence-p0.tgz');
  assert.equal(authority.vendoredArchiveSha256,'8ae596ab4099123b55d273698704bfe1150e571328b08dd6e50dd8bb3d658d6e');
  assert.equal(migrationEvidence.input.ownerSource.commit,'7bbfe305c08bf3b3dfad3121352e6f74fc3d7c3b');
  assert.equal(migrationEvidence.input.ownerSource.tree,'bce39d8c8e8bdc87c85a3df8942c1a62010842c1');
  assert.deepEqual(evaluateProductWalletMigrationEvidence(migrationEvidence.input),migrationEvidence.expected);
  assert.equal(migrationEvidence.expected.productsConnected,0);
  assert.equal(migrationEvidence.expected.migratedV2,false);
});

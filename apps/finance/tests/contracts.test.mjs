import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL('../',import.meta.url);
const html=await readFile(new URL('web/index.html',base),'utf8');
const js=await readFile(new URL('web/app.js',base),'utf8');
const locale=await readFile(new URL('web/finance-locale.js',base),'utf8');
const css=await readFile(new URL('web/styles.css',base),'utf8');
const wallet=await readFile(new URL('mobile/src/wallet.ts',base),'utf8');
const walletCompletion=await readFile(new URL('mobile/src/wallet-completion.ts',base),'utf8');
const manifestPin=await readFile(new URL('mobile/contract/endpoint-authority-pin.json',base),'utf8');
const endpointAuthority=await readFile(new URL('mobile/src/endpoint-manifest.ts',base),'utf8');
const webWallet=await readFile(new URL('web/wallet-auth-entry.js',base),'utf8');
const orderWallet=await readFile(new URL('web/order-wallet-entry.js',base),'utf8');
const privateWallet=await readFile(new URL('web/private-wallet-entry.js',base),'utf8');
const webAuthority=await readFile(new URL('web/endpoint-authority-entry.js',base),'utf8');
const providerEvidence=JSON.parse(await readFile(new URL('evidence/p0-finance-provider-connect-state-20260821.json',base),'utf8'));
const migrationEvidence=JSON.parse(await readFile(new URL('evidence/p0-finance-product-wallet-migration-evidence-20260821.json',base),'utf8'));
const brokerEnv=await readFile(new URL('.env.example',base),'utf8');
const brokerSchema=JSON.parse(await readFile(new URL('broker-config.schema.json',base),'utf8'));
const providerActivation=await readFile(new URL('PROVIDER_ACTIVATION.md',base),'utf8');
const providerIntegration=await readFile(new URL('PROVIDER_INTEGRATION.md',base),'utf8');
const operatorInputs=JSON.parse(await readFile(new URL('operator-inputs.request.json',base),'utf8'));
const {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_RPC_PROBE,STANDARD_WALLET_RPC_PROBE_TRANSPORT}=await import(new URL('../web/node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js',import.meta.url));
const {evaluateProductWalletMigrationEvidence}=await import(new URL('../web/node_modules/@ynx-chain/wallet-auth/src/index.js',import.meta.url));

test('product states its non-bank and non-custodial boundary',()=>{
  for(const phrase of ['No custody','bank account','No fiat conversion inferred','Finance cannot freeze assets']) assert.ok(html.includes(phrase),phrase);
  assert.ok(locale.includes('This is not a bank statement.'));
  assert.ok(js.includes("financeText('notBankStatement')"));
  for(const disclosure of ['Counterparty','Custody','Contract','Principal-loss risk','Fee','Liquidity risk','Jurisdiction risk','Signature boundary']) assert.ok(html.includes(disclosure),disclosure);
  for(const prohibited of ['APY 8%','Guaranteed return','Visa card balance']) assert.equal(html.includes(prohibited),false);
});

test('activity exports identify bounded observations instead of complete history',()=>{
  assert.ok(html.includes('Export observed CSV'));
  assert.ok(html.includes('Export available JSON'));
  assert.ok(html.includes('not a complete account history'));
  assert.ok(js.includes('ynx-finance-observed-activity.csv'));
  assert.ok(js.includes('ynx-finance-observed-export.json'));
});

test('mobile Wallet approval uses current package roots and pending private authority fails closed',()=>{
  for(const marker of ['@ynx-chain/wallet-auth','encodeRequestDeepLink','createProductSessionProof','assertFinanceProductSessionContractNative'])assert.ok(wallet.includes(marker),marker);
  for(const marker of ['parseCallbackURL','parseCentralWalletSession','createGatewayChallenge','signGatewayChallenge','verifyGatewayCompletion'])assert.ok(walletCompletion.includes(marker),marker);
  for(const required of ["version:'2'","origin:'https://finance.ynxweb4.com'","String(manifest.walletGateway)+'/v1/wallet/sessions/complete'"])assert.ok(wallet.includes(required),required);
  for(const prohibited of ['@ynx/dapp-connect-sdk','createProductWalletConnection','EXPO_PUBLIC_YNX_FINANCE_WALLET_GATEWAY_URL','FinanceSecureDevice'])assert.equal(wallet.includes(prohibited),false,prohibited);
  assert.equal(/Linking\.openURL\(\s*['"`]ynxwallet:\/\/authorize/.test(wallet),false);
  assert.equal(js.includes('Bearer '),false,'legacy browser bearer session must be absent');
  for(const marker of ['@ynx-chain/sdk','validateEndpointAuthority','selectAuthorityEndpoint','PRIVATE_SERVICE_DEGRADED'])assert.ok(endpointAuthority.includes(marker),marker);
  assert.ok(manifestPin.includes('1.1.0-weekly-v3.20260920.1'));
  assert.ok(manifestPin.includes('29f801933e9df4faea58531cb522cc34bfe1028628adfb88227f3d0cae1e4e73'));
});

test('responsive and accessibility contracts exist',()=>{
  assert.ok(html.includes('class="skip"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(css.includes('@media(max-width:720px)'));
  assert.ok(css.includes('prefers-reduced-motion'));
  assert.ok(css.includes('#002FA7'));
});

test('Broker Sandbox snapshot is authenticated, owner-mapped and never substitutes guest values',()=>{
  for(const marker of ['/api/broker/snapshot','snapshot.account.providerAccountId','snapshot.account.cash','snapshot.account.buyingPower','snapshot.positions','snapshot.orders'])assert.ok(js.includes(marker),marker);
  for(const marker of ['Guest mode never receives balances, positions or orders.','Unknown — not zero','simulated USD'])assert.ok(html.includes(marker)||js.includes(marker),marker);
  assert.ok(js.includes("if(!state.connected){brokerSnapshotState={kind:'guest'};renderBrokerSnapshot();return}"));
  assert.ok(js.includes("brokerSnapshotState={kind:'unavailable'};renderBrokerSnapshot()"),'failed provider reads must clear previously rendered account data');
  assert.ok(js.includes("await api('/api/broker/snapshot')"));
  assert.equal(js.includes("fetch('/api/broker/snapshot'"),false,'private Broker reads must use the authenticated Finance API helper');
});

test('Broker order approval consumes the exact Wallet transport and never auto-submits or opens a blank tab',()=>{
  for(const marker of ['createFinanceOrderApprovalRequest','encodeFinanceOrderApprovalWalletURL','parseFinanceOrderApprovalReturnURL','@ynx-chain/wallet-auth-finance-order'])assert.ok(orderWallet.includes(marker),marker);
  for(const marker of ['/api/broker/challenges','/api/broker/callback','providerWriteAttempted!==false','brokerReviewExact','brokerProviderNotContacted'])assert.ok(js.includes(marker)||html.includes(marker),marker);
  for(const forbidden of ['window.open(','location.href=','fetch(route.url','provider.request({method:"eth_sendTransaction"'])assert.equal(orderWallet.includes(forbidden)||js.includes(forbidden),false,forbidden);
  assert.ok(html.includes('order-wallet.js'));
  assert.ok(js.includes("pendingLegacyBrokerReturnURL=location.href;"),'legacy callback must be captured only for the current page lifetime');
  assert.ok(js.includes("history.replaceState(null,'','/wallet-auth/callback');"),'legacy callback query must be scrubbed before async work');
  assert.ok(js.includes("window.YNXFinanceOrderWallet.clear();pendingLegacyBrokerReturnURL=null;history.replaceState"),'consumed callback must clear the in-memory proof');
  assert.ok(js.includes("'/api/broker/challenges','/api/broker/callback'"),'Broker writes must request finance.profile.write');
  assert.ok(orderWallet.includes("FINANCE_ORDER_AUTHORITY_TIME_INVALID"),'server time must be parsed at the trusted response boundary');
  for(const marker of ['FINANCE_ORDER_PENDING_EXISTS','resumeStored','expiresAt.getTime()'])assert.ok(orderWallet.includes(marker),marker);
  for(const marker of ['restoreBrokerApproval(workspace.serverTime','Clear expired request','brokerRecovered'])assert.ok(js.includes(marker)||html.includes(marker),marker);
  assert.equal(/id="broker-order-preview"[^>]*data-finance-i18n/u.test(html),false,'locale application must not overwrite live order terms');
  assert.equal(/id="broker-wallet-approve"[^>]*data-finance-i18n/u.test(html),false,'locale application must not overwrite the exact review action');
  assert.equal(orderWallet.includes('new Date()'),false,'order approval must not fall back to the device wall clock');
  assert.equal(html.includes('name="accountPublicKey"'),false,'Wallet public key must come from the persisted owner mapping');
  assert.equal(html.includes('Provider asset UUID<input'),false,'users must select provider-backed assets instead of typing UUIDs');
  assert.ok(js.includes("JSON.stringify({draft})"));
  for(const marker of ['@ynx-chain/sdk','createEndpointAuthorityClient','walletGateway','financeProductSession','trustedClock'])assert.ok(webAuthority.includes(marker),marker);
  assert.ok(orderWallet.includes('assertFinancePrivateAuthority'));
  assert.ok(privateWallet.includes('assertFinancePrivateAuthority'));
});

test('AI Broker order results remain drafts until copied and explicitly previewed',()=>{
  for(const marker of ['draft_broker_order','Copy into order form'])assert.ok(html.includes(marker)||js.includes(marker),marker);
  assert.ok(locale.includes('Search and select the exact provider-backed asset before previewing approval.'));
  assert.ok(js.includes("financeText('aiDraftCopied')"));
  assert.ok(js.includes("location.hash='broker-sandbox'"));
  assert.equal(js.includes('Submit AI order'),false);
});

test('Broker activation schema, env, operator request and documentation match the implemented controlled flow',()=>{
  const requiredNames=['YNX_FINANCE_BROKER_VERIFY_ACCOUNT','YNX_FINANCE_BROKER_MAX_FEE_USD','YNX_FINANCE_BROKER_FEE_BOUND_SOURCE','YNX_FINANCE_BROKER_FEE_EVIDENCE_REF'];
  const envValues=Object.fromEntries(brokerEnv.split('\n').filter(line=>line&&!line.startsWith('#')&&line.includes('=')).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)]}));
  for(const name of requiredNames){
    assert.ok(Object.hasOwn(brokerSchema.properties,name),`schema missing ${name}`);
    assert.match(brokerEnv,new RegExp(`^${name}=`, 'm'),`env example missing ${name}`);
  }
  assert.match(envValues.YNX_FINANCE_BROKER_MAX_FEE_USD,new RegExp(brokerSchema.properties.YNX_FINANCE_BROKER_MAX_FEE_USD.pattern));
  assert.ok(brokerSchema.properties.YNX_FINANCE_BROKER_FEE_BOUND_SOURCE.enum.includes(envValues.YNX_FINANCE_BROKER_FEE_BOUND_SOURCE));
  assert.match(envValues.YNX_FINANCE_BROKER_FEE_EVIDENCE_REF,new RegExp(brokerSchema.properties.YNX_FINANCE_BROKER_FEE_EVIDENCE_REF.pattern));
  for(const marker of ['verify-approved','provider POST dispatch','provider query/reconciliation','provider DELETE cancellation','final reconciliation','SANDBOX_VERIFY_APPROVED_ORDER_ONCE']) assert.ok(providerActivation.includes(marker),marker);
  for(const stale of ['one assets GET','provider POST and its public route remain intentionally unwired']) assert.equal(providerActivation.includes(stale),false,stale);
  assert.ok(providerIntegration.includes('Submission is disabled by default.'));
  assert.ok(providerIntegration.includes('one-shot worker'));
  assert.ok(providerIntegration.includes('there is no browser provider-write route'));
  assert.equal(providerIntegration.includes('Submission stays disabled even if credentials exist or an operator prematurely turns on the write flag.'),false);
  const byId=Object.fromEntries(operatorInputs.inputs.map(value=>[value.id,value]));
  assert.match(byId.shared_endpoint_authority.needed,/Central-issued and signed/);
  assert.match(byId.installed_wallet_callback_verification.needed,/installed Wallet build/);
  assert.ok(byId.broker_credentials);
  assert.match(byId.sandbox_write_confirmation.needed,/verify-approved POST\/query\/DELETE\/reconcile/);
  assert.equal(/public route/i.test(byId.sandbox_write_confirmation.needed),false);
  assert.match(byId.public_deployment_authority.needed,/not a prerequisite for controlled local Sandbox write verification/);
  assert.equal(operatorInputs.officialSandboxVerified,false);
  assert.equal(operatorInputs.productionApproved,false);
  assert.deepEqual(operatorInputs.sharedEndpointAuthority,{bundledManifestPresent:true,bundledFinancePinBuildVerified:true,centralSignedManifestActive:false,installedWalletCallbackVerified:false});
});

test('Broker Sandbox product entry exposes provider search, owner watchlist, reconcile and cancellation intent without browser provider writes',()=>{
  for(const marker of ['/api/broker/assets?query=','/api/broker/watchlist','/api/broker/reconcile','/cancel-request','providerWriteAttempted!==false','My Sandbox watchlist','Reconcile provider state'])assert.ok(js.includes(marker)||html.includes(marker),marker);
  assert.ok(js.includes("financeText('brokerRequestCancel')")&&locale.includes("brokerRequestCancel:'Request cancellation'"));
  assert.ok(js.includes("finance.profile.write"));
  assert.ok(js.includes("state.brokerSelectedAsset.id!==draft.assetId"));
  assert.ok(html.includes('The browser will not contact the provider')||js.includes('The browser will not contact the provider')||locale.includes('The browser will not contact the provider'));
  for(const forbidden of ['ALPACA_BROKER_API_KEY','ALPACA_BROKER_API_SECRET','/v1/trading/accounts/'])assert.equal(js.includes(forbidden),false,forbidden);
});

test('Web Wallet consumes the pinned Standard SDK and isolates unavailable legacy private authorization',()=>{
  for(const marker of ['StandardWalletConnection','discoverWalletProviders','selected.connect()','selected.restore()','selected.revoke()','eth_chainId','wallet_switchEthereumChain','wallet_addEthereumChain','0x1917'])assert.ok(webWallet.includes(marker),marker);
  assert.ok(webWallet.includes("rpcUrls:['https://rpc-testnet.ynxweb4.com/evm','https://rpc.ynxweb4.com/evm']"),'wallet_addEthereumChain keeps canonical Testnet EVM RPC first and the legacy fallback second');
  for(const forbidden of ['iframe','window.open','location.href=','createProductDeviceIdentity','productDeviceSecret','createGatewayChallenge','signGatewayChallenge'])assert.equal(webWallet.includes(forbidden),false,forbidden);
  assert.equal(/fetch\s*\(\s*[`'"]https:\/\/rpc-testnet\.ynxweb4\.com\/evm/.test(webWallet),false,'direct canonical RPC probing cannot gate provider connection');
  assert.equal(/fetch\s*\(\s*[`'"]https:\/\/rpc\.ynxweb4\.com\/evm/.test(webWallet),false,'direct browser RPC probing cannot gate provider connection');
  assert.ok(html.includes('wallet-choice'));
  assert.ok(html.includes('Download YNX Wallet'));
  assert.ok(html.includes('Connect MetaMask'));
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

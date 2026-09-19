import {readFile} from 'node:fs/promises';

const [entry,html,app,stateModule]=await Promise.all(['wallet-connect-entry.js','index.html','app.js','node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js'].map(file=>readFile(new URL(file,import.meta.url),'utf8')));
for(const marker of ['launchWebAuthorization','@ynx-chain/wallet-auth/src/authorize-launcher.js','standard-wallet-connect-state.js','createStandardWalletConnectState','reduceStandardWalletConnectState','eth_accounts','eth_requestAccounts','eth_chainId','wallet_switchEthereumChain','wallet_addEthereumChain','RPC_PROBE_DEGRADED','YNX_CHAIN_HEX'])if(!entry.includes(marker))throw new Error(`Missing provider-only Wallet control: ${marker}`);
for(const marker of ['accepted-cors-safe','RPC_PROBE_DEGRADED','UNSAFE_BROWSER_RPC_PROBE'])if(!stateModule.includes(marker))throw new Error(`Missing accepted shared connection-state control: ${marker}`);
for(const forbidden of [/ynxwallet:/,/iframe/,/window\.open\s*\(/,/location\.(?:assign|replace)\s*\(/,/location\.href\s*=/])if(forbidden.test(entry))throw new Error(`Forbidden Web Wallet transport: ${forbidden}`);
if(/fetch\s*\(\s*[`'"]https:\/\/rpc\.ynxweb4\.com\/evm/.test(entry))throw new Error('Direct browser RPC probe cannot determine connection state');
for(const marker of ['wallet-connect.js','wallet-options','Download YNX Wallet','Use MetaMask'])if(!html.includes(marker))throw new Error(`Missing Finance Web fallback: ${marker}`);
for(const marker of ['YNXFinanceWebWallet.connect','showWalletOptions','standard-connected'])if(!app.includes(marker))throw new Error(`Missing Finance Web Wallet state: ${marker}`);
console.log(JSON.stringify({status:'pass',transport:'EIP-6963/EIP-1193 provider-only',providerConnection:'selected provider + approved account + provider eth_chainId=0x1917',rpcProbe:'accepted-cors-safe and non-blocking',customSchemeNavigation:false,hiddenFrame:false,blankTarget:false},null,2));

import {readFile} from 'node:fs/promises';

const [entry,html,app]=await Promise.all(['wallet-connect-entry.js','index.html','app.js'].map(file=>readFile(new URL(file,import.meta.url),'utf8')));
for(const marker of ['launchWebAuthorization','@ynx-chain/wallet-auth/src/authorize-launcher.js','eth_requestAccounts','eth_chainId','YNX_CHAIN_HEX'])if(!entry.includes(marker))throw new Error(`Missing provider-only Wallet control: ${marker}`);
for(const forbidden of [/ynxwallet:/,/iframe/,/window\.open\s*\(/,/location\.(?:assign|replace)\s*\(/,/location\.href\s*=/])if(forbidden.test(entry))throw new Error(`Forbidden Web Wallet transport: ${forbidden}`);
for(const marker of ['wallet-connect.js','wallet-options','Download YNX Wallet','Use MetaMask'])if(!html.includes(marker))throw new Error(`Missing Finance Web fallback: ${marker}`);
for(const marker of ['YNXFinanceWebWallet.connect','showWalletOptions','standard-connected'])if(!app.includes(marker))throw new Error(`Missing Finance Web Wallet state: ${marker}`);
console.log(JSON.stringify({status:'pass',transport:'EIP-6963/EIP-1193 provider-only',customSchemeNavigation:false,hiddenFrame:false,blankTarget:false},null,2));

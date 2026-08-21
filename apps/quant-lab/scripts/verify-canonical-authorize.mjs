import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const files=['web/wallet-auth-entry.js','web/product-session-registry.js','web/index.html'];
const source=await Promise.all(files.map(async file=>[file,await readFile(resolve(root,file),'utf8')]));
const prohibited=[/ynxwallet:\/\/authorize(?!\?request=)/, /location\.assign\(/, /location\.href\s*=/, /encodeRequestDeepLink\(/, /createProductWalletConnection/, /PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN/];
for(const [file,text] of source)for(const pattern of prohibited)if(pattern.test(text))throw new Error(`Canonical authorization policy violation in ${file}: ${pattern}`);
const wallet=source.find(([file])=>file==='web/wallet-auth-entry.js')[1];
for(const marker of ['launchWebAuthorization','parseAuthorizationCallbackURL','writePending(request)','eth_requestAccounts'])if(!wallet.includes(marker))throw new Error(`Missing canonical authorization control: ${marker}`);
console.log(JSON.stringify({status:'pass',files,canonicalLauncher:true,manualUri:false,topLevelSchemeNavigation:false},null,2));

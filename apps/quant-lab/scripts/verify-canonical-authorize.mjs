import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const files=['web/wallet-auth-entry.js','web/private-session.js','web/product-session-registry.js','web/index.html'];
const source=await Promise.all(files.map(async file=>[file,await readFile(resolve(root,file),'utf8')]));
const prohibited=[/ynxwallet:\/\/authorize(?!\?request=)/, /location\.assign\(/, /location\.href\s*=/, /encodeRequestDeepLink\(/, /createProductWalletConnection/, /PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN/];
for(const [file,text] of source)for(const pattern of prohibited)if(pattern.test(text))throw new Error(`Canonical authorization policy violation in ${file}: ${pattern}`);
const wallet=source.find(([file])=>file==='web/wallet-auth-entry.js')[1];
const hosted=await readFile(resolve(root,'../../packages/wallet-auth/src/vendor/hosted-wallet-adapter-4bccefef.js'));
if(hosted.length!==12659||createHash('sha256').update(hosted).digest('hex')!=='2567f4ec0958852ef27ee382067b6b104e33fe5dc3feba3aa94d710caa7f2c0a')throw new Error('Accepted Hosted adapter identity mismatch');
for(const marker of ['StandardWalletConnection','discoverWalletProviders','connection.connect()','connection.restore()','connection.revoke()','createHostedWalletAdapter','hosted-wallet-adapter-4bccefef.js','mountPrivateSession','createStandardWalletConnectState','reduceStandardWalletConnectState','STANDARD_WALLET_RPC_PROBE_TRANSPORT'])if(!wallet.includes(marker))throw new Error(`Missing canonical authorization control: ${marker}`);
const privateSource=source.find(([file])=>file==='web/private-session.js')[1];
for(const marker of ['createBrowserProductSessionClient','ProductSessionGatewayFetchAdapter','client.beginExplicit()','client.handleReturn(url)','handlePrivateReturn(location.href)','client.restore(','createIntrospectionProof','client.disconnect()','walletInstalled:()=>false','schemeRegistered:()=>false','product-session-browser-a7dad7ec.mjs'])if(!privateSource.includes(marker))throw new Error(`Missing private session control: ${marker}`);
for(const forbidden of ['window.open','<iframe','eth_requestAccounts','eth_sendTransaction','personal_sign'])if(privateSource.includes(forbidden))throw new Error(`Private Session may not invoke ${forbidden}`);
if(/\bfetch\s*\(/.test(wallet))throw new Error('Browser RPC fetch is not allowed as a Standard Wallet connection precondition');
console.log(JSON.stringify({status:'pass',files,sharedStandardRuntime:true,manualUri:false,automaticSchemeNavigation:false,explicitSDKOpenLink:true,installationVerified:false,sharedConnectState:true,noBrowserRpcProbe:true},null,2));

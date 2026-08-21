import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const appRoot=fileURLToPath(new URL('..',import.meta.url)),sourceRoot=join(appRoot,'src'),files=[join(appRoot,'App.tsx')],packageFile=join(appRoot,'package.json');
async function collect(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isDirectory())await collect(file);else if(/\.(?:ts|tsx)$/.test(entry.name)&&!entry.name.endsWith('.test.ts'))files.push(file)}}
await collect(sourceRoot);
const sources=await Promise.all(files.map(async file=>[file,await readFile(file,'utf8')]));
const joined=sources.map(([,source])=>source).join('\n');
const packageJSON=JSON.parse(await readFile(packageFile,'utf8'));
for(const required of ['launchCanonicalAuthorization','parseAuthorizationCallbackURL','CANONICAL_AUTHORIZATION_PENDING_KEY','connectMetaMaskWallet','fallbackActions'])if(!joined.includes(required))throw new Error(`Pay canonical Wallet authorization is missing ${required}`);
if(packageJSON.dependencies?.['@ynx-chain/wallet-auth']!=='file:vendor/ynx-chain-wallet-auth-1.1.0-safe-launcher-v2.tgz')throw new Error('Pay is not pinned to the accepted safeWalletAuthorizeLauncher v2 package');
for(const [file,source] of sources){
  if(/(?:Linking\.)?openURL\(\s*['\"`]ynxwallet:\/\/authorize(?:['\"`]|\s*\+)/.test(source)||/ynxwallet:\/\/authorize\?\s*['\"`+]/.test(source))throw new Error(`Naked or manually composed Wallet authorization route found in ${file}`);
  if(/(?:window\.open|<iframe|document\.location\s*=|location\.href\s*=)\s*\(?\s*['\"`]ynxwallet:\/\/authorize/.test(source))throw new Error(`Forbidden Web authorization navigation found in ${file}`);
}
console.log(`canonical-authorize: scanned ${files.length} Pay source files; accepted v2 root launcher and no naked/manual or Web authorization navigation found`);

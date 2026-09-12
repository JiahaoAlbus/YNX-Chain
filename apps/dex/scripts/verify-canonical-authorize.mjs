import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot=fileURLToPath(new URL('..',import.meta.url));
const root=join(appRoot,'src'),files=[];
async function collect(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const file=join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='fixtures')await collect(file);}
    else if(/\.(ts|tsx|mjs)$/.test(entry.name)&&!entry.name.includes('.test.')&&!/\.d\.(ts|mts)$/.test(entry.name))files.push(file);
  }
}
await collect(root);
const sources=await Promise.all(files.map(async file=>[file,await readFile(file,'utf8')]));
const joined=sources.map(([,value])=>value).join('\n');
const wallet=await readFile(join(root,'wallet.ts'),'utf8');
const manifest=JSON.parse(await readFile(join(root,'vendor/browser-manifest.json'),'utf8'));
const artifact=await readFile(join(root,'vendor/standard-wallet-browser.mjs'));
if(manifest.sourceCommit!=='c97f85e9ae4d4580b99860c51738e6040ca9ca18'||manifest.sourceTree!=='28a660bbe1451f0d5e20d6eb08da17eef0970d77'||manifest.imports.length!==0||manifest.inputs.length!==7)throw new Error('DEX fixed Standard SDK source closure mismatch');
if(artifact.length!==22417||createHash('sha256').update(artifact).digest('hex')!=='b8a900ef2a5ece693cb2808a47ed0072d97c425236deb80c39497886f1535e43')throw new Error('DEX fixed Standard SDK bytes mismatch');
for(const marker of ['new StandardWalletConnection','discoverWalletProviders','entry.client.connect()','entry.client.restore()','entry.client.revoke()','createStandardWalletConnectState','reduceStandardWalletConnectState','RPC_PROBE_DEGRADED',"chainId:'0x1917'",'wallet_switchEthereumChain','wallet_addEthereumChain'])if(!wallet.includes(marker))throw new Error('DEX Standard Wallet consumer lacks '+marker);
if(/provider\.request\s*\(/.test(wallet))throw new Error('DEX product must use fixed shared Standard SDK, not hand-written provider transport');
const packageJSON=JSON.parse(await readFile(join(appRoot,'package.json'),'utf8'));
if(packageJSON.dependencies?.['@ynx-chain/wallet-auth']!=='file:vendor/ynx-chain-wallet-auth-1.1.0-provider-connect-state-p0.tgz')throw new Error('DEX UI projection compatibility package changed without review');
if(/fetch\s*\(\s*['"]https:\/\/rpc\.ynxweb4\.com\/evm/.test(joined))throw new Error('Direct browser RPC must not be a Standard connection prerequisite');
if(/\b9102\b|0x238e/i.test(joined))throw new Error('Forbidden legacy chain reference');
for(const [file,value] of sources) {
  let executable=value;
  if(file===join(root,'vendor/application-actions-browser.mjs')){
    // The exact shared native-action bundle contains this registry validator
    // diagnostic, not a Web launch. Exempt only that one exact diagnostic after
    // byte identity verification; all other code remains scanned unchanged.
    const bytes=Buffer.from(value),diagnostic='fail("INVALID_ROUTER_REGISTRY", "Wallet authorize callback must be ynxwallet://authorize");';
    if(bytes.length!==110477||createHash('sha256').update(bytes).digest('hex')!=='627d7c57e15bfc3a92c77fb58d11c2bdb0e54f8f20c5989d51091163b71f5d0f'||value.split(diagnostic).length!==2)throw new Error('Native SDK diagnostic exception requires exact Wallet-owner bytes');
    executable=value.replace(diagnostic,'');
  }
  if(/ynxwallet:\/\/authorize|(?:window\.open|<iframe|document\.location\s*=|location\.href\s*=)\s*\(?\s*['"]ynxwallet/.test(executable))throw new Error('Forbidden Web Wallet authorization route in '+file);
}
console.log('canonical-authorize: '+files.length+' source files; fixed c97f85e9 SDK bytes/7-input closure, provider-only connect/restore/revoke, 6423 add/switch and private-service separation gates PASS (source-only)');

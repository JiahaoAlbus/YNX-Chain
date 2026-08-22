import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../src/',import.meta.url)),files=[];
async function collect(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isDirectory())await collect(file);else if(/\.(?:ts|tsx)$/.test(entry.name)&&!entry.name.endsWith('.test.ts'))files.push(file)}}
await collect(root);
const sources=await Promise.all(files.map(async file=>[file,await readFile(file,'utf8')]));
const joined=sources.map(([,source])=>source).join('\n');
for(const required of ['encodeRequestDeepLink','parseAuthorizationCallbackURL','CANONICAL_AUTHORIZATION_PENDING_KEY','connectMetaMaskWallet'])if(!joined.includes(required))throw new Error(`Exchange canonical Wallet authorization is missing ${required}`);
for(const [file,source] of sources){
  if(/(?:Linking\.)?openURL\(\s*['"`]ynxwallet:\/\/authorize(?:['"`]|\s*\+)/.test(source)||/ynxwallet:\/\/authorize\?\s*['"`+]/.test(source))throw new Error(`Naked or manually composed Wallet authorization route found in ${file}`);
}
console.log(`canonical-authorize: scanned ${files.length} Exchange source files; no naked/manual Wallet authorization launcher found`);

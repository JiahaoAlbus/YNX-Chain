import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceRoot=fileURLToPath(new URL('../src/',import.meta.url));
const files=[];
async function collect(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())await collect(path);
    else if(/\.(?:ts|tsx)$/.test(entry.name)&&!entry.name.endsWith('.test.ts'))files.push(path);
  }
}
await collect(sourceRoot);
const content=await Promise.all(files.map(async path=>[path,await readFile(path,'utf8')]));
const joined=content.map(([,value])=>value).join('\n');
for(const required of ['encodeRequestDeepLink','parseAuthorizationCallbackURL','CANONICAL_AUTHORIZATION_PENDING_KEY']){
  if(!joined.includes(required))throw new Error(`Finance canonical Wallet authorization is missing ${required}`);
}
const prohibited=[
  /(?:Linking\.)?openURL\(\s*['"`]ynxwallet:\/\/authorize(?:['"`]|\s*\+)/,
  /ynxwallet:\/\/authorize\?\s*['"`+]/,
];
for(const [path,value] of content)for(const pattern of prohibited){
  if(pattern.test(value))throw new Error(`Naked or manually composed Wallet authorization route found in ${path}`);
}
console.log(`canonical-authorize: scanned ${files.length} Finance source files; no naked/manual Wallet authorization launcher found`);

import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Independent App-only Auth R109 supply. The unchanged SDK329/NAPI receipt
// continues to describe its own original inventory, including the old holder.
// No files in that sealed root are replaced by this branch.
export const identityAppCustodyPins=Object.freeze([
  Object.freeze({path:'packages/wallet-auth/native/original-ide-identity-launch-holder.h',bytes:2258,sha256:'384d6a853f770cb7465b6d1bd31bd120182fc6b70a7c6761b6a9a55967af8a83'}),
  Object.freeze({path:'packages/wallet-auth/native/original-ide-identity-launch-holder.mm',bytes:17767,sha256:'dc80607b533ffb0659e2fb5d0044345a6ff93209e01a9ed9c2d542638a4fc1df'}),
]);
export async function verifyIdentityAppCustodySource(root=process.env.YNX_DEVELOPER_CANONICAL_APP_NATIVE_ROOT){
  if(typeof root!=='string'||resolve(root)!==root)throw Error('Exact App-only custody source root required.');
  for(const relative of ['', 'packages','packages/wallet-auth','packages/wallet-auth/native']){
    const stat=await lstat(join(root,relative));
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Regular App-only custody source directories required.');
  }
  for(const pin of identityAppCustodyPins){
    const file=join(root,pin.path),stat=await lstat(file),raw=await readFile(file);
    if(!stat.isFile()||stat.isSymbolicLink()||raw.length!==pin.bytes||createHash('sha256').update(raw).digest('hex')!==pin.sha256)
      throw Error('App-only custody source differs: '+pin.path);
  }
  return Object.freeze({root,source:identityAppCustodyPins,nativeQualified:false,registrationAccepted:false});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log((await verifyIdentityAppCustodySource()).root);

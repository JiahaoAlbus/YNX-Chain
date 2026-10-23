import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {collectWalletConnectRuntimeClosure,verifyWalletConnectRuntimeClosure} from '../scripts/walletconnect-runtime-closure.mjs';
function fixture(){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ynx-wc-closure-'));const packages={};
 function pkg(path,name,version,dependencies={}){mkdirSync(join(root,path),{recursive:true});writeFileSync(join(root,path,'package.json'),JSON.stringify({name,version,dependencies}));writeFileSync(join(root,path,'index.js'),'export default 1;');if(path)packages[path]={version,dependencies};}
 pkg('','@ynx-chain/wallet-auth','test',{'@walletconnect/sign-client':'2.23.10','@noble/hashes':'2.2.0'});
 pkg('node_modules/@walletconnect/sign-client','@walletconnect/sign-client','2.23.10',{'@walletconnect/core':'2.23.10','@noble/hashes':'1.8.0'});
 pkg('node_modules/@walletconnect/core','@walletconnect/core','2.23.10');
 pkg('node_modules/@noble/hashes','@noble/hashes','2.2.0');
 pkg('node_modules/@walletconnect/sign-client/node_modules/@noble/hashes','@noble/hashes','1.8.0');
 pkg('node_modules/typescript','typescript','5.9.3');packages['node_modules/typescript'].dev=true;
 mkdirSync(join(root,'src'));writeFileSync(join(root,'src/walletconnect-dapp-connection.js'),'export const available=true;');
 writeFileSync(join(root,'node_modules/.package-lock.json'),JSON.stringify({lockfileVersion:3,packages}));
 return {root,dispose:()=>rmSync(root,{recursive:true,force:true})};
}
test('missing WalletConnect dependency fails before supplying a partial runtime',()=>{const f=fixture();try{rmSync(join(f.root,'node_modules/@walletconnect/core'),{recursive:true});assert.throws(()=>collectWalletConnectRuntimeClosure(f.root),/WC_RUNTIME_DEPENDENCY_MISSING/);}finally{f.dispose();}});
test('resolution never falls back to an ancestor node_modules',()=>{const f=fixture();try{const child=join(f.root,'child');mkdirSync(join(child,'node_modules'),{recursive:true});writeFileSync(join(child,'package.json'),JSON.stringify({dependencies:{'@walletconnect/core':'2.23.10'}}));writeFileSync(join(child,'node_modules/.package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{}}));assert.throws(()=>collectWalletConnectRuntimeClosure(child),/WC_RUNTIME_DEPENDENCY_MISSING/);}finally{f.dispose();}});
test('symlink package and symlink resources cannot leave the supplied runtime',()=>{const f=fixture();try{symlinkSync('/etc/hosts',join(f.root,'node_modules/@walletconnect/core/escape'));assert.throws(()=>collectWalletConnectRuntimeClosure(f.root),/WC_RUNTIME_SYMLINK/);}finally{f.dispose();}});
test('preserves nested noble versions and rejects an incomplete nested installation',()=>{const f=fixture();try{const result=collectWalletConnectRuntimeClosure(f.root);assert.equal(result.packages.find(p=>p.path==='node_modules/@walletconnect/sign-client/node_modules/@noble/hashes').version,'1.8.0');assert.equal(result.packages.find(p=>p.path==='node_modules/@noble/hashes').version,'2.2.0');assert(!result.files.some(f=>f.path.includes('typescript')));rmSync(join(f.root,'node_modules/@walletconnect/sign-client/node_modules/@noble/hashes'),{recursive:true});assert.throws(()=>collectWalletConnectRuntimeClosure(f.root),/WC_RUNTIME_VERSION_MISMATCH/);}finally{f.dispose();}});

test('normal verification refuses a changed file rather than trusting old inventory',()=>{const f=fixture();try{const original=collectWalletConnectRuntimeClosure(f.root);writeFileSync(join(f.root,'node_modules/@walletconnect/core/index.js'),'changed');assert.throws(()=>verifyWalletConnectRuntimeClosure(f.root,original),/WC_RUNTIME_MANIFEST_MISMATCH/);}finally{f.dispose();}});

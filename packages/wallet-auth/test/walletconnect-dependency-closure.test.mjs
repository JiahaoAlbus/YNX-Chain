// Real locked SDK import: catches incompatible noble transitive overrides.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {SignClient} from '@walletconnect/sign-client';
import {isValidRequiredNamespaces} from '@walletconnect/utils';
const require=createRequire(import.meta.url);
function version(resolver,name,leaf){
 const entry=resolver.resolve(`@noble/${name}/${leaf}.js`);
 return JSON.parse(readFileSync(join(dirname(entry),'package.json'),'utf8')).version;
}
test('actual SignClient and its declared noble 1.x closure coexist with exact PQ 2.2.0',()=>{
 assert.equal(typeof SignClient.init,'function');
 const wc=createRequire(require.resolve('@walletconnect/utils'));
 const pq=createRequire(require.resolve('@ynx/batch-v01-candidate'));
 for(const [name,leaf,expected] of [['hashes','sha3','1.8.0'],['curves','ed25519','1.9.7'],['ciphers','chacha','1.3.0']]){
  assert.equal(version(wc,name,leaf),expected);
  assert.equal(version(pq,name,leaf),'2.2.0');
 }
 assert.equal(version(require,'hashes','sha3'),'2.2.0');
 assert.equal(version(require,'curves','ed25519'),'2.2.0');
});
test('real WalletConnect validator admits the exact address-only namespace',()=>{
 assert.equal(isValidRequiredNamespaces({eip155:{chains:['eip155:6423'],methods:[],events:['accountsChanged','chainChanged']}},'connect','requiredNamespaces'),null);
});

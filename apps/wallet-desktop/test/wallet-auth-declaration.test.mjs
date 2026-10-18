import test from 'node:test';
import assert from 'node:assert/strict';
import {walletAuthDependencyPlan,assertWalletAuthDependencyDeclarations} from '../scripts/wallet-auth-dependencies.mjs';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('actual frozen R3e declaration graph accepts exact 316 pinned files with PQ tilde declaration and fixed resolved version',()=>{
 const plan=walletAuthDependencyPlan(root,'78c39e54e0353827ea0c199b84cac4148e627bff');assert.equal(plan.rows.length,316);assert.equal(plan.public.versions['@noble/ciphers'],'2.2.0');
 assert.deepEqual(plan.public.declarations.find(row=>row.name==='@noble/ciphers'),{name:'@noble/ciphers',resolvedVersion:'2.2.0',source:'pq.dependencies',declared:'~2.2.0'});
});
function metadata(){return [JSON.parse(readFileSync(new URL('../../../packages/wallet-auth/package.json',import.meta.url))),...['@ynx/batch-v01-candidate','@noble/post-quantum'].map(name=>JSON.parse(readFileSync(new URL('../../../packages/wallet-auth/node_modules/'+name+'/package.json',import.meta.url))))];}
test('only the exact frozen PQ ciphers edge is accepted, never arbitrary semver ranges',()=>{
 for(const declared of ['^2.2.0','~2.2.1','~2.1.0','*','>=2.2.0',undefined]){const [sdk,provider,pq]=metadata();pq.dependencies['@noble/ciphers']=declared;assert.throws(()=>assertWalletAuthDependencyDeclarations({'@noble/ciphers':'2.2.0'},sdk,provider,pq),/DECLARATION_CHANGED/);}
 for(const resolved of ['2.2.1','2.3.0','2.1.0']){const [sdk,provider,pq]=metadata();assert.throws(()=>assertWalletAuthDependencyDeclarations({'@noble/ciphers':resolved},sdk,provider,pq),/DECLARATION_CHANGED/);}
});
test('indirect ciphers acceptance requires the original SDK optional peer and provider to PQ chain',()=>{
 for(const mutate of [sdk=>delete sdk.peerDependencies['@ynx/batch-v01-candidate'],sdk=>sdk.peerDependenciesMeta['@ynx/batch-v01-candidate'].optional=false,
  (_sdk,provider)=>provider.dependencies['@noble/post-quantum']='^0.6.1',(_sdk,provider)=>provider.version='0.1.0-FOREIGN',(_sdk,_provider,pq)=>pq.version='0.6.2']){
  const args=metadata();mutate(...args);assert.throws(()=>assertWalletAuthDependencyDeclarations({'@noble/ciphers':'2.2.0'},...args),/DECLARATION_CHANGED/);
 }
 const args=metadata();assert.throws(()=>assertWalletAuthDependencyDeclarations({'@noble/UNDECLARED':'2.2.0'},...args),/DECLARATION_CHANGED/);
});
test('a same-name exact declaration from an unrelated direct source cannot substitute the fixed PQ edge',()=>{
 for(const mutate of [sdk=>sdk.dependencies['@noble/ciphers']='2.2.0',sdk=>sdk.peerDependencies['@noble/ciphers']='2.2.0',(_sdk,provider)=>provider.dependencies['@noble/ciphers']='2.2.0',(_sdk,_provider,pq)=>pq.dependencies['@noble/ciphers']='2.2.0']){
  const args=metadata();mutate(...args);assert.throws(()=>assertWalletAuthDependencyDeclarations({'@noble/ciphers':'2.2.0'},...args),/DECLARATION_CHANGED/);
 }
});

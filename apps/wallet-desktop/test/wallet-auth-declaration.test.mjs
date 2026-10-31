import test from 'node:test';
import assert from 'node:assert/strict';
import {walletAuthDependencyPlan,assertWalletAuthDependencyDeclarations} from '../scripts/wallet-auth-dependencies.mjs';
import {fileURLToPath} from 'node:url';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('frozen R3e source declarations accept exact316 public bytes independently of the installed successor',t=>{
 const frozen='78c39e54e0353827ea0c199b84cac4148e627bff',fixture=realpathSync(mkdtempSync(path.join(tmpdir(),'wallet-r3e-declarations-')));
 t.after(()=>rmSync(fixture,{recursive:true,force:true}));
 const put=(name,bytes)=>{const file=path.join(fixture,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes);};
 const source=name=>execFileSync('git',['show',frozen+':'+name],{cwd:root});
 const manifestName='apps/wallet-desktop/scripts/wallet-auth-runtime-dependencies.json',manifest=JSON.parse(source(manifestName));
 put(manifestName,source(manifestName));put('packages/wallet-auth/package.json',source('packages/wallet-auth/package.json'));
 const archive=path.join(root,'packages/wallet-auth/testdata/ynx-batch-v01-candidate-0.1.0-candidate.2.tgz'),raw=readFileSync(archive);
 assert.equal(raw.length,manifest.provider.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.provider.sha256);
 for(const row of manifest.files){
  const bytes=row.path.startsWith('@ynx/batch-v01-candidate/')?execFileSync('tar',['-xOf',archive,'package/'+row.path.slice('@ynx/batch-v01-candidate/'.length)]):readFileSync(path.join(root,'packages/wallet-auth/node_modules',row.path));
  assert.equal(bytes.length,row.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);put('packages/wallet-auth/node_modules/'+row.path,bytes);
 }
 const git=(...args)=>execFileSync('git',args,{cwd:fixture,stdio:'pipe'});git('init','-q');git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','Frozen R3e public inputs');
 const plan=walletAuthDependencyPlan(fixture,'HEAD');assert.equal(plan.rows.length,316);assert.equal(plan.public.versions['@noble/ciphers'],'2.2.0');
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

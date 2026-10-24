import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {walletAuthDependencyPlan} from '../scripts/wallet-auth-dependencies.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const target=process.env.WALLET_AUTH28_APP_SOURCE_ROOT,supply=process.env.WALLET_AUTH28_APP_DEPENDENCY_SUPPLEMENT;
const manifestName='apps/wallet-desktop/scripts/wallet-auth-runtime-dependencies.json';
const original=fs.readFileSync(new URL('../scripts/wallet-auth-runtime-dependencies.json',import.meta.url));
test('existing316 App closure retains53 exact ciphers2.2 files, not ambient1.3',()=>{
 const manifest=JSON.parse(original),rows=manifest.files.filter(r=>r.path.startsWith('@noble/ciphers/'));
 assert.equal(original.length,52657);assert.equal(sha(original),'403467d07349bbaddab122f9e6e5ca600c2df5965ee96013fc5c5ab94d345106');assert.equal(manifest.files.length,316);assert.equal(rows.length,53);assert.equal(rows.reduce((n,r)=>n+r.bytes,0),726834);assert.equal(manifest.versions['@noble/ciphers'],'2.2.0');
});
test('actual263 unchanged inputs plus exact53 supplement pass original normal App dependency callee in independent DATA-only Git fixture',{skip:!target||!supply},t=>{
 const bytes=fs.readFileSync(supply);assert.equal(bytes.length,12219);assert.equal(sha(bytes),'98cf58270a338090d5170ea3bce8f13373bcd86d2ec05dd7560ef23e1ee6497b');const h=JSON.parse(bytes),manifest=JSON.parse(original);
 assert.equal(h.files.length,53);assert.deepEqual(h.full316Comparison,{exact:263,missing:53,changed:0,missingOnly:'@noble/ciphers@2.2.0'});
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-app316-public-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(relative,b)=>{const f=path.join(root,relative);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b,{flag:'wx'});};
 for(const relative of [manifestName,'packages/wallet-auth/package.json','apps/wallet-desktop/package.json','apps/wallet-desktop/package-lock.json'])put(relative,fs.readFileSync(path.join(target,relative)));
 assert(fs.readFileSync(path.join(root,manifestName)).equals(original));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});git('init','-q');git('add','.');git('-c','user.name=PUBLIC fixture','-c','user.email=public@example.invalid','-c','commit.gpgsign=false','commit','-qm','PUBLIC exact App dependency metadata only');
 let copied=0,added=0;
 for(const row of manifest.files){
  const relative='node_modules/'+row.path,isSupplement=row.path.startsWith('@noble/ciphers/'),file=path.join(isSupplement?h.destinationPrefix:path.join(target,'packages/wallet-auth'),relative);
  const s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink());assert.equal(fs.realpathSync(file),file);const body=fs.readFileSync(file);assert.equal(body.length,row.bytes);assert.equal(sha(body),row.sha256);
  if(isSupplement){assert.deepEqual(h.files.find(r=>r.path===relative),{path:relative,bytes:row.bytes,sha256:row.sha256});added++;}else copied++;
  put('packages/wallet-auth/'+relative,body);
 }
 assert.equal(copied,263);assert.equal(added,53);
 const result=walletAuthDependencyPlan(path.join(root,'apps/wallet-desktop'),'HEAD');assert.equal(result.rows.length,316);assert.equal(result.public.versions['@noble/ciphers'],'2.2.0');assert(result.rows.some(r=>r.path==='code/packages/wallet-auth/node_modules/@noble/ciphers/_arx.d.ts'));
 // An existing unequal file is not silently repaired by this read-only callee.
 const bad=path.join(root,'packages/wallet-auth/node_modules/@noble/ciphers/_arx.d.ts');fs.writeFileSync(bad,'PUBLIC changed');assert.throws(()=>walletAuthDependencyPlan(path.join(root,'apps/wallet-desktop'),'HEAD'));assert.equal(fs.readFileSync(bad,'utf8'),'PUBLIC changed');
});

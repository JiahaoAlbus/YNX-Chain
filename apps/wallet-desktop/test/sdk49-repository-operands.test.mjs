import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {relocateDesktopRuntimeSource,declaredSDKRuntimeSources,fixedSDKRuntimeManifestSources} from '../scripts/release-provenance.mjs';
import {readSDK49ProductRuntime} from '../scripts/sdk49-product-runtime.mjs';
import {canonicalSourcePath,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
const root=path.resolve(fileURLToPath(new URL('../../..',import.meta.url))),version='1.3.0-pq.3.32-auth.49';
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:16<<20}),commit=git('rev-parse','HEAD').toString().trim();
const fixed='packages/wallet-auth/src/original-auth-identity-fixed-native-image.js',joint='packages/wallet-auth/src/original-auth-identity-private-joint-registration.js',native='../../../apps/wallet-desktop/native/original-auth-identity.node';
test('complete normal SDK49 selected runtime closure collects every operand error without first-error short circuit',()=>{
 const product=readSDK49ProductRuntime(root,commit),inventory=JSON.parse(git('show',commit+':packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'));
 const required=['packages/wallet-auth/package.json','packages/wallet-auth/product-session-registry.json',...fixedSDKRuntimeManifestSources(root,commit)];
 const all=git('ls-tree','-r','--name-only',commit,'--','apps/wallet-desktop/src','packages/wallet-auth/src',...required).toString().trim().split('\n');
 const names=[...new Set([...all,...declaredSDKRuntimeSources(root,commit),...inventory.NativeInputs.map(p=>p.path).filter(p=>p.startsWith('packages/wallet-auth/')&&p.endsWith('.mjs')&&!p.endsWith('.test.mjs'))])];
 const errors=[];let checked=0,projected=0,typesExcluded=0;
 for(const name of names){
  if(name.endsWith('.d.ts')&&!product.selected.has(name.replace(/^packages\/wallet-auth\//,''))){typesExcluded++;continue;}
  if(product.contents.has(canonicalSourcePath(name))){projected++;continue;}
  if(CANONICAL_NATIVE_EVIDENCE_TESTS.includes(name))continue;
  const source=git('show',commit+':'+name);
  try{assert.deepEqual(relocateDesktopRuntimeSource(name,source,version).bytes,source,name);checked++;}catch(error){errors.push({name,cause:error.message});}
 }
 assert.deepEqual(errors,[]);assert(checked>500);assert.equal(projected,2);
 console.log(JSON.stringify({scope:'normal selected runtime bytes/finite operands only; no imports or Native',checked,projected,typesExcluded}));
});
test('new fixed loader owns exactly one Native URL; joint consumer keeps exactly one Vault import, with bytes unchanged',()=>{
 for(const[name,kind,from]of[[fixed,'url',native],[joint,'from','../../../apps/wallet-desktop/src/password-wallet-vault.mjs']]){
  const source=readFileSync(path.join(root,name)),r=relocateDesktopRuntimeSource(name,source,version);assert.deepEqual(r.bytes,source);assert.equal(r.operands.length,1);assert.equal(r.operands[0].kind,kind);assert.equal(r.operands[0].from,from);assert.equal(r.operands[0].count,1);
 }
});
test('SDK49 finite contract rejects absent, duplicate, foreign and unknown repository operands',()=>{
 const source=readFileSync(path.join(root,fixed),'utf8');
 for(const body of [source.replace(native,'../../../apps/wallet-desktop/native/foreign.node'),source.replace(native,'./original-auth-identity.node'),source+`\nnew URL('${native}',import.meta.url);`,source+"\nimport {} from '../../../apps/wallet-desktop/src/foreign.mjs';"])
  assert.throws(()=>relocateDesktopRuntimeSource(fixed,Buffer.from(body),version),/operand count|Unlisted repository operand/i);
 assert.throws(()=>relocateDesktopRuntimeSource('packages/wallet-auth/src/unknown-loader.js',Buffer.from(source),version),/Unlisted repository operand/);
});
test('old46 joint/loader rules remain strict and cannot borrow the new49 shared-loader selection',()=>{
 const old=Buffer.from(`import {} from '../../../apps/wallet-desktop/src/password-wallet-vault.mjs';\nnew URL('${native}',import.meta.url);\n`);
 assert.equal(relocateDesktopRuntimeSource(joint,old,'1.3.0-pq.3.32-auth.46').operands.length,2);
 assert.throws(()=>relocateDesktopRuntimeSource(joint,old,version),/Unlisted repository operand/);
 assert.throws(()=>relocateDesktopRuntimeSource(fixed,readFileSync(path.join(root,fixed)),'1.3.0-pq.3.32-auth.46'),/Unlisted repository operand/);
});

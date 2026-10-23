import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {FIXED_SDK_RUNTIME_IDENTITIES,relocateDesktopRuntimeSource,fixedSDKRuntimeManifestSources} from '../scripts/release-provenance.mjs';

test('SDK332 packaging selects only its fixed independent runtime manifest',()=>{
 const pin=FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.32-auth.1'];
 assert.deepEqual(pin,{bytes:65346,sha256:'0abdc434eb6e7aacc4708127e413c686e10963f4744b730c74f3d4300f522d07'});
 assert.equal(Object.isFrozen(pin),true);assert.equal(Object.isFrozen(FIXED_SDK_RUNTIME_IDENTITIES),true);
 assert.equal(FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.33-auth.1'],undefined);
 assert.notDeepEqual(pin,FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.30-auth.1']);
});
test('SDK332 normal relocation requires all three original independent Native loads',()=>{
 const file='packages/wallet-auth/src/original-ide-admission-parent-delivery.js';
 const load="new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)";
 const result=relocateDesktopRuntimeSource(file,Buffer.from(Array(3).fill(load).join(';')),'1.3.0-pq.3.32-auth.1');
 assert.equal(result.operands[0].count,3);
 for(const n of [2,4])assert.throws(()=>relocateDesktopRuntimeSource(file,Buffer.from(Array(n).fill(load).join(';')),'1.3.0-pq.3.32-auth.1'),/count differs/);
 assert.throws(()=>relocateDesktopRuntimeSource(file,Buffer.from(Array(3).fill(load).join(';')),'1.3.0-pq.3.18'),/count differs/);
});
test('SDK332 R140 successor selects its own runtime and retains exact three-load contract',()=>{
 const version='1.3.0-pq.3.32-auth.2',pin=FIXED_SDK_RUNTIME_IDENTITIES[version];
 assert.deepEqual(pin,{bytes:65346,sha256:'2f7475868d459b918c612064e111322b937759b78779c16adef948a56e7c0220'});
 assert.equal(Object.isFrozen(pin),true);assert.notDeepEqual(pin,FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.32-auth.1']);
 const file='packages/wallet-auth/src/original-ide-admission-parent-delivery.js',load="new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)";
 assert.equal(relocateDesktopRuntimeSource(file,Buffer.from(Array(3).fill(load).join(';')),version).operands[0].count,3);
 assert.throws(()=>relocateDesktopRuntimeSource(file,Buffer.from(Array(2).fill(load).join(';')),version),/count differs/);
});
test('unknown SDK cannot evade independent runtime pinning by omitting the manifest',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'wallet-sdk-manifest-selection-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(path.join(root,'packages/wallet-auth'),{recursive:true});
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 git('init','--quiet');
 const select=version=>{writeFileSync(path.join(root,'packages/wallet-auth/package.json'),JSON.stringify({name:'@ynx-chain/wallet-auth',version}));git('add','packages/wallet-auth/package.json');git('-c','user.name=PUBLIC test','-c','user.email=public-test@example.invalid','commit','--quiet','-m','bounded SDK selection fixture');return git('rev-parse','HEAD')};
 const unknown=select('1.3.0-pq.3.999-auth.1');
 assert.throws(()=>fixedSDKRuntimeManifestSources(root,unknown),/Unsupported SDK runtime manifest selection/);
 const legacy=select('1.3.0-pq.3.18');assert.deepEqual(fixedSDKRuntimeManifestSources(root,legacy),[]);
 const supported=select('1.3.0-pq.3.32-auth.2');assert.throws(()=>fixedSDKRuntimeManifestSources(root,supported),/Required SDK runtime manifest is missing/);
});
test('SDK332 cleanup successor binds its distinct auth3 manifest without changing Native load count',()=>{
 const version='1.3.0-pq.3.32-auth.3';
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES[version],{bytes:65346,sha256:'eeea144302168f53c51be55e2403cde30ee4f9c6b6b04eb5e65f2c11d621cd3c'});
 assert.notDeepEqual(FIXED_SDK_RUNTIME_IDENTITIES[version],FIXED_SDK_RUNTIME_IDENTITIES['1.3.0-pq.3.32-auth.2']);
 const file='packages/wallet-auth/src/original-ide-admission-parent-delivery.js',load="new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)";
 assert.equal(relocateDesktopRuntimeSource(file,Buffer.from(Array(3).fill(load).join(';')),version).operands[0].count,3);
 assert.throws(()=>relocateDesktopRuntimeSource(file,Buffer.from(Array(2).fill(load).join(';')),version),/count differs/);
});
test('SDK332 deployment successor selects auth4 runtime and unchanged triple Native loads',()=>{
 const version='1.3.0-pq.3.32-auth.4';
 assert.deepEqual(FIXED_SDK_RUNTIME_IDENTITIES[version],{bytes:65919,sha256:'d104b6f1670a60014fcae0470d8bc6e108cdbb2cb86deba30db8e7b9d067ae30'});
 const file='packages/wallet-auth/src/original-ide-admission-parent-delivery.js',load="new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)";
 assert.equal(relocateDesktopRuntimeSource(file,Buffer.from(Array(3).fill(load).join(';')),version).operands[0].count,3);
 assert.throws(()=>relocateDesktopRuntimeSource(file,Buffer.from(Array(2).fill(load).join(';')),version),/count differs/);
});

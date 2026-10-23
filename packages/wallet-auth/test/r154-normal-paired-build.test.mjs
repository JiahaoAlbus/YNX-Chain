import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,unlinkSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import * as build from '../../../apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const frameworks=argv=>argv.flatMap((v,i)=>v==='-framework'?[argv[i+1]]:[]);
const selectedVersion=JSON.parse(readFileSync(join(root,'packages/wallet-auth/package.json'))).version;
const nodeUnits=selectedVersion==='1.3.0-pq.3.32-auth.12'?13:12;
test('Normal Node recipe links the exact selected lineage and original NAPI custody inputs',()=>{
 const p=build.originalAuthNativeBuildPlan('arm64','/original-pinned-node-headers');
 assert.equal(p.sources.length,nodeUnits);assert.equal(new Set(p.sources).size,nodeUnits);
 for(const n of ['original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm'])assert(p.sources.includes(join(root,'packages/wallet-auth/native',n)));
 if(nodeUnits===13)assert(p.sources.includes(join(root,'packages/wallet-auth/native/original-ide-contract-relay-owner.mm')));
 assert(!p.sources.some(n=>n.endsWith('.inc.mm')),'Node entry already includes R91/service channel inc units');
 assert.deepEqual(frameworks(p.commands[0].argv),['Foundation','Security','AppKit','ServiceManagement']);
 assert(p.commands[0].argv.includes('-DNAPI_VERSION=8'));assert(p.commands[0].argv.includes('-mmacosx-version-min=13.0'));
});
test('R159 normal helper is an eleven-unit executable including real client and kernel without NAPI or dynamic lookup',()=>{
 assert.equal(typeof build.originalIDEHelperBuildPlan,'function');const p=build.originalIDEHelperBuildPlan('arm64');
 assert.equal(p.sources.length,11);assert.equal(new Set(p.sources).size,11);
 for(const n of ['original-ide-helper-client.mm','original-ide-parent-kernel.mm','original-ide-parent-source-binding.mm'])assert(p.sources.includes(join(root,'packages/wallet-auth/native',n)));
 assert(p.sources.includes(join(root,'apps/wallet-desktop/native/original-ide-auth-request-source.inc.mm')));
 assert.deepEqual(frameworks(p.commands[0].argv),['Foundation','Security','ServiceManagement']);
 for(const forbidden of ['dynamic_lookup','-dynamiclib','-DNAPI_VERSION=8','-undefined'])assert(!p.commands[0].argv.includes(forbidden));
 assert.equal(p.output,join(root,'apps/developer/helper/YNXIdentityReceiver'));assert.equal(p.minimumSystemVersion,'13.0');
});
async function isolated(remove,fn){
 const m=JSON.parse(readFileSync(join(root,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'))),dir=mkdtempSync(join(tmpdir(),'ynx-r154-plan-'));
 try{
 const paths=new Set(['apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs','apps/wallet-desktop/package.json',...m.NativeInputs.map(p=>p.path),...((m.HelperInputs??[]).map(p=>p.path)),'packages/wallet-auth/native/original-ide-helper-client.h','packages/wallet-auth/native/original-ide-helper-client.mm','packages/wallet-auth/native/original-ide-helper-xpc-peer.h','packages/wallet-auth/native/original-ide-helper-xpc-peer.mm','packages/wallet-auth/native/original-ide-helper-build-release.h','packages/wallet-auth/native/original-ide-helper-service-contract.h','packages/wallet-auth/native/original-ide-helper-service-install.mm','packages/wallet-auth/native/original-ide-helper-listener.h','packages/wallet-auth/native/original-ide-helper-listener.mm','packages/wallet-auth/native/original-ide-helper-effect-contract.h','apps/developer/helper/main.mm']);
 for(const p of paths){const target=join(dir,p);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,p),target);}unlinkSync(join(dir,remove));
 const b=await import(pathToFileURL(join(dir,'apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs')));fn(b);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('R154 partial Node client input cannot silently select old eight-unit recipe',async()=>isolated('packages/wallet-auth/native/original-ide-helper-client.mm',b=>assert.throws(()=>b.originalAuthNativeBuildPlan('arm64','/original-headers'),/AUTH_NATIVE_HELPER_SOURCE_SELECTION_INCOMPLETE/)));
test('R154 helper cannot emit an executable recipe without the real main source',async()=>isolated('apps/developer/helper/main.mm',b=>assert.throws(()=>b.originalIDEHelperBuildPlan('arm64'),/AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE/)));
test('R159 missing publication implementation refuses both normal recipes before compilation',async()=>isolated('packages/wallet-auth/native/original-ide-publication-artifact.mm',b=>{
 assert.throws(()=>b.originalAuthNativeBuildPlan('arm64','/original-headers'),/AUTH_NATIVE_PUBLICATION_SOURCE_SELECTION_INCOMPLETE/);
 assert.throws(()=>b.originalIDEHelperBuildPlan('arm64'),/AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE/);
}));

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {tmpdir} from 'node:os';
import {originalAuthNativeBuildPlan,originalIDEHelperBuildPlan} from '../../../apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs';
import {verifySDK332R140Source,sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root=fs.realpathSync(fileURLToPath(new URL('../../../',import.meta.url))),native='packages/wallet-auth/native/',ip='packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json';
const additions=['original-ide-project-control-custody.h','original-ide-project-control-custody.mm','original-ide-project-control-key-record.h','original-ide-project-control-custody-source.inc.mm','original-ide-project-control-custody-data.mjs'].map(n=>native+n),custodyTU=path.join(root,additions[1]);
const frameworks=p=>p.commands[0].argv.flatMap((x,i,a)=>x==='-framework'?[a[i+1]]:[]);
// Source-only plans and small declared-source copies. Never compile, load,
// inspect a real runtime closure, access Keychain, or execute supplier tests.
test('R201 normal user custody is one new TU and LocalAuthentication; helper retains metadata-only closure',()=>{
 const node=originalAuthNativeBuildPlan('arm64','/PUBLIC/UNUSED_HEADERS'),helper=originalIDEHelperBuildPlan('arm64');
 assert.equal(node.sources.length,14);assert.equal(node.sources.filter(p=>p===custodyTU).length,1);assert.equal(helper.sources.length,11);assert.ok(!helper.sources.includes(custodyTU));
 assert.deepEqual(frameworks(node),['Foundation','Security','AppKit','ServiceManagement','LocalAuthentication']);assert.deepEqual(frameworks(helper),['Foundation','Security','ServiceManagement']);
 for(const plan of [node,helper]){const argv=plan.commands.flatMap(c=>c.argv);assert.ok(!argv.some(x=>/YNX_ORIGINAL_CONTROL_CUSTODY_PUBLIC_TEST|YNX_ORIGINAL_WALLET_ARTIFACT_|CONTROL.*\.a|libynx_artifact_release/.test(x)));assert.equal(plan.sources.filter(x=>x.endsWith('original-auth-identity-source-authority.mm')).length,1);}
 const source=fs.readFileSync(path.join(root,native+'original-auth-identity-source-authority.mm'),'utf8');assert.equal(source.split('#include "original-ide-project-control-custody-source.inc.mm"').length-1,1);assert.ok(!source.includes('YNXAuthOriginalProjectControlCustody'));
 const body=fs.readFileSync(custodyTU,'utf8');assert.match(body,/#import <LocalAuthentication\/LocalAuthentication.h>/);assert.match(body,/getuid\(\)!=0/);assert.ok(!body.includes('libynx'));
});
test('R201 declares exact new five inputs and independent81 compile-input/14+11 normal recipe',async()=>{
 const {contract}=verifySDK332R140Source(root),normal=[...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool];
 assert.equal(contract.version,'1.3.0-pq.3.32-auth.27');assert.equal(contract.NativeInputs.length,91);assert.equal(contract.HelperInputs.length,5);assert.equal(normal.length,101);assert.equal(new Set([...normal,...contract.sourceCurrentIOInputs].map(x=>x.path)).size,102);assert.equal(normal.filter(p=>/\.(?:h|mm|cpp)$/.test(p.path)).length,81);
 for(const p of additions)assert.equal(contract.NativeInputs.filter(x=>x.path===p).length,1);
 assert.equal(contract.supplierR201.compileInputCount,81);assert.equal(contract.supplierR201.prior77MachineCodeReusable,false);assert.equal(contract.supplierR201.NativeBuild,false);assert.equal(contract.supplierR201.Source13,false);assert.equal(contract.supplierR201.Root,false);
 const selected=await sdk332R140NativePlan(root,'/PUBLIC/UNUSED_HEADERS','arm64');assert.equal(selected.plan.sources.length,14);assert.equal(selected.helperPlan.sources.length,11);assert.equal(selected.NativeBuild,false);assert.equal(selected.grant,false);
});
test('R201 user closure rejects each missing new input; helper requires only actual shared include and DATA dependency',async()=>{
 const {contract}=verifySDK332R140Source(root),all=[...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool,...contract.sourceCurrentIOInputs],temp=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'ynx-r201-source-')));
 try{
  for(const p of new Set(['packages/wallet-auth/package.json','apps/wallet-desktop/package.json',ip,...all.map(p=>p.path)])){const dest=path.join(temp,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,p),dest);}
  const build=await import(pathToFileURL(path.join(temp,contract.normalBuildTool.path)).href);
  for(const p of additions){const file=path.join(temp,p);fs.unlinkSync(file);assert.throws(()=>build.originalAuthNativeBuildPlan('arm64','/PUBLIC/UNUSED_HEADERS'),/AUTH_NATIVE_CONTROL_CUSTODY_SOURCE_SELECTION_INCOMPLETE/);
   if(p.endsWith('custody-source.inc.mm')||p.endsWith('custody-data.mjs'))assert.throws(()=>build.originalIDEHelperBuildPlan('arm64'),/AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE/);else assert.equal(build.originalIDEHelperBuildPlan('arm64').sources.length,11);
   fs.copyFileSync(path.join(root,p),file);
  }
  const changed=JSON.parse(fs.readFileSync(path.join(temp,ip)));changed.NativeInputs[changed.NativeInputs.findIndex(x=>x.path===additions[0])]=changed.NativeInputs[0];fs.writeFileSync(path.join(temp,ip),JSON.stringify(changed));assert.throws(()=>verifySDK332R140Source(temp),{code:'SDK332_R140_CONTROL_CUSTODY_INVENTORY_INVALID'});
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

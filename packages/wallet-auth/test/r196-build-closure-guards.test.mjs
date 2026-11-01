import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{tmpdir}from'node:os';import{fileURLToPath,pathToFileURL}from'node:url';import{verifySDK332R140Source}from'../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,'');
test('normal original build selectors refuse each missing control dependency and an omitted declaration',async()=>{
 const{contract}=verifySDK332R140Source(root),closure=contract.supplierR196.newRelativeClosure,all=[...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool,...contract.sourceCurrentIOInputs],temp=fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(),'ynx-r196-guards-')));let refused=0;
 try{
  for(const p of new Set(['packages/wallet-auth/package.json','apps/wallet-desktop/package.json','packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',...all.map(p=>p.path)])){const to=path.join(temp,p);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(root,p),to)}
  const build=await import(pathToFileURL(path.join(temp,contract.normalBuildTool.path)).href);
  for(const p of closure){fs.unlinkSync(path.join(temp,p.path));assert.throws(()=>build.originalAuthNativeBuildPlan('arm64','/PUBLIC/UNUSED_HEADERS'),/AUTH_NATIVE_PROJECT_CONTROL_SOURCE_SELECTION_INCOMPLETE/);assert.throws(()=>build.originalIDEHelperBuildPlan('arm64'),/AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE/);refused+=2;fs.copyFileSync(path.join(root,p.path),path.join(temp,p.path))}
  const p=path.join(temp,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'),c=JSON.parse(fs.readFileSync(p));c.NativeInputs[c.NativeInputs.findIndex(p=>p.path===closure[0].path)]=c.NativeInputs[0];fs.writeFileSync(p,JSON.stringify(c));assert.throws(()=>verifySDK332R140Source(temp),{code:'SDK332_R140_CONTROL_INVENTORY_INVALID'});refused++;assert.equal(refused,11);
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
});

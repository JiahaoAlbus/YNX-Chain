import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {verifySDK332R140Source,sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
test('combined SDK332 auth4 retains original APIs, adds pure deployment exports and selects exact R140 source through the normal eight-TU recipe',async()=>{
  const selected=verifySDK332R140Source(root);
  assert.equal(selected.contract.NativeInputs.length,55);
  const plan=await sdk332R140NativePlan(root,'/original-a-pinned-node-headers','arm64');
  assert.equal(plan.plan.sources.length,8);assert.equal(plan.rebuildRequired,true);
  assert.equal(plan.prebuiltSDK330ModuleAllowed,false);assert.equal(plan.NativeBuild,false);assert.equal(plan.grant,false);
  assert(plan.plan.sources.every(p=>p.startsWith(selected.root+'/')));
  const r140=selected.contract.NativeInputs.filter(p=>['original-ide-auth-identity-owners.inc.mm','original-ide-parent-node.mm'].some(n=>p.path.endsWith('/'+n)));
  assert.deepEqual(r140.map(p=>p.sha256),['dc3e4178d032c52c9238abf885716a0d23802377739e8a4e5155c89befe785ca','ab91b89a5d31b34116b7243c2b52002555ac7649d154a76e917307c2614f9dc7']);
});
test('composition rejects mixed Native source and an old SDK version before any build',()=>{
  const {contract}=verifySDK332R140Source(root),temp=mkdtempSync(join(tmpdir(),'ynx-sdk332-r140-selection-'));
  try{
    for(const relative of ['packages/wallet-auth/package.json','packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',contract.normalBuildTool.path,...contract.pureDeploymentInputs.map(p=>p.path),...contract.NativeInputs.map(p=>p.path)]){
      const target=join(temp,relative);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,relative),target);
    }
    verifySDK332R140Source(temp);
    const node=join(temp,'packages/wallet-auth/native/original-ide-parent-node.mm'),saved=readFileSync(node);
    writeFileSync(node,Buffer.concat([saved,Buffer.from('\n// mixed source\n')]));
    assert.throws(()=>verifySDK332R140Source(temp),{code:'SDK332_R140_NATIVE_INPUT_DIFFERS'});
    writeFileSync(node,saved);
    const pkg=join(temp,'packages/wallet-auth/package.json'),dto=JSON.parse(readFileSync(pkg));dto.version='1.3.0-pq.3.32-auth.2';writeFileSync(pkg,JSON.stringify(dto));
    assert.throws(()=>verifySDK332R140Source(temp),{code:'SDK332_R140_PACKAGE_SELECTION_INVALID'});
  }finally{rmSync(temp,{recursive:true,force:true});}
});

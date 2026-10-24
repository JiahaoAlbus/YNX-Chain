import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{verifySDK332R140Source,sdk332R140NativePlan}from'../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,''),pins={
 'native/original-ide-project-control-source.inc.mm':'d122f5ac46c6823d170fb1c544a9b39d6b34b4a8a193cc9ce8531d0f367b9c96',
 'native/original-ide-project-control-capture.mjs':'923987c3100910a1e479ddee5c239e36151c3a4e087614116f90428803c94507',
 'native/original-auth-identity-source-authority.h':'41183eddf0f4f3c657ca981d9b63f15b05d08079606241d96ccf70ee513658c8',
 'native/original-auth-identity-source-authority.mm':'72777453136db7a0c0e21051a3699ab4b31b7ae11ac2cac58452b6a358f687e2',
 'native/original-auth-identity-joint-owner.h':'bdf37c7c11d483cba9f2b44dcdf3e9b3766b582ee6da86aece3a5b465e92605b',
 'native/original-auth-identity-joint-owner.mm':'8a2441c76515cb1c7de6def4a08392ee302d03c78a8f1a4aed1042ff6668ba42',
 'native/original-auth-identity-source-v2-verifier.mjs':'3c1470e2ebf02b7acd3be545ab733b7951fd30d0fad5a487a82ae98d321129a8',
 'src/original-auth-source-current-v2.js':'ffce0c998b4b33ec1688abfef596172241029d8faea46c8558c7e387aa1e2f55',
 'src/product-session-gateway-node-host.js':'b252ef02eeb2e3dce045608f66e891d3da0bffc3bbf6c1c1699051429ba8642a',
 'src/original-auth-identity-source-current.js':'d4efda732d5cc21fc443926aa07be11ebb95c1d46d7d84939fc4c5544e79e759',
 'native/original-ide-project-control-contract.mjs':'41b5e5aff29769f6e1d0e02d0bde1b3dc1242ee291b79863c081e720b68b8d39'
};
test('canonical control source matches frozen R196 and preserves R193 Host and the strict member guard through R197 text alignment',()=>{for(const[p,h]of Object.entries(pins))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex'),h,p)});
test('new canonical recipe selects full control closure in the same original addon and helper without claiming a build',async()=>{
 const {contract}=verifySDK332R140Source(root),plan=await sdk332R140NativePlan(root,'/PUBLIC/UNUSED_HEADERS','arm64');
 assert.equal(contract.version,'1.3.0-pq.3.32-auth.25');assert.equal(contract.NativeInputs.length,86);assert.equal(contract.HelperInputs.length,5);
 assert.equal(plan.plan.sources.length,13);assert.equal(plan.helperPlan.sources.length,11);assert.equal(plan.NativeBuild,false);assert.equal(plan.grant,false);assert.equal(plan.rebuildRequired,true);
 for(const f of ['original-ide-project-control-source.inc.mm','original-ide-project-control-capture.mjs','original-ide-project-control-contract.mjs','original-developer-principal-data.mjs','original-ide-publication-approval-contract.mjs'])assert.equal(contract.NativeInputs.filter(x=>x.path==='packages/wallet-auth/native/'+f).length,1);
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));for(const f of ['native/original-ide-project-control-source.inc.mm','native/original-ide-project-control-capture.mjs'])assert.ok(pkg.files.includes(f));
 assert.equal(contract.sourceCurrentIOInputs[0].sha256,'34fcbb849aff49f5101bb9e6eda0bdc50ed4c71421c3606833ca8c5a3bca32c7');
});

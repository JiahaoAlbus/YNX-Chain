import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{verifySDK332R140Source,sdk332R140NativePlan}from'../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,''),pins={
 'native/original-ide-project-control-source.inc.mm':'d122f5ac46c6823d170fb1c544a9b39d6b34b4a8a193cc9ce8531d0f367b9c96',
 'native/original-ide-project-control-capture.mjs':'923987c3100910a1e479ddee5c239e36151c3a4e087614116f90428803c94507',
 'native/original-auth-identity-source-authority.h':'15686b1386b6d37fbab03fc2f24ba6705862f4df636e424a95feff5ef4ac2d90',
 'native/original-auth-identity-source-authority.mm':'704da24f0f039ca08809748ac5a435bab79d585a3615fa2a46a65aa87091b9cb',
 'native/original-auth-identity-joint-owner.h':'bdf37c7c11d483cba9f2b44dcdf3e9b3766b582ee6da86aece3a5b465e92605b',
 'native/original-auth-identity-joint-owner.mm':'8a2441c76515cb1c7de6def4a08392ee302d03c78a8f1a4aed1042ff6668ba42',
 'native/original-auth-identity-source-v2-verifier.mjs':'c18927ff9475cdc2e8acd5993cfb31d35e0cfda9e31d149748b4326d62a37694',
 'src/original-auth-source-current-v2.js':'926d639611753d8e1d3baa59daee8844e449567dbd89301a30d25e264d502068',
 'src/product-session-gateway-node-host.js':'3080c31654b8c72c26b44f52e5b8bdc7c685bd54f964949dd00608cada11dc54',
 'src/original-auth-identity-source-current.js':'d4efda732d5cc21fc443926aa07be11ebb95c1d46d7d84939fc4c5544e79e759',
 'native/original-ide-project-control-contract.mjs':'41b5e5aff29769f6e1d0e02d0bde1b3dc1242ee291b79863c081e720b68b8d39'
};
test('canonical control source retains R201 with the R204 Source and normal daemon successors',()=>{for(const[p,h]of Object.entries(pins))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex'),h,p)});
test('new canonical recipe selects full control closure in the same original addon and helper without claiming a build',async()=>{
 const {contract}=verifySDK332R140Source(root),plan=await sdk332R140NativePlan(root,'/PUBLIC/UNUSED_HEADERS','arm64');
 assert.equal(contract.version,'1.3.0-pq.3.32-auth.28');assert.equal(contract.NativeInputs.length,91);assert.equal(contract.HelperInputs.length,5);
 assert.equal(plan.plan.sources.length,14);assert.equal(plan.helperPlan.sources.length,11);assert.equal(plan.NativeBuild,false);assert.equal(plan.grant,false);assert.equal(plan.rebuildRequired,true);
 for(const f of ['original-ide-project-control-source.inc.mm','original-ide-project-control-capture.mjs','original-ide-project-control-contract.mjs','original-developer-principal-data.mjs','original-ide-publication-approval-contract.mjs'])assert.equal(contract.NativeInputs.filter(x=>x.path==='packages/wallet-auth/native/'+f).length,1);
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));for(const f of ['native/original-ide-project-control-source.inc.mm','native/original-ide-project-control-capture.mjs'])assert.ok(pkg.files.includes(f));
 assert.equal(contract.sourceCurrentIOInputs[0].sha256,'34fcbb849aff49f5101bb9e6eda0bdc50ed4c71421c3606833ca8c5a3bca32c7');
});

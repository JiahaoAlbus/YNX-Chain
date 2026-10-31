import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {walletNativeComponentBuildPlan,buildWalletNativeComponent} from '../scripts/build-wallet-native-component.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS} from '../scripts/canonical-package.mjs';
import {deviceV4PQSupplierInputs,deviceV4PQReceiptCommands,assertWalletProvisioningNativeExports,DEVICE_V4_QUERY_PQ_NODE,DEVICE_V4_QUERY_PQ_ROLE} from '../scripts/wallet-device-v4-pq-role.mjs';
// Normal recipe DATA only: the actual matching compilation is separate.
const headers='/PUBLIC-plan-only-headers';
test('actual provisioning entry reaches pinned-header validation before executing a compiler',()=>{
 // A deliberately absent header root stops the real entry before any command
 // or output mutation, while exercising argument forwarding and source checks.
 assert.throws(()=>buildWalletNativeComponent('arm64',headers,true,true,true,true,null,null,false,true,true,true),e=>e.code==='ENOENT'&&e.path===headers+'/node_api.h');
});
test('normal receipt selection accepts the exact 145-input query closure',()=>{
 const bytes=readFileSync(new URL('../../../packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',import.meta.url)),inventory=JSON.parse(bytes);
 const p=walletNativeComponentBuildPlan('arm64',headers,true,true,true,true,false,true,true,true);
 const names=[...inventory.NativeInputs,...p.walletInputFiles,...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/'))].map(p=>p.path).concat(CANONICAL_NATIVE_EVIDENCE_TESTS);
 const receipt=[...deviceV4PQSupplierInputs(inventory.NativeInputs),...p.walletInputFiles].map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 const result=canonicalNativeInputSelection(inventory.version,names,bytes,receipt);
 assert.equal(result.supplierNodeInputCount,145);
 assert.throws(()=>canonicalNativeInputSelection(inventory.version,names,bytes,receipt.map((p,i)=>i? p:{...p,sha256:'0'.repeat(64)})));
});
test('fresh provisioning role preserves full Wallet guards and links the ecdf runtime exactly once',()=>{
 const p=walletNativeComponentBuildPlan('arm64',headers,true,true,true,true,false,true,true,true);
 assert.equal(p.deviceV4PQRole,DEVICE_V4_QUERY_PQ_ROLE);assert.equal(p.commands.length,29);
 const cpp=p.commands.filter(c=>c.tool==='/usr/bin/clang++');assert.equal(cpp.length,26);
 for(const c of cpp)for(const flag of ['SOURCE','HTTP_PRODUCER','PENDING','PROVISIONING','QUERY'])assert(c.argv.includes('-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_'+flag+'_STAGE'));
 assert.equal(p.commands.at(-1).argv.filter(x=>x.endsWith('.a')).length,1);assert(p.commands.at(-1).argv.some(x=>x.endsWith('/device-v4-provisioning-protocol/typed/libynx_artifact_release.a')));
 for(const name of ['original-product-device-v4-provisioning.mm','original-product-device-v4-association-keychain.mm','original-product-device-v4-core-creator.mm','original-product-device-v4-query-reader.mm'])assert(cpp.some(c=>c.argv.some(x=>x.endsWith('/'+name))));
 assert.deepEqual(deviceV4PQReceiptCommands({deviceV4PQRole:p.deviceV4PQRole,architectures:['arm64'],pqNativeBaseCommands:p.pqNativeBaseCommands,sourceRoot:fileURLToPath(new URL('../../..',import.meta.url)).replace(/\/$/,''),headerRoot:headers,commands:p.commands}),p.pqNativeBaseCommands);
});
test('new provisioning role rejects the older entry and a changed supplier Node identity',()=>{
 assert.throws(()=>walletNativeComponentBuildPlan('arm64',headers,true,true,true,true,false,true,false),{message:'WALLET_QUERY_EXPLICIT_FULL_ROLE_REQUIRED'});
 const inventory=JSON.parse(readFileSync(new URL('../../../packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',import.meta.url)));
 const selected=deviceV4PQSupplierInputs(inventory.NativeInputs);assert.deepEqual(selected.find(p=>p.path===DEVICE_V4_QUERY_PQ_NODE.path),DEVICE_V4_QUERY_PQ_NODE);
 assert.throws(()=>deviceV4PQSupplierInputs(inventory.NativeInputs.map(p=>p.path===DEVICE_V4_QUERY_PQ_NODE.path?{...p,sha256:'0'.repeat(64)}:p)));
});
test('provisioning export scan requires the new device-only creator as well as all prior signing APIs',()=>{
 const names=['YNXTransactionBatchSignV1','YNXAccountInitialSignV1','YNXProductSessionHTTPProofSignV4','YNXProductSessionDeviceRegistrationSignV4','YNXProductSessionDeviceChallengeSignV4'],old=names.map(n=>'000 T _'+n).join('\n');
 assert.throws(()=>assertWalletProvisioningNativeExports(old));assertWalletProvisioningNativeExports(old+'\n000 T _YNXProductSessionDeviceKeypairGenerateV4');
});

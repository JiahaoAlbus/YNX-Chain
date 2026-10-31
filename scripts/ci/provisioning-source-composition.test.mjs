import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const contract=JSON.parse(fs.readFileSync(root+'/packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'));
test('complete provisioning source graph pins new Native leaves and normal builder',()=>{
 const paths=new Set();
 for(const r of [...contract.NativeInputs,contract.normalBuildTool]){
  assert(!paths.has(r.path));paths.add(r.path);
  const raw=fs.readFileSync(root+'/'+r.path);
  assert.equal(raw.length,r.bytes,r.path);
  assert.equal(createHash('sha256').update(raw).digest('hex'),r.sha256,r.path);
 }
 for(const p of ['apps/wallet-desktop/native/original-product-device-v4-provisioning-source.inc.mm','apps/wallet-desktop/native/original-product-device-v4-provisioning-composition.inc.mm','apps/wallet-desktop/native/original-product-device-v4-provisioning-approval.inc.mm','apps/wallet-desktop/native/original-product-device-v4-core-creator.mm','apps/wallet-desktop/native/product_device_keypair_v4.h','packages/wallet-auth/native/original-product-device-v4-provisioning-source-contract.mjs'])assert(paths.has(p),p);
 assert.equal(contract.NativeInputs.length,contract.deviceOriginalQueryNativeSource?.NativeInputs??contract.deviceOriginalQuerySourceKernel?.NativeInputs??contract.deviceProvisioningNativeSuccessor.NativeInputs);
 assert.equal(contract.deviceProvisioningNativeSuccessor.SourceAdmission,false);
});
test('provisioning export scan requires creator and all inherited HTTP/typed symbols',async()=>{
 const m=await import(pathToFileURL(root+'/apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs'));
 const symbols=contract.deviceProvisioningNativeSuccessor.requiredProtocolExports;
 const text=symbols.map(s=>'00000000 T _'+s).join('\n');
 assert.doesNotThrow(()=>m.assertOriginalProvisioningDeviceV4Exports(text));
 for(const name of symbols)assert.throws(()=>m.assertOriginalProvisioningDeviceV4Exports(text.split('\n').filter(l=>!l.endsWith('_'+name)).join('\n')));
 assert.throws(()=>m.assertOriginalProvisioningDeviceV4Exports(text.replaceAll(' T ',' U ')));
});
test('normal SDK fixed-image entry rejects caller paths before loading anything',async()=>{
 const m=await import(pathToFileURL(root+'/packages/wallet-auth/src/original-auth-identity-fixed-native-image.js'));
 for(const input of [undefined,{},'/tmp/replacement.node',()=>{}])assert.throws(()=>m.acquireOriginalProductSessionDeviceV4ProvisioningSourceStage(input),{code:'DEVICE_PROVISIONING_SOURCE_ZERO_INPUT'});
 const pkg=JSON.parse(fs.readFileSync(root+'/packages/wallet-auth/package.json'));
 for(const p of ['native/original-product-device-v4-provisioning-journal.h','native/original-product-device-v4-provisioning-source-contract.mjs'])assert(pkg.files.includes(p));
});

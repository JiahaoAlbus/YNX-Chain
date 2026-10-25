import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifySDK13NativeComponent,sdk13HelperBuildCommands} from '../scripts/sdk13-native-component.mjs';
import {walletNativeSourceProfile} from '../scripts/wallet-publisher-native-build.mjs';
import {sdkRuntimeUnionProfile,SDK14_RUNTIME_UNION_SOURCE} from '../scripts/sdk14-runtime-union.mjs';
import {PQ_NATIVE_MANIFEST,pqNativeSupplierInputs} from '../scripts/wallet-pq-native-build.mjs';
const runtimeRoot=process.env.WALLET_SDK46_COMPONENT_SOURCE_ROOT;
test('formal SDK46 PQ executed-record gate reaches exact supplier readback, not the obsolete SDK42-only refusal',{skip:!runtimeRoot?'requires original full SDK46 runtime manifest':false},()=>{
 const inventoryBytes=readFileSync(new URL('./fixtures/auth46-native-inventory.json',import.meta.url)),inventory=JSON.parse(inventoryBytes),profile=walletNativeSourceProfile(inventory.version),sourceRoot='/PUBLIC/gate-not-a-build',architectures=['arm64'],union=sdkRuntimeUnionProfile(inventory.version);
 const supplier=[...pqNativeSupplierInputs(inventory.NativeInputs,true),...inventory.HelperInputs],record={readbackOnly:false,commandsKind:'executed-normal-build',sourceRoot,sourceInventory:{relative:'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',...profile.inventory},architectures,commands:[],exitCodes:[],inputFiles:[{relative:PQ_NATIVE_MANIFEST.path}],runtimeUnion:{...union,filesVerified:union.files,sourceRoot:sourceRoot+'/packages/wallet-auth',NativeAdmission:false,installedImageQualified:false,platformQualified:false,networkActivated:false},helperBuild:{kind:'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1',sourceRoot,readbackOnly:false,commandsKind:'executed-normal-build',executed:true,serviceRegistered:false,installed:false,nativeQualified:false,appSigned:false,architectures,commands:sdk13HelperBuildCommands(sourceRoot,architectures),exitCodes:[0],inputFiles:supplier.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en'))}};
 const boundary=Error('PUBLIC exact source verification still required; this is NOT an executed build record');let supplierReads=0;
 const verify=()=>verifySDK13NativeComponent({record,inventoryBytes,moduleBytes:Buffer.alloc(0),helperBytes:Buffer.alloc(0)},name=>{if(name===SDK14_RUNTIME_UNION_SOURCE)return readFileSync(runtimeRoot+'/'+name);supplierReads++;throw boundary;});
 assert.throws(verify,e=>e===boundary);assert.equal(supplierReads,1);
 // Reaching that boundary never admits a missing runtime or wrong Native row.
 const runtime=record.runtimeUnion;record.runtimeUnion={...runtime,filesVerified:runtime.files-1};supplierReads=0;assert.throws(verify,/Matched Wallet native component differs/);assert.equal(supplierReads,0);record.runtimeUnion=runtime;
 record.helperBuild.inputFiles[0].sha256='0'.repeat(64);assert.throws(verify,/Matched Wallet native component differs/);assert.equal(supplierReads,0);
});
test('unreviewed SDK47/48 cannot inherit the formal46 executed-record profile',()=>{for(const n of [47,48,49])assert.throws(()=>walletNativeSourceProfile('1.3.0-pq.3.32-auth.'+n),/MATCHED_SDK_REQUIRED/);});

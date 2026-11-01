// Test-host control only: formal Native code + PUBLIC CodeRoot seam, not grant.
import assert from'node:assert/strict';import{pathToFileURL}from'node:url';import{resolve,join}from'node:path';
const root=resolve(process.argv[2]),mode=process.argv[3],url=name=>pathToFileURL(join(root,name)).href;
const {native}=await import(url('original-auth-identity-fixed-native-image.js'));
const sdk=await import(url('original-wallet-main-namespace-bootstrap.js'));
const helper=await import(url('original-wallet-main-namespace-node-loader-private.js'));
const control=await import(url('control.mjs'));const admission=await import(url('original-auth-runtime-image-source-v1.js'));
const tick=()=>new Promise(r=>setImmediate(r));
assert.equal(native.PUBLICborrow(),false);
if(mode==='partial'){
 control.resolve();await import(url('main.mjs'));
 const first=native.initializeOriginalWalletMainNamespaceV1();const load=helper.startOriginalWalletMainNamespaceNodeLoadV1(first);const loaded=await load.completion;assert.equal(loaded.errorPresent,false,loaded.error?.stack);assert.equal(native.PUBLICborrow(),true);
 const a=sdk.initializeOriginalWalletMainNamespaceV1(),r=await a.completion;
 assert.equal(r.error.code,'WALLET_MAIN_NAMESPACE_ALREADY_SELECTED');assert.equal(Object.getOwnPropertyDescriptor(r.error,'partial').value,r.nativeOwner);assert.equal(native.isOriginalWalletMainNamespaceOwnerV1(r.nativeOwner),true);await a.close();assert.equal(a.statusDATA().nativeCloseComplete,true);assert.equal(a.statusDATA().closeComplete,true);
 load.retire();await load.join();native.retireOriginalWalletMainNamespaceV1(first);native.joinOriginalWalletMainNamespaceV1(first);native.closeOriginalWalletMainNamespaceV1(first);
}else if(mode==='pending'){
 const a=sdk.initializeOriginalWalletMainNamespaceV1();for(let i=0;i<50&&!a.statusDATA().nodeLoadSelected;i++)await tick();assert.equal(a.statusDATA().nodeLoadSelected,true);a.retire();let done=false;const close=a.close();close.then(()=>done=true);await tick();assert.equal(done,false);assert.deepEqual(admission.events,[]);control.resolve();const r=await a.completion;assert.equal(r.loadResult.namespacePresent,true);assert.equal(r.loadResult.error.code,'WALLET_MAIN_LOADER_RETIRED');await close;assert.equal(a.statusDATA().nativeCloseComplete,true);assert.equal(a.statusDATA().closeComplete,true);
}else if(mode==='accepted'){
 control.resolve();const same=await import(url('main.mjs'));const a=sdk.initializeOriginalWalletMainNamespaceV1();const r=await a.completion;assert.equal(r.errorPresent,false,r.error?.stack);assert.equal(native.isOriginalWalletMainNamespaceOwnerV1(r.nativeOwner),true);assert.equal(r.loadResult.namespaceOriginal,same);assert.equal(native.PUBLICborrow(),true);await a.close();assert.equal(a.statusDATA().nativeCloseComplete,true);assert.equal(a.statusDATA().closeComplete,true);
}else throw Error('PUBLIC_NATIVE_MODE');
assert.equal(native.PUBLICborrow(),false);assert.deepEqual(admission.events,['image.retire','image.join','image.close']);
console.log(JSON.stringify({mode,actualFormalSixExports:true,actualSoleSDKProducer:true,RootSeamOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,MainAdmitted:false,installed:false}));

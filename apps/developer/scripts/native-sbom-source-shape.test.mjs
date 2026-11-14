import test from'node:test';import assert from'node:assert/strict';import{assertNativeSBOMSourceShape,addMatchedNodeSBOMComponent}from'./generate-code-sbom.mjs';
import{CONTROL_MATCHED_VARIANT,matchedNodePackageSourceRoles}from'./c6-control-matched-input.mjs';
const current='a'.repeat(40),base='b'.repeat(40),sdk='c'.repeat(40),compiled='d'.repeat(40);
const native=()=>({schema:'YNX_IDE_NORMAL_COCOA_LINK_DISTRIBUTION/v1',sourceCommit:base,SDKSourceCommit:sdk,objects:58});
const plan=()=>({schema:'YNX_IDE_CURRENT_PRODUCT_QA_LINK_PLAN/v1',compiledSource:{commit:compiled},commands:Array.from({length:58},()=>({}))});
const roles=()=>({applicationSourceCommit:current,assembledSourceCommit:base,compiledNativeSourceCommit:compiled,SDKResourceSourceCommit:sdk,originalNativeReceiptsPreserved:true});
const matched=()=>({schema:'YNX_IDE_CONTROL_MATCHED_WHOLE_NORMAL_PRODUCT/v1',SDKResourceOnlySuccessor:true,NativeBuildOrRelinkRequested:false,roles:{CocoaCPPBase:'3c9ead1f8a5920fb2428553dfed4e6943f882968',CocoaCompiledSDK:'98956ed2bbac8bb5c86de83c4f1df24314e19bf0'},matchedNode:{sourceRoles:{CPPBase:'3c9ead1f8a5920fb2428553dfed4e6943f882968',SwiftBase:'c6af5521c96433f44b5fa91597fb30415a47c1d6',originalFiniteNAPIProducer:'86d0d24c052843516c6cf79e2fe2ee859d43358a',projectControlSource:'4a807cdc6e09c25467f06cc912a655a294ccc975',NodeOriginalSourceUnchanged:true,NodeCompileClosureChanged:true},record:{relative:'apps/wallet-desktop/native/NORMAL_WALLET_PROJECT_CONTROL_MATCHING_RECORD.json',bytes:46291,sha256:'cb77be5f4f015a722254f5e9869a35e985fe0e8c238e0ca1efed906e7ff48c32'},image:{bytes:15917120,sha256:'6e180505fe4c7c646bfa427162e607a10385ca8865d3f8b7e37f5ccc0aa2771d'}}});
test('matched composite Node SBOM preserves its own producer and Cocoa SDK roles',()=>{
 const rows=[],r={sourceVariant:CONTROL_MATCHED_VARIANT,...matchedNodePackageSourceRoles(matched())};addMatchedNodeSBOMComponent(rows,r);
 assert.equal(rows.length,1);assert.equal(rows[0].hashes[0].content,r.matchedNodeImage.sha256);
 assert.ok(rows[0].properties.some(x=>x.name==='ynx:originalFiniteNAPIProducer'&&x.value==='86d0d24c052843516c6cf79e2fe2ee859d43358a'));
 assert.ok(rows[0].properties.some(x=>x.name==='ynx:inheritedCocoaCompiledSDK'&&x.value==='98956ed2bbac8bb5c86de83c4f1df24314e19bf0'));
 const old=[];addMatchedNodeSBOMComponent(old,{sourceVariant:'SDK49-IDE-C6-SCOPE-PHASE-SOURCE-ARCHIVE-RUNTIME/v1'});assert.deepEqual(old,[]);
});
test('old record families, mismatched image pairs and recast compiled source roles refuse',()=>{
 for(const change of [c=>{c.matchedNode.record.relative='native-link/c6-original-record.json';},c=>{c.matchedNode.record.sha256='e'.repeat(64);},c=>{c.matchedNode.image.sha256='4'.repeat(64);},c=>{c.matchedNode.sourceRoles.originalFiniteNAPIProducer=c.roles.CocoaCPPBase;},c=>{c.roles.CocoaCompiledSDK=c.matchedNode.sourceRoles.projectControlSource;},c=>{c.NativeBuildOrRelinkRequested=true;}]){const c=matched();change(c);assert.throws(()=>matchedNodePackageSourceRoles(c),/separate matched Node/);}
 const r={sourceVariant:CONTROL_MATCHED_VARIANT,...matchedNodePackageSourceRoles(matched())};r.matchedNodeImage.sha256='0'.repeat(64);assert.throws(()=>addMatchedNodeSBOMComponent([],r));
});
test('current SBOM uses exact verified original plan and explicit source roles rather than legacy36',()=>{assert.doesNotThrow(()=>assertNativeSBOMSourceShape(native(),current,plan(),roles()));assert.throws(()=>assertNativeSBOMSourceShape(native(),current));});
test('wrong count, unverified roles and substituted compiled source remain refused',()=>{for(const change of [f=>f.n.objects=57,f=>f.r.originalNativeReceiptsPreserved=false,f=>f.p.compiledSource.commit='e'.repeat(40),f=>f.r.SDKResourceSourceCommit='f'.repeat(40)]){const f={n:native(),p:plan(),r:roles()};change(f);assert.throws(()=>assertNativeSBOMSourceShape(f.n,current,f.p,f.r));}assert.doesNotThrow(()=>assertNativeSBOMSourceShape({...native(),sourceCommit:current,objects:36},current));});

function c6(){
 const commands=[{name:'strict-link'},{name:'relative-ssl'},{name:'relative-crypto'}],cocoa={qualifiedObjects:Array.from({length:11},()=>({})),retainedRootObjects:[{},{}],objectCount:13,commands,sourceRoles:{CPP:compiled}};
 return {n:{...native(),sourceCommit:current,sourceVariant:'C6_DIAGNOSTIC_NORMAL_PRODUCT',objects:13,commandCount:3},p:{schema:'YNX_IDE_C6_PRODUCT_PLAN/v1',variant:'C6_DIAGNOSTIC_NORMAL_PRODUCT',sourceCommit:current,SDKSourceCommit:sdk,objectCount:13,commands,CocoaPlan:cocoa},r:{...roles(),assembledSourceCommit:current}};
}
test('C6 SBOM preserves distinct object and executed-command counts with exact verified source roles',()=>{
 const f=c6();assert.doesNotThrow(()=>assertNativeSBOMSourceShape(f.n,current,f.p,f.r));
});
test('C6 SBOM refuses legacy counts, substituted source roles and a changed object or command roster',()=>{
 for(const change of [f=>{f.n.objects=3;},f=>{f.n.commandCount=13;},f=>{f.p.CocoaPlan.qualifiedObjects.pop();},f=>{f.p.CocoaPlan.retainedRootObjects.pop();},f=>{f.p.CocoaPlan={...f.p.CocoaPlan,commands:[]};},f=>{f.p.sourceCommit=base;},f=>{f.r.assembledSourceCommit=base;},f=>{f.r.compiledNativeSourceCommit=sdk;},f=>{f.p.SDKSourceCommit=compiled;},f=>{f.r.originalNativeReceiptsPreserved=false;},f=>{f.p.schema='PUBLIC_UNREVIEWED';},f=>{f.p.variant='PUBLIC_OTHER';}]){
  const f=c6();change(f);assert.throws(()=>assertNativeSBOMSourceShape(f.n,current,f.p,f.r),/C6 native SBOM/);
 }
});

test('resource-only C6 SBOM keeps 13 objects and zero new commands with original compiled SDK custody',()=>{
 const make=()=>{const f=c6();f.p.commands=[];f.n.commandCount=0;f.p.reusedCocoaExecution={path:'/PUBLIC/r11/receipt.json',bytes:1,sha256:'a'.repeat(64)};f.r.compiledCocoaReceipt=structuredClone(f.p.reusedCocoaExecution);f.r.compiledSDKSourceCommit='98956ed2bbac8bb5c86de83c4f1df24314e19bf0';return f;};
 const valid=make();assert.doesNotThrow(()=>assertNativeSBOMSourceShape(valid.n,current,valid.p,valid.r));
 for(const change of [f=>{f.n.commandCount=3;},f=>{f.p.commands.push({name:'strict-link'});},f=>{f.r.compiledSDKSourceCommit=sdk;},f=>{f.r.compiledCocoaReceipt.sha256='b'.repeat(64);},f=>{f.p.CocoaPlan.commands=[];}]){const f=make();change(f);assert.throws(()=>assertNativeSBOMSourceShape(f.n,current,f.p,f.r),/C6 native SBOM/);}
});

function r21(){
 const original=matchedNodePackageSourceRoles(matched());
 const sourceRoles={compiledCocoaApplication:base,compiledCocoaApplicationTree:compiled,compiledCocoaSDK:original.CocoaCompiledSDK,compiledCocoaCPP:original.compiledCocoaNativeSourceCommit,SDKResource:original.matchedNodeSourceRoles.projectControlSource,NodeComposite:original.matchedNodeSourceRoles};
 const pin=(name,index)=>({path:'/PUBLIC/build/'+name,bytes:1024+index,sha256:index.toString(16).padStart(64,'0')});
 const main=pin('main.m.o',40),archive=pin('libynx_artifact_release.a',41),parent=pin('ynx-wallet-admission-parent.m.o',42);
 const fixed=[1,10,11,12,13,14,18,19,22,24,25].map(i=>pin('original-auth-common.arm64.'+i+'.o',i));
 const retained=[...fixed,parent,archive],archivePath='packages/wallet-auth/native/vendor/link/libynx_artifact_release.a';
 const cocoaExecution=pin('cocoa-execution.json',43),output=pin('UNINSTALLED.app/Contents/MacOS/YNXDeveloper',44);
 const commands=[
  {name:'compile-new-main',argv:['/usr/bin/clang','-c','main.m','-o',main.path]},
  {name:'strict-c6-Cocoa-napi-free-closure-relink',argv:['/usr/bin/xcrun','swiftc',...fixed.map(x=>x.path),main.path,parent.path,archive.path,'-o',output.path]},
  {name:'normal-c6-Cocoa-relative-libssl.3.dylib',argv:['/usr/bin/install_name_tool','-change','/PUBLIC/libssl.3.dylib','@rpath/libssl.3.dylib',output.path]},
  {name:'normal-c6-Cocoa-relative-libcrypto.3.dylib',argv:['/usr/bin/install_name_tool','-change','/PUBLIC/libcrypto.3.dylib','@rpath/libcrypto.3.dylib',output.path]}
 ];
 const n={...native(),sourceCommit:current,sourceVariant:'R21_COCOA_SUCCESSOR_NORMAL_PRODUCT',SDKSourceCommit:sourceRoles.SDKResource,objects:13,commandCount:0,linkedBinarySHA256BeforeAdhocSigning:output.sha256,originalCoreArchives:[{path:archivePath,bytes:archive.bytes,sha256:archive.sha256}]};
 const p={schema:'YNX_IDE_R21_COCOA_PRODUCT_PLAN/v1',variant:n.sourceVariant,sourceCommit:current,SDKSourceCommit:n.SDKSourceCommit,commands:[],compiledCommands:commands,sourceRoles,objectCount:13,retainedLinkInputs:retained,mainObject:main,inputs:[{...archive,relativePath:archivePath}],cocoaExecution};
 const e={sourceCommit:current,complete:true,ownedUndefined:[],binarySHA256:output.sha256,sourceRoles,cocoaExecution};
 const r={...original,sourceVariant:CONTROL_MATCHED_VARIANT,applicationSourceCommit:current,assembledSourceCommit:current,compiledNativeSourceCommit:sourceRoles.compiledCocoaCPP,compiledCocoaApplication:base,compiledCocoaApplicationTree:compiled,compiledSDKSourceCommit:sourceRoles.compiledCocoaSDK,compiledCocoaReceipt:cocoaExecution,SDKResourceSourceCommit:sourceRoles.SDKResource,originalNativeReceiptsPreserved:true};
 const actual={schema:'YNX_IDE_R21_COCOA_EXECUTION/v1',sourceCommit:base,sourceTree:compiled,sourceRoles,retainedLinkInputs:retained,mainObject:main,commands,results:commands.map(({name})=>({name,status:0,signal:null})),complete:true,error:null,output};
 return {n:structuredClone(n),p:structuredClone(p),r:structuredClone(r),e:structuredClone(e),actual:structuredClone(actual)};
}
const assertR21=f=>assertNativeSBOMSourceShape(f.n,current,f.p,f.r,f.e,f.actual);
test('R22 keeps the same roster and refuses an R21 Cocoa receipt',()=>{
 const f=r21();
 f.n.sourceVariant=f.p.variant='R22_COCOA_SUCCESSOR_NORMAL_PRODUCT';
 f.p.schema='YNX_IDE_R22_COCOA_PRODUCT_PLAN/v1';
 assert.throws(()=>assertR21(f),/Cocoa SBOM/);
 f.actual.schema='YNX_IDE_R22_COCOA_EXECUTION/v1';
 assert.doesNotThrow(()=>assertR21(f));
});
test('R21 keeps 13 linked objects, the Go archive, four proven Cocoa commands and no assembly compiler work',()=>{
 const f=r21();assert.doesNotThrow(()=>assertR21(f));
 const components=[];addMatchedNodeSBOMComponent(components,f.r);
 assert.equal(components.length,1);assert.equal(components[0].hashes[0].content,f.r.matchedNodeImage.sha256);
 assert.ok(components[0].properties.some(({name,value})=>name==='ynx:inheritedCocoaCompiledSDK'&&value===f.actual.sourceRoles.compiledCocoaSDK));
});
test('R21 rejects substitutions in the linked roster, original receipt, and separate Cocoa/SDK/Node identities',()=>{
 const mutations=[
  f=>{f.n.objects=14;},f=>{f.n.commandCount=4;},f=>{f.p.commands=f.p.compiledCommands;},
  f=>{f.n.originalCoreArchives.pop();},f=>{f.n.originalCoreArchives[0].bytes++;},
  f=>{f.p.retainedLinkInputs[11].sha256='9'.repeat(64);},
  f=>{f.p.mainObject.path=f.p.retainedLinkInputs[11].path;},f=>{f.p.compiledCommands.reverse();},
  f=>{f.e.cocoaExecution.sha256='9'.repeat(64);},f=>{f.e.ownedUndefined=['_napi_get_cb_info'];},
  f=>{f.n.linkedBinarySHA256BeforeAdhocSigning='9'.repeat(64);},f=>{f.actual.results[2].status=1;},
  f=>{f.r.compiledCocoaApplication=current;},f=>{f.r.compiledCocoaApplicationTree=base;},f=>{f.r.compiledSDKSourceCommit=f.n.SDKSourceCommit;},
  f=>{f.r.matchedNodeSourceRoles.originalFiniteNAPIProducer=base;},f=>{f.r.sourceVariant='PUBLIC_OTHER';},
  f=>{const rows=f.actual.retainedLinkInputs;[rows[1],rows[2]]=[rows[2],rows[1]];f.p.retainedLinkInputs=structuredClone(rows);},
  f=>{f.actual.commands[1].argv.splice(3,0,'/PUBLIC/extra.o');f.p.compiledCommands=structuredClone(f.actual.commands);}
 ];
 for(const mutate of mutations){const f=r21();mutate(f);assert.throws(()=>assertR21(f),/R21 Cocoa SBOM/);}
 assert.throws(()=>assertNativeSBOMSourceShape({...r21().n,objects:36},current),/R21 Cocoa SBOM/);
});

test('579 SBOM accepts its actual pinned preflight-schema execution receipt and rejects changed roles',()=>{
 const f=r21();
 f.n.sourceVariant='R579_COCOA_SUCCESSOR_NORMAL_PRODUCT';
 f.p.variant=f.n.sourceVariant;
 f.p.schema='YNX_IDE_579_COCOA_PRODUCT_PLAN/v1';
 f.actual.schema='YNX_IDE_579_COCOA_INPUT_PREFLIGHT/v1';
 f.actual.roles=f.actual.sourceRoles;
 delete f.actual.sourceRoles;
 assert.doesNotThrow(()=>assertR21(f));
 f.actual.roles={...f.actual.roles,SDKResource:'f'.repeat(40)};
 assert.throws(()=>assertR21(f),/R21 Cocoa SBOM/);
});

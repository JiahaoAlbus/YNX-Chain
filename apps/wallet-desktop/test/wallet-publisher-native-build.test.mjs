import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {composeWalletPublisherNativeBuildPlan,SDK13_NODE_TRANSLATION_UNITS,WALLET_PUBLISHER_NATIVE_INPUTS,walletPublisherNativeInputs,WALLET_ARTIFACT_CABI_INPUTS,WALLET_ARTIFACT_CABI_FLAG,WALLET_PROJECT_CONTROL_INPUTS,WALLET_PROJECT_CONTROL_FLAG,walletNativeSourceProfile} from '../scripts/wallet-publisher-native-build.mjs';
import {sdkRuntimeUnionProfile} from '../scripts/sdk14-runtime-union.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS,verifyCanonicalNativeReceipt,PINNED_NODE_HEADER_PINS} from '../scripts/canonical-package.mjs';
const inventoryBytes=readFileSync(new URL('./fixtures/auth13-native-inventory.json',import.meta.url)),inventory=JSON.parse(inventoryBytes),repo='/PUBLIC/source',headers='/PUBLIC/headers';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('SDK23 selects its own frozen82-input source and9342-file runtime, never SDK20 qualification',()=>{
 const profile=walletNativeSourceProfile('1.3.0-pq.3.32-auth.23');assert.equal(profile.supplierNodeInputs,82);assert.equal(profile.inventory.sha256,'aafecb4804cdbe1c4c23cb8931cb495215142ec25d6890f5e8d850220da8b89c');
 const runtime=sdkRuntimeUnionProfile(profile.version);assert.equal(runtime.files,9342);assert.equal(runtime.sha256,'dc4427a01bad707eaae9861b92e22b251dc83ac3d2b9535b576b162df1e60b84');
 const plan=composeWalletPublisherNativeBuildPlan(originalPlan(),repo,82,false,true);assert.equal(plan.sources.length,16);assert(plan.commands[0].argv.includes(WALLET_PROJECT_CONTROL_FLAG));assert.equal(plan.walletInputFiles.length,8);
 assert.throws(()=>composeWalletPublisherNativeBuildPlan(originalPlan(),repo,82,true,true),/SDK20_REQUIRED/); // old artifact archive is NOT the new CONTROL archive
});
test('actual SDK23 inventory and canonical receipt use the supplied unchanged82 leaves',{skip:!process.env.WALLET_CONTROL_CABI_SDK_RUNTIME},()=>{
 const invBytes=readFileSync(path.join(process.env.WALLET_CONTROL_CABI_SDK_RUNTIME,'integration/SDK332_R140_NATIVE_COMPATIBILITY.json')),inv=JSON.parse(invBytes),wallet=walletPublisherNativeInputs(82,false,true),rows=[...inv.NativeInputs,...wallet],names=[...rows.map(p=>p.path),...inv.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],pins=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 assert.equal(canonicalNativeInputSelection(inv.version,names,invBytes,pins).inputs.length,90);const changed=Buffer.from(invBytes);changed[0]^=1;assert.throws(()=>canonicalNativeInputSelection(inv.version,names,changed,pins));
});
function originalPlan(universal=false){
 const output=path.join(repo,'apps/wallet-desktop/native/original-auth-identity.node'),sources=SDK13_NODE_TRANSLATION_UNITS.map(n=>path.join(repo,n)),arches=universal?['arm64','x64']:['arm64'];
 const commands=arches.map(arch=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min=13.0','-I'+headers,'-I'+path.join(repo,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security','-framework','AppKit','-framework','ServiceManagement','-lbsm','-arch',arch==='x64'?'x86_64':arch,...sources,'-o',output+(universal?'.'+arch:'')]}));
 if(universal)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});
 return {sources,output,outputs:[output],commands,minimumSystemVersion:'13.0'};
}
test('explicit control role closes all five input pins and adds only two Main TUs',()=>{
 const plan=composeWalletPublisherNativeBuildPlan(originalPlan(),repo,77,false,true);
 assert.equal(plan.sources.length,16);assert.equal(plan.commands[0].argv[0],WALLET_PROJECT_CONTROL_FLAG);
 const invBytes=readFileSync(new URL('./fixtures/auth20-native-inventory.json',import.meta.url)),inv=JSON.parse(invBytes),wallet=walletPublisherNativeInputs(77,false,true),rows=[...inv.NativeInputs,...wallet],names=[...rows.map(p=>p.path),...inv.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],pins=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 assert.equal(canonicalNativeInputSelection(inv.version,names,invBytes,pins).inputs.length,85);
 for(const pin of WALLET_PROJECT_CONTROL_INPUTS){const b=readFileSync(new URL('../'+pin.path.replace('apps/wallet-desktop/',''),import.meta.url));assert.equal(b.length,pin.bytes);assert.equal(hash(b),pin.sha256);assert.throws(()=>canonicalNativeInputSelection(inv.version,names.filter(n=>n!==pin.path),invBytes,pins));}
 assert.throws(()=>walletPublisherNativeInputs(76,false,true),/MATCHED_SDK20/);assert(!composeWalletPublisherNativeBuildPlan(originalPlan(),repo,77).commands[0].argv.includes(WALLET_PROJECT_CONTROL_FLAG));
});
test('Wallet adds exactly one user-addon TU and LocalAuthentication, preserving original supplier plan bytes',()=>{
 for(const universal of [false,true]){
  const original=originalPlan(universal),before=structuredClone(original),plan=composeWalletPublisherNativeBuildPlan(original,repo);
  assert.deepEqual(original,before);assert.equal(plan.sources.length,14);assert.equal(plan.supplierNodeInputCount,69);
  assert.equal(plan.sources.at(-1),path.join(repo,WALLET_PUBLISHER_NATIVE_INPUTS[1].path));
  for(const command of plan.commands.filter(c=>c.tool==='/usr/bin/clang++'))assert.equal(command.argv.filter(x=>x==='LocalAuthentication').length,1);
  if(universal)assert.deepEqual(plan.commands.at(-1),original.commands.at(-1));
  assert.equal(plan.nativeGrant,false);assert.equal(plan.approval,false);
 }
});
test('partial, duplicated, already-extended or different supplier plans cannot be silently combined',()=>{
 for(const mutate of [p=>p.sources.pop(),p=>p.commands[0].argv.splice(p.commands[0].argv.indexOf('-o'),0,p.sources[0]),p=>p.commands[0].argv.push('LocalAuthentication'),p=>{p.minimumSystemVersion='12.0';},p=>{p.output+='.other';}]){
  const plan=originalPlan();mutate(plan);assert.throws(()=>composeWalletPublisherNativeBuildPlan(plan,repo),/PLAN_MISMATCH/);
 }
});
test('explicit artifact role links fixed original library only in arm64 SDK20 user component',()=>{
 const source=originalPlan(),before=structuredClone(source),p=composeWalletPublisherNativeBuildPlan(source,repo,77,true);
 assert.deepEqual(source,before);assert.equal(p.walletInputFiles.length,6);
 const argv=p.commands[0].argv;
 assert.equal(argv.filter(v=>v==='-DYNX_ORIGINAL_WALLET_ARTIFACT_CABI=1').length,1);
 assert.equal(argv.filter(v=>v===path.join(repo,'apps/wallet-desktop/native/libynx_artifact_release.a')).length,1);
 assert(argv.includes('-I'+path.join(repo,'apps/wallet-desktop/native')));
 assert.throws(()=>composeWalletPublisherNativeBuildPlan(originalPlan(true),repo,77,true),/ARCHITECTURE/);
 assert.throws(()=>composeWalletPublisherNativeBuildPlan(originalPlan(),repo,76,true),/SDK20/);
});
test('69 supplier inputs and2 separately pinned Wallet inputs cannot replace or authorize one another',()=>{
 const helper=inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),rows=[...inventory.NativeInputs,...WALLET_PUBLISHER_NATIVE_INPUTS];
 const names=[...rows.map(p=>p.path),...helper,...CANONICAL_NATIVE_EVIDENCE_TESTS],receipt=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 const result=canonicalNativeInputSelection(inventory.version,names,inventoryBytes,receipt);
 assert.equal(result.inputs.length,71);assert.equal(result.supplierNodeInputCount,69);assert.equal(result.pairedInputCount,74);assert.deepEqual(result.walletInputs,WALLET_PUBLISHER_NATIVE_INPUTS);
 const changed=structuredClone(receipt);changed.at(-1).sha256='0'.repeat(64);
 for(const bad of [changed,receipt.slice(0,69)])assert.throws(()=>canonicalNativeInputSelection(inventory.version,names,inventoryBytes,bad),/inventory differs/);
 assert.throws(()=>canonicalNativeInputSelection(inventory.version,names.filter(n=>n!==WALLET_PUBLISHER_NATIVE_INPUTS[0].path),inventoryBytes,receipt),/inventory differs/);
});
function publicReceipt(universal){
 // PUBLIC shape/command test only: these stand-ins are never compiled/loaded.
 const plan=composeWalletPublisherNativeBuildPlan(originalPlan(universal),repo),inputs=[...inventory.NativeInputs,...WALLET_PUBLISHER_NATIVE_INPUTS].map(p=>p.path),data=new Map(inputs.map(n=>[n,Buffer.from('// PUBLIC '+n)])),module=Buffer.from('PUBLIC module, not Mach-O');
 const pin=(relative,b)=>({relative,bytes:b.length,sha256:hash(b)});
 const receipt={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0',readbackOnly:true,commandsKind:'normal-build-plan',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:repo,headerRoot:headers,inputFiles:inputs.map(n=>pin(n,data.get(n))),headers:PINNED_NODE_HEADER_PINS,architectures:universal?['arm64','x86_64']:['arm64'],commands:plan.commands,output:pin('apps/wallet-desktop/native/original-auth-identity.node',module)};
 return {receipt,run:()=>verifyCanonicalNativeReceipt(receipt,module,inputs,n=>data.get(n))};
}
test('receipt verifies all14 TUs and frameworks on arm64/universal without implying Native qualification',()=>{
 for(const universal of [false,true]){const result=publicReceipt(universal).run();assert.equal(result.pinsVerified,true);assert.equal(result.nativeQualified,false);assert.equal(result.readbackOnly,true);}
});
test('receipt rejects omitted store TU, missing framework, altered ordering and duplicate compilation',()=>{
 for(const mode of ['store','framework','reorder','duplicate']){
  const f=publicReceipt(false),argv=f.receipt.commands[0].argv,index=argv.findIndex(s=>s.endsWith('/original-artifact-publisher-store.mm'));
  if(mode==='store')argv.splice(index,1);
  if(mode==='framework')argv.splice(argv.indexOf('LocalAuthentication')-1,2);
  if(mode==='reorder')[argv[index],argv[index-1]]=[argv[index-1],argv[index]];
  if(mode==='duplicate')argv.splice(index,0,argv[index]);
  assert.throws(f.run,/receipt or input pins differ/);
 }
});
test('explicit CABI closure and exact receipt reject partial inputs, modified pins, missing role or archive',{skip:!process.env.WALLET_ARTIFACT_CABI_DELIVERY?'requires original qualified Protocol archive/header':false},()=>{
 const invBytes=readFileSync(new URL('./fixtures/auth20-native-inventory.json',import.meta.url)),inv=JSON.parse(invBytes),wallet=walletPublisherNativeInputs(77,true);
 const rows=[...inv.NativeInputs,...wallet],inputs=rows.map(p=>p.path),names=[...inputs,...inv.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS];
 const pinned=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 assert.equal(canonicalNativeInputSelection(inv.version,names,invBytes,pinned).inputs.length,83);
 for(const p of WALLET_ARTIFACT_CABI_INPUTS){assert.throws(()=>canonicalNativeInputSelection(inv.version,names.filter(n=>n!==p.path),invBytes,pinned));}
 const badPins=structuredClone(pinned);badPins.at(-1).sha256='0'.repeat(64);assert.throws(()=>canonicalNativeInputSelection(inv.version,names,invBytes,badPins));
 // Only the receipt command/closure is PUBLIC. The three CABI inputs are
 // actual pinned bytes, not substituted dummy archive/header claims.
 const data=new Map(inputs.map(n=>[n,Buffer.from('// PUBLIC source '+n)]));
 for(const p of WALLET_ARTIFACT_CABI_INPUTS){const b=readFileSync(p.path.endsWith('original-artifact-publisher-cabi.h')?new URL('../native/original-artifact-publisher-cabi.h',import.meta.url):path.join(process.env.WALLET_ARTIFACT_CABI_DELIVERY,path.basename(p.path)));assert.equal(b.length,p.bytes);assert.equal(hash(b),p.sha256);data.set(p.path,b);}
 const make=()=>{
  const module=Buffer.from('PUBLIC not a compiled module'),plan=composeWalletPublisherNativeBuildPlan(originalPlan(),repo,77,true);
  const receipt={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0',readbackOnly:true,commandsKind:'normal-build-plan',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:repo,headerRoot:headers,inputFiles:inputs.map(n=>({relative:n,bytes:data.get(n).length,sha256:hash(data.get(n))})),headers:PINNED_NODE_HEADER_PINS,architectures:['arm64'],commands:plan.commands,output:{relative:'apps/wallet-desktop/native/original-auth-identity.node',bytes:module.length,sha256:hash(module)}};
  return {receipt,run:()=>verifyCanonicalNativeReceipt(receipt,module,inputs,n=>data.get(n))};
 };
 assert.equal(make().run().pinsVerified,true);
 for(const mode of ['flag','archive','include','arch','pin','helperFlag']){
  const f=make(),argv=f.receipt.commands[0].argv;
  if(mode==='flag')argv.splice(argv.indexOf(WALLET_ARTIFACT_CABI_FLAG),1);
  if(mode==='archive')argv.splice(argv.indexOf(path.join(repo,WALLET_ARTIFACT_CABI_INPUTS[2].path)),1);
  if(mode==='include')argv.splice(argv.indexOf('-I'+path.join(repo,'apps/wallet-desktop/native')),1);
  if(mode==='arch')f.receipt.architectures=['x86_64'];
  if(mode==='pin')f.receipt.inputFiles.at(-1).sha256='0'.repeat(64);
  if(mode==='helperFlag')argv.push('-DYNX_ORIGINAL_WALLET_ARTIFACT_CABI=0');
  assert.throws(f.run,/receipt or input pins differ/);
 }
});

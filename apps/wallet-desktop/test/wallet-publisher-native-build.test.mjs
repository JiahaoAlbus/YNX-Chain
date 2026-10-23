import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {composeWalletPublisherNativeBuildPlan,SDK13_NODE_TRANSLATION_UNITS,WALLET_PUBLISHER_NATIVE_INPUTS} from '../scripts/wallet-publisher-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS,verifyCanonicalNativeReceipt,PINNED_NODE_HEADER_PINS} from '../scripts/canonical-package.mjs';
const inventoryBytes=readFileSync(new URL('./fixtures/auth13-native-inventory.json',import.meta.url)),inventory=JSON.parse(inventoryBytes),repo='/PUBLIC/source',headers='/PUBLIC/headers';
const hash=b=>createHash('sha256').update(b).digest('hex');
function originalPlan(universal=false){
 const output=path.join(repo,'apps/wallet-desktop/native/original-auth-identity.node'),sources=SDK13_NODE_TRANSLATION_UNITS.map(n=>path.join(repo,n)),arches=universal?['arm64','x64']:['arm64'];
 const commands=arches.map(arch=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min=13.0','-I'+headers,'-I'+path.join(repo,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security','-framework','AppKit','-framework','ServiceManagement','-lbsm','-arch',arch==='x64'?'x86_64':arch,...sources,'-o',output+(universal?'.'+arch:'')]}));
 if(universal)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});
 return {sources,output,outputs:[output],commands,minimumSystemVersion:'13.0'};
}
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

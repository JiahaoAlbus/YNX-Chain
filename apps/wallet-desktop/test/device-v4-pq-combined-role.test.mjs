import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFileSync,mkdtempSync,realpathSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {walletNativeComponentBuildPlan} from '../scripts/build-wallet-native-component.mjs';
import {deviceV4PQSupplierInputs} from '../scripts/wallet-device-v4-pq-role.mjs';
import {canonicalNativeInputSelection,verifyCanonicalNativeReceipt,CANONICAL_NATIVE_EVIDENCE_TESTS,PINNED_NODE_HEADER_PINS} from '../scripts/canonical-package.mjs';
import {originalAuthNativeBuildPlan} from '../scripts/build-original-auth-identity-native.mjs';
import {composeWalletPublisherNativeBuildPlan} from '../scripts/wallet-publisher-native-build.mjs';
import {PQ_NATIVE_ARCHIVE,PQ_NATIVE_SOURCE} from '../scripts/wallet-pq-native-build.mjs';
import {composeDeviceV4PQCommands,deviceV4PQReceiptCommands,deviceV4PQWalletInputs,assertWalletPendingNativeExports,DEVICE_V4_PQ_ROLE,DEVICE_V4_PQ_PROTOCOL_INPUTS,DEVICE_V4_PENDING_PQ_ROLE,DEVICE_V4_PENDING_PQ_PROTOCOL_INPUTS,DEVICE_V4_PENDING_PQ_NODE} from '../scripts/wallet-device-v4-pq-role.mjs';
const repo=path.resolve(fileURLToPath(new URL('../../..',import.meta.url))),headers='/PUBLIC-plan-only-headers';
// Frozen ordinary R2 command DATA supplies the unchanged TX/initial callers.
// This test constructs recipes only: no compiler, Native, key or account use.
const legacy=()=>composeWalletPublisherNativeBuildPlan(originalAuthNativeBuildPlan('arm64',headers),repo,100,true,true,true,true);
function pendingSource(t){
 const target=realpathSync(mkdtempSync(path.join(tmpdir(),'ynx-wallet-pending-role-')));t.after(()=>rmSync(target,{recursive:true,force:true}));
 const protocol=path.join(repo,'apps/wallet-desktop/native/device-v4-pending-protocol');
 const supplied=repo;
 const copy=(from,name)=>{mkdirSync(path.dirname(path.join(target,name)),{recursive:true});copyFileSync(from,path.join(target,name));};
 for(const pin of DEVICE_V4_PENDING_PQ_PROTOCOL_INPUTS)copy(path.join(protocol,path.basename(pin.path)),pin.path);
 for(const name of ['original-product-device-v4-factory.mm','original-product-device-v4-slot.mm','product-device-v4-e5.c'])copy(path.join(repo,'apps/wallet-desktop/native',name),'apps/wallet-desktop/native/'+name);
 for(const name of ['original-product-device-v4-pending-custody.mm','original-product-device-v4-typed-producer.mm'])copy(path.join(supplied,'apps/wallet-desktop/native',name),'apps/wallet-desktop/native/'+name);
 return target;
}
test('pending normal successor keeps SOURCE and HTTP with PENDING and links the same ordinary a59 archive once',t=>{
 // Original public suppliers, recipe controls only. No compiler, key, Source,
 // installed account, or proof producer is invoked by this test.
 const target=pendingSource(t),old=legacy();
 const base=old.pqNativeBaseCommands.map(c=>({...c,argv:c.argv.map(a=>a.replaceAll(repo,target))}));
 const plan=composeDeviceV4PQCommands(base,target,headers,true),link=plan.commands.at(-1);
 assert.equal(plan.commands.length,25);assert.equal(plan.commands.filter(c=>c.tool==='/usr/bin/clang++').length,22);
 for(const command of plan.commands.filter(c=>c.tool==='/usr/bin/clang++'))for(const flag of ['SOURCE','HTTP_PRODUCER','PENDING'])assert(command.argv.includes('-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_'+flag+'_STAGE'));
 assert.deepEqual(link.argv.filter(a=>a.endsWith('.a')),[path.join(target,DEVICE_V4_PENDING_PQ_PROTOCOL_INPUTS[0].path)]);
 assert.equal(DEVICE_V4_PENDING_PQ_PROTOCOL_INPUTS[0].sha256,PQ_NATIVE_ARCHIVE.sha256);
 const wallet=deviceV4PQWalletInputs(old.walletInputFiles,true);assert(wallet.some(p=>p.path===PQ_NATIVE_SOURCE.path));assert.equal(wallet.filter(p=>p.path.endsWith('.a')).length,1);
 const receipt={deviceV4PQRole:DEVICE_V4_PENDING_PQ_ROLE,architectures:['arm64'],sourceRoot:target,headerRoot:headers,pqNativeBaseCommands:base,commands:plan.commands};
 assert.deepEqual(deviceV4PQReceiptCommands(receipt),base);
 for(const mode of ['missingHTTP','missingPending','twoArchives','wrongRole']){
  const wrong=structuredClone(receipt);
  if(mode==='missingHTTP'||mode==='missingPending')wrong.commands.find(c=>c.tool==='/usr/bin/clang++').argv=wrong.commands.find(c=>c.tool==='/usr/bin/clang++').argv.filter(a=>a!=='-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_'+(mode==='missingHTTP'?'HTTP_PRODUCER':'PENDING')+'_STAGE');
  if(mode==='twoArchives')wrong.commands.at(-1).argv.push(path.join(target,PQ_NATIVE_ARCHIVE.path));
  if(mode==='wrongRole')wrong.deviceV4PQRole=DEVICE_V4_PQ_ROLE;
  assert.throws(()=>deviceV4PQReceiptCommands(wrong));
 }
});
test('pending supplier role selects the exact separate Main62782 body and rejects body or count substitution',()=>{
 const source=repo;
 const inventory=JSON.parse(readFileSync(path.join(source,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json')));
 const selected=deviceV4PQSupplierInputs(inventory.NativeInputs);assert.equal(selected.length,127);assert.deepEqual(selected.find(p=>p.path===DEVICE_V4_PENDING_PQ_NODE.path),DEVICE_V4_PENDING_PQ_NODE);
 const changed=inventory.NativeInputs.map(p=>p.path===DEVICE_V4_PENDING_PQ_NODE.path?DEVICE_V4_PENDING_PQ_NODE:p);
 assert.throws(()=>deviceV4PQSupplierInputs(changed));assert.throws(()=>deviceV4PQSupplierInputs(inventory.NativeInputs.slice(1)));
});
test('pending normal export readback requires funds TX and initial plus all three separate device purposes',()=>{
 const names=['YNXTransactionBatchSignV1','YNXAccountInitialSignV1','YNXProductSessionHTTPProofSignV4','YNXProductSessionDeviceRegistrationSignV4','YNXProductSessionDeviceChallengeSignV4'];
 const symbols=names.map(n=>'0000000000000001 T _'+n);
 assert.equal(assertWalletPendingNativeExports(symbols.join('\n')),undefined);
 for(const omitted of names)assert.throws(()=>assertWalletPendingNativeExports(symbols.filter(line=>!line.endsWith('_'+omitted)).join('\n')));
 assert.throws(()=>assertWalletPendingNativeExports(symbols.join('\n').replaceAll(' T ',' U ')));
});
test('combined successor links b0 once after E5 C11 and twenty C++ objects, never two Go archives',()=>{
 const old=legacy(),before=JSON.stringify(old),p=composeDeviceV4PQCommands(old.pqNativeBaseCommands,repo,headers),link=p.commands.at(-1);
 assert.equal(p.commands.length,23);assert.equal(p.commands.filter(c=>c.tool==='/usr/bin/clang++').length,20);
 assert.equal(p.commands[0].tool,'/usr/bin/clang');assert(p.commands[0].argv.includes('-std=c11'));assert(!p.commands[0].argv.includes('-fobjc-arc'));
 assert.deepEqual(link.argv.filter(a=>a.endsWith('.a')),[path.join(repo,DEVICE_V4_PQ_PROTOCOL_INPUTS[0].path)]);
 assert(!link.argv.includes(path.join(repo,PQ_NATIVE_ARCHIVE.path)));assert.equal(link.argv.filter(a=>a.endsWith('.o')).length,22);
 for(const c of p.commands.filter(c=>c.tool==='/usr/bin/clang++'))for(const flag of ['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_SOURCE_STAGE','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE','-DYNX_ORIGINAL_WALLET_NATIVE_PQ_CUSTODY=1'])assert(c.argv.includes(flag));
 assert.equal(new Set(p.intermediateOutputs).size,22);assert.equal(JSON.stringify(old),before);assert.equal(p.nativeGrant,false);
});
test('new receipt exactly replays combined commands and rejects old, changed or duplicate-archive claims',()=>{
 const old=legacy(),p=composeDeviceV4PQCommands(old.pqNativeBaseCommands,repo,headers),receipt={deviceV4PQRole:DEVICE_V4_PQ_ROLE,architectures:['arm64'],sourceRoot:repo,headerRoot:headers,pqNativeBaseCommands:old.pqNativeBaseCommands,commands:p.commands};
 assert.deepEqual(deviceV4PQReceiptCommands(receipt),old.pqNativeBaseCommands);
 for(const mode of ['old-commands','two-archives','old-role','wrong-arch']){
  const bad=structuredClone(receipt);if(mode==='old-commands')bad.commands=old.commands;
  if(mode==='two-archives')bad.commands.at(-1).argv.splice(-2,0,path.join(repo,PQ_NATIVE_ARCHIVE.path));
  if(mode==='old-role')bad.deviceV4PQRole=old.pqNativeRole;
  if(mode==='wrong-arch')bad.architectures=['x86_64'];
  assert.throws(()=>deviceV4PQReceiptCommands(bad),/COMBINED_ROLE_DIFFERS/);
 }
});
test('input role replaces old archive and SOURCE, keeps old caller manifest but never mutates old role',()=>{
 const old=legacy(),before=JSON.stringify(old.walletInputFiles),pins=deviceV4PQWalletInputs(old.walletInputFiles);
 assert(!pins.some(p=>p.path===PQ_NATIVE_ARCHIVE.path||p.path===PQ_NATIVE_SOURCE.path));assert.equal(pins.filter(p=>p.path.endsWith('.a')).length,1);
 for(const pin of DEVICE_V4_PQ_PROTOCOL_INPUTS)assert(pins.includes(pin));
 assert.equal(JSON.stringify(old.walletInputFiles),before);assert.throws(()=>deviceV4PQWalletInputs(pins),/COMBINED_ROLE_DIFFERS/);
});
test('already-device or PUBLIC_TEST base cannot be stacked into the normal combined role',()=>{
 for(const flag of ['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_SOURCE_STAGE','-DYNX_PRODUCT_DEVICE_V4_FACTORY_PUBLIC_TEST']){
  const old=legacy(),base=structuredClone(old.pqNativeBaseCommands);base[0].argv.unshift(flag);assert.throws(()=>composeDeviceV4PQCommands(base,repo,headers),/COMBINED_ROLE_DIFFERS/);
 }
});
test('actual normal entry selects127 supplier and matching Wallet inputs with a plan-only canonical receipt, not old Native',()=>{
 const raw=readFileSync(path.join(repo,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json')),inventory=JSON.parse(raw),plan=walletNativeComponentBuildPlan('arm64',headers,true,true,true,true,false,true);
 const pins=[...deviceV4PQSupplierInputs(inventory.NativeInputs),...plan.walletInputFiles],inputs=pins.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 assert.equal(inventory.NativeInputs.length,127);assert.equal(pins.length,153);for(const p of pins){const b=readFileSync(path.join(repo,p.path));assert.equal(b.length,p.bytes,p.path);assert.equal(createHash('sha256').update(b).digest('hex'),p.sha256,p.path);}
 const names=[...inventory.NativeInputs.map(p=>p.path),...plan.walletInputFiles.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS];
 const selected=canonicalNativeInputSelection(inventory.version,names,raw,inputs);assert.equal(selected.pairedInputCount,132);
 const moduleBytes=Buffer.from('PUBLIC plan-only non-executable module boundary');
 const receipt={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0',readbackOnly:true,commandsKind:'normal-build-plan',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:repo,headerRoot:headers,inputFiles:inputs,headers:PINNED_NODE_HEADER_PINS,architectures:['arm64'],commands:plan.commands,deviceV4PQRole:plan.deviceV4PQRole,pqNativeBaseCommands:plan.pqNativeBaseCommands,output:{relative:'apps/wallet-desktop/native/original-auth-identity.node',bytes:moduleBytes.length,sha256:createHash('sha256').update(moduleBytes).digest('hex')}};
 const checked=verifyCanonicalNativeReceipt(receipt,moduleBytes,selected.inputs,name=>readFileSync(path.join(repo,name)));assert.equal(checked.readbackOnly,true);assert.equal(checked.nativeQualified,false);
 const wrong=structuredClone(receipt);wrong.commands.at(-1).argv.splice(-2,0,path.join(repo,PQ_NATIVE_ARCHIVE.path));assert.throws(()=>verifyCanonicalNativeReceipt(wrong,moduleBytes,selected.inputs,name=>readFileSync(path.join(repo,name))));
 assert.throws(()=>walletNativeComponentBuildPlan('arm64',headers,true,true,true,true),/EXPLICIT_FULL_ROLE_REQUIRED/);
});
test('relocated original source keeps every E5, factory and slot command bound to that source, not verifier import root',t=>{
 const target=realpathSync(mkdtempSync(path.join(tmpdir(),'ynx-device-pq-relocated-')));t.after(()=>rmSync(target,{recursive:true,force:true}));
 const files=[...DEVICE_V4_PQ_PROTOCOL_INPUTS.map(p=>p.path),...['product-device-v4-e5.c','original-product-device-v4-factory.mm','original-product-device-v4-slot.mm'].map(n=>'apps/wallet-desktop/native/'+n)];
 for(const name of files){mkdirSync(path.dirname(path.join(target,name)),{recursive:true});copyFileSync(path.join(repo,name),path.join(target,name));}
 const base=legacy().pqNativeBaseCommands.map(c=>({...c,argv:c.argv.map(a=>a.replaceAll(repo,target))})),p=composeDeviceV4PQCommands(base,target,headers);
 assert(!p.commands.some(c=>c.argv.some(a=>a.includes(repo))), 'foreign record verification must never borrow verifier-root source paths');
 assert(p.commands[0].argv.includes(path.join(target,'apps/wallet-desktop/native/product-device-v4-e5.c')));
 const receipt={deviceV4PQRole:p.deviceV4PQRole,architectures:['arm64'],sourceRoot:target,headerRoot:headers,pqNativeBaseCommands:base,commands:p.commands};
 assert.deepEqual(deviceV4PQReceiptCommands(receipt),base);
 const wrong=structuredClone(receipt);wrong.commands[0].argv[wrong.commands[0].argv.indexOf('-c')+1]=path.join(repo,'apps/wallet-desktop/native/product-device-v4-e5.c');assert.throws(()=>deviceV4PQReceiptCommands(wrong));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {composeWalletPublisherNativeBuildPlan,SDK32_NODE_TRANSLATION_UNITS,walletPublisherNativeInputs} from '../scripts/wallet-publisher-native-build.mjs';
import {PQ_NATIVE_INPUTS,PQ_NATIVE_ARCHIVE,PQ_NATIVE_SOURCE,PQ_NATIVE_PROTOCOL,PQ_NATIVE_PROVENANCE,pqNativeSupplierInputs,pqNativeReceiptCommands,verifyPQNativeProtocolSource} from '../scripts/wallet-pq-native-build.mjs';
import {canonicalNativeInputSelection,CANONICAL_NATIVE_EVIDENCE_TESTS,isCanonicalNativeSourceAsset,verifyCanonicalNativeReceipt,PINNED_NODE_HEADER_PINS} from '../scripts/canonical-package.mjs';
const repo='/PUBLIC/source',headers='/PUBLIC/headers',sources=SDK32_NODE_TRANSLATION_UNITS.map(p=>path.join(repo,p)),output=path.join(repo,'apps/wallet-desktop/native/original-auth-identity.node');
const base=()=>({minimumSystemVersion:'13.0',sources:[...sources],output,outputs:[output],commands:[{tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min=13.0','-I'+headers,'-I'+path.join(repo,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security','-framework','AppKit','-framework','ServiceManagement','-framework','LocalAuthentication','-lbsm','-arch','arm64',...sources,'-o',output]}]});
const inventoryBytes=readFileSync(new URL('./fixtures/auth42-native-inventory.json',import.meta.url)),inventory=JSON.parse(inventoryBytes);
test('explicit R2 role selects exact SDK42 overlay provenance without modifying original99 inventory',()=>{
 const before=Buffer.from(inventoryBytes),selected=pqNativeSupplierInputs(inventory.NativeInputs,true);
 assert.equal(selected.length,99);assert.equal(selected[0].sha256,'23ade32624774f870e703b5ffd1f6abe8b8c50203e82a3c6749a5810b9516694');assert.equal(inventory.NativeInputs[0].bytes,82887);assert(inventoryBytes.equals(before));
 assert.throws(()=>pqNativeSupplierInputs([{...inventory.NativeInputs[0],sha256:'0'.repeat(64)},...inventory.NativeInputs.slice(1)],true));
 for(const p of PQ_NATIVE_INPUTS.filter(p=>!p.path.endsWith('.a'))){const b=readFileSync(new URL('../'+p.path.replace('apps/wallet-desktop/',''),import.meta.url));assert.equal(b.length,p.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),p.sha256);}
});
test('normal R2 composition compiles original C++ objects and R2Swift/wiper then links one74457 safe-Go archive',()=>{
 const original=base(),before=structuredClone(original),plan=composeWalletPublisherNativeBuildPlan(original,repo,99,true,true,true,true);assert.deepEqual(original,before);
 const link=plan.commands.at(-1);assert.equal(link.tool,'/usr/bin/xcrun');assert.equal(link.argv[0],'swiftc');assert.equal(link.argv.filter(p=>p.endsWith('.a')).length,1);assert(link.argv.includes(path.join(repo,PQ_NATIVE_ARCHIVE.path)));assert.equal(link.argv.filter(p=>p.endsWith('.swift')).length,2);assert(link.argv.includes('-DYNX_ACCOUNT_INITIAL_NATIVE_V1'));assert(link.argv.includes('-Xcc'));
 assert(plan.commands.filter(p=>p.tool==='/usr/bin/clang++').every(c=>c.argv.includes('-DYNX_ORIGINAL_WALLET_NATIVE_PQ_CUSTODY=1')&&c.argv.includes('-c')));assert.equal(plan.commands[0].tool,'/usr/bin/clang');assert.deepEqual(plan.pqNativeRole,PQ_NATIVE_PROVENANCE);assert.equal(plan.walletInputFiles.filter(p=>p.path.endsWith('.a')).length,1);
 assert.throws(()=>composeWalletPublisherNativeBuildPlan(base(),repo,92,true,true,true,true));
});
test('canonical selection accepts exact explicit overlay closure and rejects legacyTU/missingR2/changedarchive',()=>{
 const wallet=walletPublisherNativeInputs(99,true,true,true,true),selected=pqNativeSupplierInputs(inventory.NativeInputs,true),rows=[...selected,...wallet],names=[...rows.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],pins=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 assert.equal(canonicalNativeInputSelection(inventory.version,names,inventoryBytes,pins).inputs.length,rows.length);assert(rows.every(p=>isCanonicalNativeSourceAsset(p.path)));
 for(const mode of ['legacyTU','archive','missing']){const changed=structuredClone(pins);if(mode==='legacyTU')Object.assign(changed[0],{bytes:inventory.NativeInputs[0].bytes,sha256:inventory.NativeInputs[0].sha256});if(mode==='archive')changed.find(p=>p.relative.endsWith('.a')).sha256='0'.repeat(64);assert.throws(()=>canonicalNativeInputSelection(inventory.version,mode==='missing'?names.filter(p=>!p.endsWith('NativePQCustodyExports.swift')):names,inventoryBytes,changed));}
});
test('normal role receipt validates actual full command sequence and rejects partial flags/order/provenance',()=>{
 const plan=composeWalletPublisherNativeBuildPlan(base(),repo,99,true,true,true,true),record={sourceRoot:repo,architectures:['arm64'],pqNativeRole:plan.pqNativeRole,pqNativeBaseCommands:plan.pqNativeBaseCommands,commands:plan.commands};assert.deepEqual(pqNativeReceiptCommands(record),plan.pqNativeBaseCommands);
 for(const mode of ['flags','duplicateArchive','missingCompile','provenance']){const bad=structuredClone(record);if(mode==='flags')bad.commands.at(-1).argv.splice(bad.commands.at(-1).argv.indexOf('-DYNX_ACCOUNT_INITIAL_NATIVE_V1'),1);if(mode==='duplicateArchive')bad.commands.at(-1).argv.push(path.join(repo,PQ_NATIVE_ARCHIVE.path));if(mode==='missingCompile')bad.commands.splice(1,1);if(mode==='provenance')bad.pqNativeRole.override.before.sha256='0'.repeat(64);assert.throws(()=>pqNativeReceiptCommands(bad));}
});
test('canonical receipt accepts complete R2 command closure with exact public archive bytes',{skip:!process.env.WALLET_PQ_NATIVE_ARCHIVE?'requires original74457 public archive bytes':false},()=>{
 // PUBLIC receipt controls only. No module or signature is created/loaded.
 const plan=composeWalletPublisherNativeBuildPlan(base(),repo,99,false,false,false,true),inputs=[...pqNativeSupplierInputs(inventory.NativeInputs,true),...plan.walletInputFiles],data=new Map(inputs.map(p=>[p.path,Buffer.from('// PUBLIC source '+p.path)]));
 for(const p of [...plan.walletInputFiles,PQ_NATIVE_PROVENANCE.override.after])data.set(p.path,readFileSync(p.path.endsWith('.a')?process.env.WALLET_PQ_NATIVE_ARCHIVE:new URL('../'+p.path.replace('apps/wallet-desktop/',''),import.meta.url)));
 const pin=(relative,b)=>({relative,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}),module=Buffer.from('PUBLIC non-native module control');
 const record={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0',readbackOnly:true,commandsKind:'normal-build-plan',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:repo,headerRoot:headers,inputFiles:inputs.map(p=>pin(p.path,data.get(p.path))),headers:PINNED_NODE_HEADER_PINS,architectures:['arm64'],commands:plan.commands,pqNativeRole:plan.pqNativeRole,pqNativeBaseCommands:plan.pqNativeBaseCommands,output:pin('apps/wallet-desktop/native/original-auth-identity.node',module)};
 const run=()=>verifyCanonicalNativeReceipt(record,module,inputs.map(p=>p.path),p=>data.get(p));assert.equal(run().pinsVerified,true);record.pqNativeBaseCommands[0].argv.splice(0,1);assert.throws(run);
});
test('safe-Go Source and normal role bind exact74457 while refusing old8c1 and omitted Source metadata',()=>{
 const bytes=readFileSync(new URL('../native/pq-transaction/PROTOCOL_SOURCE.json',import.meta.url)),scope=verifyPQNativeProtocolSource(bytes);assert.equal(scope.commit,'74457f76d395da289cca6b3a6b353fa1349366df');assert.equal(scope.goVersion,'go version go1.26.10 darwin/arm64');for(const k of ['wholeCIPassed','Root','approval','installed','publicActivation'])assert.equal(scope[k],false);assert.deepEqual(PQ_NATIVE_PROVENANCE.protocol,PQ_NATIVE_PROTOCOL);
 assert.throws(()=>verifyPQNativeProtocolSource(Buffer.from('{}')));const changed=Buffer.from(bytes);changed[0]^=1;assert.throws(()=>verifyPQNativeProtocolSource(changed));
 const wallet=walletPublisherNativeInputs(99,true,true,true,true),rows=[...pqNativeSupplierInputs(inventory.NativeInputs,true),...wallet],names=[...rows.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS],pins=rows.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 const legacy=structuredClone(pins);Object.assign(legacy.find(p=>p.relative===PQ_NATIVE_ARCHIVE.path),{bytes:10106960,sha256:'a459fb3fbd7d4a45ea8287f9c5b2283a166716db2db6673f0a9380126eafd3cf'});assert.throws(()=>canonicalNativeInputSelection(inventory.version,names,inventoryBytes,legacy));assert.throws(()=>canonicalNativeInputSelection(inventory.version,names.filter(p=>p!==PQ_NATIVE_SOURCE.path),inventoryBytes,pins));
});

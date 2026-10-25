import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {CC7_PROTOCOL,CC7_NATIVE_ROLE,CC7_HEADERS,CC7_NATIVE_ARCHIVE,CC7_NATIVE_SOURCE,CC7_PUBLISHER_ADAPTERS,composeCC7WalletNativeBuildPlan,cc7NativeReceiptCommands,verifyCC7ProtocolSource,verifyCC7NativeSupply,verifyCC7NativeRoleInputClosure} from '../scripts/wallet-cc7-native-role.mjs';
import {SDK32_NODE_TRANSLATION_UNITS,composeWalletPublisherNativeBuildPlan} from '../scripts/wallet-publisher-native-build.mjs';
import {PQ_NATIVE_ARCHIVE} from '../scripts/wallet-pq-native-build.mjs';
const supply=process.env.WALLET_CC7_NATIVE_SUPPLY;
function base(){const repo='/PUBLIC/cc7-fresh-source',sources=SDK32_NODE_TRANSLATION_UNITS.map(p=>repo+'/'+p),output=repo+'/apps/wallet-desktop/native/original-auth-identity.node';return {repo,plan:{minimumSystemVersion:'13.0',sources,output,outputs:[output],commands:[{tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min=13.0','-I/PUBLIC/headers','-I'+repo+'/packages/wallet-auth/native','-framework','Foundation','-framework','Security','-framework','AppKit','-framework','ServiceManagement','-framework','LocalAuthentication','-lbsm','-arch','arm64',...sources,'-o',output]}]}};}
test('cc7 exact full Source is a distinct role and does not relabel old safe744 or grant Native authority',()=>{
 const bytes=readFileSync(new URL('../native/pq-transaction/cc7/PROTOCOL_SOURCE.json',import.meta.url)),result=verifyCC7ProtocolSource(bytes);assert.equal(result.protocol.commit,CC7_PROTOCOL.commit);assert.equal(result.componentCABI,true);for(const k of ['Source','Root','approval','installed','activation','macOS13Executed'])assert.equal(result[k],false);
 const old=readFileSync(new URL('../native/pq-transaction/PROTOCOL_SOURCE.json',import.meta.url));assert.throws(()=>verifyCC7ProtocolSource(old));const changed=Buffer.from(bytes);changed[0]^=1;assert.throws(()=>verifyCC7ProtocolSource(changed));assert.notEqual(PQ_NATIVE_ARCHIVE.sha256,CC7_NATIVE_ARCHIVE.sha256);
});
test('fresh complete cc7 plan binds tx/initial/publisher inputs and exactly one archive without changing old plans',()=>{
 const f=base(),before=structuredClone(f.plan),old=composeWalletPublisherNativeBuildPlan(f.plan,f.repo,100,true,true,true,true),next=composeCC7WalletNativeBuildPlan(f.plan,f.repo);assert.deepEqual(f.plan,before);assert.equal(next.commands.length,20);assert.equal(next.intermediateOutputs.length,19);assert.deepEqual(next.pqNativeRole,CC7_NATIVE_ROLE);
 assert.deepEqual(next.commands.at(-1).argv.filter(p=>p.endsWith('.a')),[f.repo+'/'+CC7_NATIVE_ARCHIVE.path]);assert.equal(next.walletInputFiles.filter(p=>p.path.endsWith('.a')).length,1);assert.equal(old.walletInputFiles.find(p=>p.path.endsWith('.a')).sha256,PQ_NATIVE_ARCHIVE.sha256);assert.equal(next.walletInputFiles.find(p=>p.path.endsWith('.a')).sha256,CC7_NATIVE_ARCHIVE.sha256);
 for(const pin of [...CC7_HEADERS,...CC7_PUBLISHER_ADAPTERS,CC7_NATIVE_SOURCE])assert.deepEqual(next.walletInputFiles.find(p=>p.path===pin.path),pin);
 for(const pin of CC7_PUBLISHER_ADAPTERS){const bytes=readFileSync(new URL('../'+pin.path.replace('apps/wallet-desktop/',''),import.meta.url));assert.equal(bytes.length,pin.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);}
});
function receipt(){const f=base(),p=composeCC7WalletNativeBuildPlan(f.plan,f.repo);return {sourceRoot:f.repo,sourceInventory:CC7_NATIVE_ROLE.sdk.inventory,architectures:['arm64'],pqNativeRole:p.pqNativeRole,pqNativeBaseCommands:p.pqNativeBaseCommands,commands:p.commands,inputFiles:p.walletInputFiles.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}))};}
test('new cc7 receipt rejects old finalization, missing header/publisher body, altered source/archive and duplicate Go runtime',()=>{
 const r=receipt();assert.deepEqual(cc7NativeReceiptCommands(r),r.pqNativeBaseCommands);
 for(const change of [r=>r.buildFinalization={},r=>r.buildContinuation={},r=>r.sourceInventory={bytes:1,sha256:'0'.repeat(64)},r=>r.commands.at(-1).argv.push('/PUBLIC/other.a'),r=>r.inputFiles.push({relative:'native/libynx_project_control.a',bytes:1,sha256:'0'.repeat(64)}),r=>r.inputFiles=r.inputFiles.filter(p=>!p.relative.endsWith('/publisher_registration.h')),r=>r.inputFiles.find(p=>p.relative===CC7_NATIVE_ARCHIVE.path).sha256=PQ_NATIVE_ARCHIVE.sha256,r=>r.inputFiles.find(p=>p.relative===CC7_NATIVE_SOURCE.path).bytes--,r=>r.pqNativeRole={...r.pqNativeRole,Root:true}]){const bad=structuredClone(receipt());change(bad);assert.throws(()=>cc7NativeReceiptCommands(bad));}
});
test('actual same cc7 archive and five headers close normal supply; symbol readback never executes crypto',{skip:!supply?'requires original frozen cc7 public supplier files':false},()=>{
 const load=p=>readFileSync(path.join(supply,p)),h=JSON.parse(load('WALLET_NATIVE_COMPLETE_SUCCESSOR_HANDOFF.json'));
 const input={handoffBytes:load('WALLET_NATIVE_COMPLETE_SUCCESSOR_HANDOFF.json'),sourceBytes:load('darwin-standard-native/SOURCE.json'),publisherSourceBytes:load('darwin/SOURCE.json'),archiveBytes:load('darwin-standard-native/libynx_artifact_release.a'),headers:new Map(CC7_HEADERS.map(p=>[path.basename(p.path),readFileSync(h.allFiveHeaders[path.basename(p.path)].path)]))};
 assert.equal(verifyCC7NativeSupply(input).componentCABI,true);assert.deepEqual(load('darwin/libynx_artifact_release.a'),input.archiveBytes);
 const altered={...input,archiveBytes:Buffer.from(input.archiveBytes)};altered.archiveBytes[0]^=1;assert.throws(()=>verifyCC7NativeSupply(altered));const missing={...input,headers:new Map(input.headers)};missing.headers.delete('account_initial.h');assert.throws(()=>verifyCC7NativeSupply(missing));
 const symbols=execFileSync('/usr/bin/nm',['-g',path.join(supply,'darwin-standard-native/libynx_artifact_release.a')],{encoding:'utf8',maxBuffer:32<<20});for(const name of ['YNXArtifactPublicationSignV1','YNXProjectControlSignV1','YNXTransactionBatchSignV1','YNXAccountInitialSignV1','YNXPublisherGenerateV1','YNXPublisherPoPSignV1','YNXPublisherCustodianSignV1'])assert.match(symbols,new RegExp(' T _'+name+'\\s'));
});
test('cc7 full input preflight refuses omitted supplier bytes and wrong formal inventory before any build',()=>{
 const f=base(),plan=composeCC7WalletNativeBuildPlan(f.plan,f.repo),inventoryBytes=readFileSync(new URL('./fixtures/auth46-native-inventory.json',import.meta.url));
 const sourceBoundary=Error('PUBLIC exact first supplier input still required');let reads=0;assert.throws(()=>verifyCC7NativeRoleInputClosure({plan,inventoryBytes},()=>{reads++;throw sourceBoundary;}),e=>e===sourceBoundary);assert.equal(reads,1);
 reads=0;const wrong=Buffer.from(inventoryBytes);wrong[0]^=1;assert.throws(()=>verifyCC7NativeRoleInputClosure({plan,inventoryBytes:wrong},()=>{reads++;return Buffer.alloc(0);}));assert.equal(reads,0);
 const changed=structuredClone(plan);changed.walletInputFiles.pop();assert.throws(()=>verifyCC7NativeRoleInputClosure({plan:changed,inventoryBytes},()=>{reads++;return Buffer.alloc(0);}));assert.equal(reads,0);
});
test('prospective complete source composition verifies all actual Native100/helper5/Main/cc7 bytes without changing the frozen build tree',{skip:!supply||!process.env.WALLET_CC7_BASE_SOURCE?'requires original Native100 base and frozen cc7 supplier':false},()=>{
 const f=base(),plan=composeCC7WalletNativeBuildPlan(f.plan,f.repo),inventoryBytes=readFileSync(new URL('./fixtures/auth46-native-inventory.json',import.meta.url)),h=JSON.parse(readFileSync(path.join(supply,'WALLET_NATIVE_COMPLETE_SUCCESSOR_HANDOFF.json')));
 const read=p=>{if(p===CC7_NATIVE_ARCHIVE.path)return readFileSync(h.singleLinkArchive.path);if(p===CC7_NATIVE_SOURCE.path||CC7_PUBLISHER_ADAPTERS.some(r=>r.path===p))return readFileSync(new URL('../'+p.replace('apps/wallet-desktop/',''),import.meta.url));const header=CC7_HEADERS.find(r=>r.path===p);if(header)return readFileSync(h.allFiveHeaders[path.basename(p)].path);return readFileSync(path.join(process.env.WALLET_CC7_BASE_SOURCE,p));};
 const checked=verifyCC7NativeRoleInputClosure({plan,inventoryBytes},read);assert.equal(checked.supplierNodeInputs,100);assert.equal(checked.supplierHelperInputs,5);assert.equal(checked.supplierSourceBytesVerified,true);assert.equal(checked.walletSourceBytesVerified,true);assert.equal(checked.NativeBuilt,false);assert.equal(checked.installed,false);
 // This maps independently supplied exact source bytes only. It does NOT
 // materialize a candidate, modify A's old source or qualify actual execution.
});

import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {composeWalletPublisherNativeBuildPlan,walletPublisherNativeInputs} from './wallet-publisher-native-build.mjs';
import {PQ_NATIVE_MANIFEST,PQ_NATIVE_SOURCE,PQ_NATIVE_ARCHIVE,PQ_NATIVE_PROVENANCE,composePQNativeCommands,pqNativeSupplierInputs} from './wallet-pq-native-build.mjs';
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
const fail=()=>{throw Error('WALLET_CC7_NATIVE_ROLE_DIFFERS');};
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>{if(!isDeepStrictEqual(a,b))fail();};
function pinned(bytes,p){if(!Buffer.isBuffer(bytes)||bytes.length!==p.bytes||hash(bytes)!==p.sha256)fail();return bytes;}
export const CC7_NATIVE_SOURCE=freeze({path:'apps/wallet-desktop/native/pq-transaction/cc7/PROTOCOL_SOURCE.json',bytes:20850,sha256:'55501273fc58a817b14c19a9084f192d8caea095fe979bda38a73c2d76d460e6'});
export const CC7_NATIVE_ARCHIVE=freeze({path:'apps/wallet-desktop/native/libynx_artifact_release.a',bytes:10469056,sha256:'ba9e0eb3222c6ede8be42082049705bee77a707cf40410e45cb6a93bb2cb54d7'});
export const CC7_COMPLETE_SUPPLY=freeze({bytes:14059,sha256:'99d9390e422289ca3b55c3d7b89312115a8d9a5fac8561e151ec67d22fbc9d3f'});
export const CC7_PUBLISHER_SOURCE=freeze({bytes:19772,sha256:'918ec8d22330ee1b5fbaa908e468b7b8c53e9143fed6b92ce0fc74e57dc3ee94'});
export const CC7_PROTOCOL=freeze({commit:'cc7ce3b79ffd3d566a31542b9590565d031a00c7',tree:'28c4fc9f3788146a1e365046e47d50b760032e59',goVersion:'go version go1.26.10 darwin/arm64',runId:'40236025642',source:CC7_NATIVE_SOURCE,archive:CC7_NATIVE_ARCHIVE});
export const CC7_HEADERS=freeze([
 {path:'apps/wallet-desktop/native/ynx_artifact_release.h',bytes:5089,sha256:'1da905e0b38581ad34a9cf995c36f8d368425df9242a35f4e49d7b41c8100616'},
 {path:'apps/wallet-desktop/native/ynx_project_control.h',bytes:4420,sha256:'98c4f5fa607d6a1e87b5ea091c7110288aee7f8ac9ff5a901f98e1c2990ca5af'},
 {path:'apps/wallet-desktop/native/pq-transaction/tx_batch.h',bytes:4569,sha256:'8c963d7fd62b6ed64b7e08d1bbf8ffb99b8b747cb95e868b192afbdfe9d66a62'},
 {path:'apps/wallet-desktop/native/pq-transaction/account_initial.h',bytes:4317,sha256:'c8a8a7402fe1d411451512bdb281d30d2f6baa8ef93ec791e066b2a8f71772ee'},
 {path:'apps/wallet-desktop/native/publisher_registration.h',bytes:5416,sha256:'0cde9f0c04696cfda2ca1236f7c41ea7de934519c2a1ff75889c69902cf6a25d'}
]);
export const CC7_PUBLISHER_ADAPTERS=freeze([
 {path:'apps/wallet-desktop/native/original-publisher-registration-cabi.h',bytes:9548,sha256:'4de8b112c8d151d46d9e6bb02ecf4258e93fd5904312e8ec379e5948b741171d'},
 {path:'apps/wallet-desktop/native/original-publisher-generation-attempt.h',bytes:5707,sha256:'5bdf3a73af6cd75daa573af06640064a2a976018005d2fdad54d775c88cc1758'}
]);
export const CC7_NATIVE_ROLE=freeze({kind:'YNX_WALLET_CC7_COMPLETE_NATIVE_SOURCE_ROLE/v1',protocol:CC7_PROTOCOL,override:structuredClone(PQ_NATIVE_PROVENANCE.override),sdk:{version:'1.3.0-pq.3.32-auth.46',nativeInputs:100,inventory:{bytes:84691,sha256:'653b1ec3d1d8aac77fd599245de57501864072536a3af7fade722f449b09389e'}},Source:false,Root:false,approval:false,installed:false});
export function verifyCC7ProtocolSource(bytes){
 const source=JSON.parse(pinned(bytes,CC7_NATIVE_SOURCE));
 if(source.commit!==CC7_PROTOCOL.commit||source.sourceTree!==CC7_PROTOCOL.tree||source.runId!==CC7_PROTOCOL.runId||source.goVersion!==CC7_PROTOCOL.goVersion||source.host?.os!=='darwin'||source.host?.arch!=='arm64'||source.crossCompiled!==false||source.minimumSystemVersion!=='13.0'||source.syntheticTestKeysOnly!==true)fail();
 same(source.archive,{bytes:CC7_NATIVE_ARCHIVE.bytes,sha256:CC7_NATIVE_ARCHIVE.sha256});
 for(const key of ['actualCABIExecuted','actualTransactionCABIExecuted','actualInitialAccountCABIExecuted','independentGoDualANDVerified','transactionIndependentGoDualANDVerified','initialAccountIndependentGoDualANDVerified'])if(source[key]!==true)fail();
 for(const key of ['mainCustodyVerified','nativeRootAuthorized','publisherAuthorized','transactionAccountAuthorized','initialAccountAuthorized','productInstalled','publicDeployment','pqActivation','privateMaterialIncluded'])if(source[key]!==false)fail();
 for(const p of CC7_HEADERS){const original=source.sources['cmd/ynx-artifact-release-cabi/'+path.basename(p.path)];if(!original||original.bytes!==p.bytes||original.sha256!==p.sha256)fail();}
 return freeze({protocol:CC7_PROTOCOL,componentCABI:true,producerPlatform:'macos-15',macOS13Executed:false,Source:false,Root:false,approval:false,installed:false,activation:false});
}
verifyCC7ProtocolSource(readFileSync(new URL('../native/pq-transaction/cc7/PROTOCOL_SOURCE.json',import.meta.url)));
// Build-only independent successor selection. Existing safe744 constants and
// all four live a9ad finalization files stay byte-identical. The archive SLOT
// is the same, but its exact bytes and complete source role are NEW. There is
// never a second Go runtime archive, cache reuse or an old receipt relabel.
export function composeCC7WalletNativeBuildPlan(originalPlan,repo){
 const plan=composeWalletPublisherNativeBuildPlan(originalPlan,repo,100,true,true,true,true);
 const selected={...plan,walletInputFiles:cc7WalletNativeInputs(),pqNativeRole:CC7_NATIVE_ROLE};
 // All commands remain the original fresh-build C/Swift/control/artifact
 // pipeline with exactly ONE logical archive slot. Header/source qualification
 // changes do not grant a callable publisher Source or new signing permission.
 same(selected.commands,composePQNativeCommands(selected.pqNativeBaseCommands,repo).commands);
 return selected;
}
export function cc7WalletNativeInputs(){
 const removed=new Set([PQ_NATIVE_MANIFEST.path,PQ_NATIVE_SOURCE.path,PQ_NATIVE_ARCHIVE.path]);
 const rows=new Map(walletPublisherNativeInputs(100,true,true,true,true).filter(p=>!removed.has(p.path)).map(p=>[p.path,p]));
 for(const p of [...CC7_HEADERS,...CC7_PUBLISHER_ADAPTERS,CC7_NATIVE_SOURCE,CC7_NATIVE_ARCHIVE]){if(rows.has(p.path))same(rows.get(p.path),p);rows.set(p.path,p);}
 return freeze([...rows.values()].map(p=>({...p})));
}
export function verifyCC7NativeRoleInputClosure({plan,inventoryBytes},readSource){
 if(typeof readSource!=='function')fail();const inventory=JSON.parse(pinned(inventoryBytes,CC7_NATIVE_ROLE.sdk.inventory));
 if(inventory.version!==CC7_NATIVE_ROLE.sdk.version||inventory.NativeInputs.length!==100||inventory.HelperInputs.length!==5)fail();
 same(plan.pqNativeRole,CC7_NATIVE_ROLE);same(plan.walletInputFiles,cc7WalletNativeInputs());
 const supplier=[...pqNativeSupplierInputs(inventory.NativeInputs,true),...inventory.HelperInputs],wallet=cc7WalletNativeInputs();
 for(const p of [...supplier,...wallet])pinned(readSource(p.path),p);
 verifyCC7ProtocolSource(readSource(CC7_NATIVE_SOURCE.path));
 // Source-byte qualification only: the existing original normal producer must
 // still verify FULL matching9432 runtime, Node headers, tools, actual fresh
 // command execution, owned undefined symbols and complete package readback.
 return freeze({supplierNodeInputs:100,supplierHelperInputs:5,walletInputs:wallet.length,supplierSourceBytesVerified:true,walletSourceBytesVerified:true,Source:false,Root:false,NativeBuilt:false,installed:false});
}
export function cc7NativeReceiptCommands(record){
 if(Object.hasOwn(record,'buildContinuation')||Object.hasOwn(record,'buildFinalization')||record.sourceInventory?.bytes!==CC7_NATIVE_ROLE.sdk.inventory.bytes||record.sourceInventory?.sha256!==CC7_NATIVE_ROLE.sdk.inventory.sha256)fail();
 same(record.pqNativeRole,CC7_NATIVE_ROLE);same(record.architectures,['arm64']);
 if(!Array.isArray(record.pqNativeBaseCommands))fail();const plan=composePQNativeCommands(record.pqNativeBaseCommands,record.sourceRoot);same(record.commands,plan.commands);
 const files=record.inputFiles;if(!Array.isArray(files)||new Set(files.map(p=>p.relative)).size!==files.length||files.some(p=>[PQ_NATIVE_MANIFEST.path,PQ_NATIVE_SOURCE.path].includes(p.relative)))fail();
 for(const p of [...CC7_HEADERS,...CC7_PUBLISHER_ADAPTERS,CC7_NATIVE_SOURCE,CC7_NATIVE_ARCHIVE]){const actual=files.find(r=>r.relative===p.path);if(!actual||actual.bytes!==p.bytes||actual.sha256!==p.sha256)fail();}
 if(files.filter(p=>p.relative.endsWith('.a')).length!==1)fail();return record.pqNativeBaseCommands;
}
export function verifyCC7NativeSupply({handoffBytes,sourceBytes,publisherSourceBytes,archiveBytes,headers}){
 const h=JSON.parse(pinned(handoffBytes,CC7_COMPLETE_SUPPLY)),scope=verifyCC7ProtocolSource(sourceBytes);pinned(archiveBytes,CC7_NATIVE_ARCHIVE);
 if(h.commit!==CC7_PROTOCOL.commit||h.sourceTree!==CC7_PROTOCOL.tree||h.normalCI!=='success'||h.archiveBytesIdenticalToPublisher!==true||h.originalSourceExactlyMatchesPublisherOriginalArchiveSource!==true)fail();
 // Publisher SOURCE has its OWN independent provenance and pins. A standalone
 // valid R13/PoP receipt is never Native custody/current/registration authority.
 const publisher=JSON.parse(pinned(publisherSourceBytes,CC7_PUBLISHER_SOURCE));if(publisher.commit!==h.commit||publisher.sourceTree!==h.sourceTree||publisher.sharedOriginalArchive!==true||publisher.protectedMainCustodyVerified!==false||publisher.sourceOwnerQualified!==false)fail();same(publisher.originalArchiveSource,{bytes:CC7_NATIVE_SOURCE.bytes,sha256:CC7_NATIVE_SOURCE.sha256});same(publisher.functions,['YNXPublisherGenerateV1','YNXPublisherPoPSignV1','YNXPublisherCustodianSignV1']);
 if(!(headers instanceof Map)||headers.size!==5)fail();for(const p of CC7_HEADERS)pinned(headers.get(path.basename(p.path)),p);return scope;
}

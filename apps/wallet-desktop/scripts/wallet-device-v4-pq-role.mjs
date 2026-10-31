import path from 'node:path';
import {ORIGINAL_DEVICE_V4_PROTOCOL_PINS} from './build-original-auth-identity-native.mjs';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {composePQNativeCommands,PQ_NATIVE_ARCHIVE,PQ_NATIVE_SOURCE,PQ_NATIVE_PROVENANCE} from './wallet-pq-native-build.mjs';
const fail=()=>{throw Error('WALLET_DEVICE_V4_PQ_COMBINED_ROLE_DIFFERS');};
const base='apps/wallet-desktop/native/device-v4-protocol/';
export const DEVICE_V4_PQ_PROTOCOL=Object.freeze({commit:'b0f66e739f2ddd14104acb0391f196cf2cea769c',tree:'92224e71381e53aa06b7c3613b3929aa0ea95ec2',arch:'arm64',platform:'darwin'});
export const DEVICE_V4_PQ_PROTOCOL_INPUTS=Object.freeze(ORIGINAL_DEVICE_V4_PROTOCOL_PINS.map(p=>Object.freeze({path:base+p.name,bytes:p.bytes,sha256:p.sha256})));
export const DEVICE_V4_PQ_ROLE=Object.freeze({kind:'YNX_WALLET_DEVICE_V4_PQ_SINGLE_ARCHIVE/v1',protocol:DEVICE_V4_PQ_PROTOCOL,inputs:DEVICE_V4_PQ_PROTOCOL_INPUTS,callerBase:PQ_NATIVE_PROVENANCE,Source:false,Root:false,approval:false});
export const DEVICE_V4_PQ_NODE=Object.freeze({path:'apps/wallet-desktop/native/original-auth-identity-node.mm',bytes:62370,sha256:'6559179a9dce97c08f57c4f52aec1c259e2101c3a37ef1ce6fc64be268e7ac74'});
// Formal Auth normal SOURCE+HTTP+PENDING supply, backed by the original a59
// typed profile. Ordinary TX keeps its separate original archive SOURCE.
const pendingBase='apps/wallet-desktop/native/device-v4-pending-protocol/';
export const DEVICE_V4_PENDING_PQ_PROTOCOL_INPUTS=Object.freeze([
 {path:pendingBase+'libynx_artifact_release.a',bytes:11192240,sha256:'dcaca724942436806f564477f8729cce3ba03cdbc5621611c9d704bb12cf8a72'},
 {path:pendingBase+'SOURCE.json',bytes:23152,sha256:'0b8df0e0fd73b9cff0ad34118a2de097b6b9ab9cc53b1a1e281ab3462186bd7f'},
 {path:pendingBase+'product_device_registration_v4.h',bytes:5814,sha256:'aa630561ec84d70892e06020bb377dd9c603ce3bc3f7a769fd14fff497010c70'},
 {path:pendingBase+'product_device_challenge_v4.h',bytes:2673,sha256:'fc4e2d792f52fe259744bfd1920713ee69a58f30bd3f0b7ceeecba09d78b4ef9'}
].map(Object.freeze));
export const DEVICE_V4_PENDING_PQ_NODE=Object.freeze({path:DEVICE_V4_PQ_NODE.path,bytes:62782,sha256:'0626a1061267eef4ab866cad3134ef70382dc884faa623588b0d9398d5abe84e'});
export const DEVICE_V4_PENDING_PQ_ROLE=Object.freeze({kind:'YNX_WALLET_DEVICE_V4_PENDING_PQ_SINGLE_ARCHIVE/v1',protocol:Object.freeze({commit:'a59f7673f487e50d3a176bf48293e3647092e2cb',tree:'293567fbf08c6257b5df980fc9bfbcfe09088493',arch:'arm64',platform:'darwin'}),inputs:DEVICE_V4_PENDING_PQ_PROTOCOL_INPUTS,callerBase:PQ_NATIVE_PROVENANCE,Source:false,Root:false,approval:false});
// Fresh ecdf same-runtime role. Historical profiles above remain immutable.
export const DEVICE_V4_PROVISIONING_PQ_PROTOCOL_INPUTS=Object.freeze([
 {
  "path": "apps/wallet-desktop/native/device-v4-provisioning-protocol/typed/libynx_artifact_release.a",
  "bytes": 11249400,
  "sha256": "7382ac7d45bfcfa3cecde6cd37bec6befc7322ee878c4cf9f2b02537d7da3253"
 },
 {
  "path": "apps/wallet-desktop/native/device-v4-provisioning-protocol/tx/SOURCE.json",
  "bytes": 29478,
  "sha256": "9ac39d940409edfdcab54c32ef5d2c391a8dbff31bdc29f6a156214ec6168710"
 },
 {
  "path": "apps/wallet-desktop/native/device-v4-provisioning-protocol/typed/SOURCE.json",
  "bytes": 24958,
  "sha256": "a3cbbe28597f7d081f6ed8313a2241fe1e35da2f442f267df290c7e154696196"
 },
 {
  "path": "apps/wallet-desktop/native/device-v4-provisioning-protocol/typed/ORIGINAL-ARCHIVE-SOURCE.json",
  "bytes": 29478,
  "sha256": "9ac39d940409edfdcab54c32ef5d2c391a8dbff31bdc29f6a156214ec6168710"
 },
 {
  "path": "apps/wallet-desktop/native/device-v4-provisioning-protocol/typed/product_device_registration_v4.h",
  "bytes": 5814,
  "sha256": "aa630561ec84d70892e06020bb377dd9c603ce3bc3f7a769fd14fff497010c70"
 },
 {
  "path": "apps/wallet-desktop/native/device-v4-provisioning-protocol/typed/product_device_challenge_v4.h",
  "bytes": 2673,
  "sha256": "fc4e2d792f52fe259744bfd1920713ee69a58f30bd3f0b7ceeecba09d78b4ef9"
 },
 {
  "path": "apps/wallet-desktop/native/device-v4-provisioning-protocol/creator/SOURCE.json",
  "bytes": 28616,
  "sha256": "755d63b5a7a5ddb67fddd26392f934eb88d3b4c00510effc33800fc84d18e108"
 },
 {
  "path": "apps/wallet-desktop/native/device-v4-provisioning-protocol/creator/ORIGINAL-ARCHIVE-SOURCE.json",
  "bytes": 29478,
  "sha256": "9ac39d940409edfdcab54c32ef5d2c391a8dbff31bdc29f6a156214ec6168710"
 },
 {
  "path": "apps/wallet-desktop/native/device-v4-provisioning-protocol/creator/product_device_keypair_v4.h",
  "bytes": 5650,
  "sha256": "6028679ecd106de7b92824efd48ec2493f622b2e14191029ae1c82742ba7eed2"
 }
].map(Object.freeze));
export const DEVICE_V4_PROVISIONING_PQ_NODE=Object.freeze({"path":"apps/wallet-desktop/native/original-auth-identity-node.mm","bytes":63187,"sha256":"8de60dbbdf3f4b7730d86bfd4ef0e0c59b7ef22428a9fea0935e062d277a33ec"});
export const DEVICE_V4_QUERY_PQ_NODE=Object.freeze({path:'apps/wallet-desktop/native/original-auth-identity-node.mm',bytes:63557,sha256:'ae7f74dd7c810f6cc2074abf458a63e41f81f64b127007b2b33726481f832453'});
export const DEVICE_V4_PROVISIONING_PQ_ROLE=Object.freeze({kind:'YNX_WALLET_DEVICE_V4_PROVISIONING_PQ_SINGLE_ARCHIVE/v1',protocol:Object.freeze({commit:'ecdf8073e9f2b03bbb8e8b8d6e9d1bf28673b6a3',tree:'bb7459b9486669d8adb44a0127812babdc848b37',arch:'arm64',platform:'darwin'}),inputs:DEVICE_V4_PROVISIONING_PQ_PROTOCOL_INPUTS,callerNode:DEVICE_V4_PROVISIONING_PQ_NODE,Source:false,Root:false,approval:false});
export const DEVICE_V4_QUERY_PQ_ROLE=Object.freeze({...DEVICE_V4_PROVISIONING_PQ_ROLE,kind:'YNX_WALLET_DEVICE_V4_QUERY_PQ_SINGLE_ARCHIVE/v1',callerNode:DEVICE_V4_QUERY_PQ_NODE});
export function assertWalletProvisioningNativeExports(text){assertWalletPendingNativeExports(text);if(!text.split(/\r?\n/).some(line=>/\b[Tt]\s+_YNXProductSessionDeviceKeypairGenerateV4$/.test(line.trim())))fail();}
export function isDeviceV4PQSelection(names){return names.includes(DEVICE_V4_PROVISIONING_PQ_PROTOCOL_INPUTS[2].path)||names.includes(DEVICE_V4_PQ_PROTOCOL_INPUTS[2].path)||names.includes(DEVICE_V4_PENDING_PQ_PROTOCOL_INPUTS[1].path);}
export function assertWalletPendingNativeExports(text){
 if(typeof text!=='string')fail();
 for(const symbol of ['YNXTransactionBatchSignV1','YNXAccountInitialSignV1','YNXProductSessionHTTPProofSignV4','YNXProductSessionDeviceRegistrationSignV4','YNXProductSessionDeviceChallengeSignV4'])
  if(!text.split(/\r?\n/).some(line=>new RegExp('\\b[Tt]\\s+_'+symbol+'$').test(line.trim())))fail();
}
export function deviceV4PQSupplierInputs(pins){
 const row=pins?.find(p=>p.path===DEVICE_V4_PQ_NODE.path);
 if(pins?.length===145){if(row?.bytes!==84296||row?.sha256!=='413bffda85672179182a7a1018cceee6a60a81d9042e5f85ef19a46a7d937d47')fail();return pins.map(p=>p.path===DEVICE_V4_PQ_NODE.path?DEVICE_V4_QUERY_PQ_NODE:p);}
 if(pins?.length===137){if(row?.bytes!==83926||row?.sha256!=="a649b4c8c10f3e57c5869ad11842b47c0653213cc7017bebfbb37d7279720af9")fail();return pins.map(p=>p.path===DEVICE_V4_PQ_NODE.path?DEVICE_V4_PROVISIONING_PQ_NODE:p);}
 if(pins?.length===127){
  if(row?.bytes!==83521||row?.sha256!=='58693eaa300b07dfd261cba29333f7017556aacd4970fa17cd9df53e33950acc')fail();
  return pins.map(p=>p.path===DEVICE_V4_PQ_NODE.path?DEVICE_V4_PENDING_PQ_NODE:p);
 }
 if(pins?.length!==117||row?.bytes!==83132||row?.sha256!=='4f9cb0eecdb50a6081118a1adf3d836aba7e6f5da2984557b9bae2964038a815')fail();
 return pins.map(p=>p.path===DEVICE_V4_PQ_NODE.path?DEVICE_V4_PQ_NODE:p);
}
export function deviceV4PQWalletInputs(inputs,pending=false,provisioning=false){
 if(typeof provisioning!=='boolean'||provisioning&&!pending)fail();
 if(typeof pending!=='boolean')fail();
 if(!Array.isArray(inputs)||inputs.filter(p=>p.path===PQ_NATIVE_ARCHIVE.path).length!==1||inputs.filter(p=>p.path===PQ_NATIVE_SOURCE.path).length!==1)fail();
 // The successor's two SOURCE profiles describe the SAME a59 archive. Keep
 // ordinary TX provenance alongside typed device provenance, link only once.
 return [...inputs.filter(p=>p.path!==PQ_NATIVE_ARCHIVE.path&&((pending&&!provisioning)||p.path!==PQ_NATIVE_SOURCE.path)),...(provisioning?DEVICE_V4_PROVISIONING_PQ_PROTOCOL_INPUTS:pending?DEVICE_V4_PENDING_PQ_PROTOCOL_INPUTS:DEVICE_V4_PQ_PROTOCOL_INPUTS)];
}
/** One fresh combined recipe, not two linked addons/Go runtimes. The legacy
 * caller composition remains DATA for exact receipt replay only; none of its
 * commands execute before this plan is returned. Old roles are not changed. */
export function composeDeviceV4PQCommands(baseCommands,repo,headers,pending=false,provisioning=false,query=false){
 if(typeof query!=='boolean'||query&&!provisioning)fail();
 if(typeof provisioning!=='boolean'||provisioning&&!pending)fail();
 if(typeof pending!=='boolean')fail();
 if(typeof repo!=='string'||!path.isAbsolute(repo)||path.normalize(repo)!==repo||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)fail();
 // A receipt may be consumed by another checkout. Derive EVERY source and
 // output from its explicit original root, never the verifier module's root.
 // Actual source pins are still checked by the normal component verifier.
 const regular=file=>{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(file)!==file)fail();return readFileSync(file);};
 const protocolInputs=provisioning?DEVICE_V4_PROVISIONING_PQ_PROTOCOL_INPUTS:pending?DEVICE_V4_PENDING_PQ_PROTOCOL_INPUTS:DEVICE_V4_PQ_PROTOCOL_INPUTS;
 for(const pin of protocolInputs){const raw=regular(path.join(repo,pin.path));if(raw.length!==pin.bytes||createHash('sha256').update(raw).digest('hex')!==pin.sha256)fail();}
 if(pending&&!provisioning&&(protocolInputs[0].bytes!==PQ_NATIVE_ARCHIVE.bytes||protocolInputs[0].sha256!==PQ_NATIVE_ARCHIVE.sha256))fail();
 const legacy=composePQNativeCommands(baseCommands,repo),wallet=path.join(repo,'apps/wallet-desktop/native');
 const oldArchive=path.join(repo,PQ_NATIVE_ARCHIVE.path),archive=path.join(repo,protocolInputs[0].path),oldLink=legacy.commands.at(-1);
 if(oldLink.tool!=='/usr/bin/xcrun'||oldLink.argv.filter(p=>p.endsWith('.a')).join()!==oldArchive)fail();
 const flags=['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_SOURCE_STAGE','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE',...(pending?['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_PENDING_STAGE']:[]),...(provisioning?['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_PROVISIONING_STAGE']:[]),...(query?['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_QUERY_STAGE']:[])];
 if(baseCommands.some(c=>c.argv.some(a=>flags.includes(a)||a.includes('PUBLIC_TEST')||a.startsWith('-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_'))))fail();
 const cpp=legacy.commands.filter(c=>c.tool==='/usr/bin/clang++');
 if(cpp.length!==18||legacy.commands.length!==20)fail();
 const extraSources=['original-product-device-v4-factory.mm','original-product-device-v4-slot.mm',...(pending?['original-product-device-v4-pending-custody.mm','original-product-device-v4-typed-producer.mm']:[]),...(provisioning?['original-product-device-v4-provisioning.mm','original-product-device-v4-association-keychain.mm','original-product-device-v4-core-creator.mm']:[]),...(query?['original-product-device-v4-query-reader.mm']:[])].map(name=>path.join(wallet,name)),e5Source=path.join(wallet,'product-device-v4-e5.c');
 for(const file of [...extraSources,e5Source])regular(file);
 const e5Object=path.join(wallet,'original-product-device-v4-e5.arm64.o'),e5={tool:'/usr/bin/clang',argv:['-std=c11','-mmacosx-version-min=13.0','-arch','arm64','-I'+wallet,'-c',e5Source,'-o',e5Object]},extraObjects=extraSources.map((_,i)=>path.join(repo,'apps/wallet-desktop/native/pq-transaction/device-v4-'+i+'.o'));
 const decorate=command=>({tool:command.tool,argv:[...flags,...command.argv]});
 const template=cpp[0].argv,ci=template.indexOf('-c');if(ci<0||template.at(-2)!=='-o')fail();
 const extra=extraSources.map((source,i)=>({tool:'/usr/bin/clang++',argv:[...flags,...template.slice(0,ci),'-c',source,'-o',extraObjects[i]]}));
 const link={tool:oldLink.tool,argv:oldLink.argv.flatMap(a=>a===oldArchive?[e5Object,...extraObjects,archive]:[a])};
 if(link.argv.filter(p=>p.endsWith('.a')).join()!==archive||link.argv.includes(oldArchive))fail();
 const commands=[e5,...legacy.commands.slice(0,-1).map(c=>c.tool==='/usr/bin/clang++'?decorate(c):c),...extra,link];
 return {commands,intermediateOutputs:[e5Object,...legacy.intermediateOutputs,...extraObjects],deviceV4PQRole:query?DEVICE_V4_QUERY_PQ_ROLE:provisioning?DEVICE_V4_PROVISIONING_PQ_ROLE:pending?DEVICE_V4_PENDING_PQ_ROLE:DEVICE_V4_PQ_ROLE,pqNativeBaseCommands:baseCommands,protocolInputs,sources:[...extraSources,e5Source],nativeGrant:false,approval:false};
}
export function deviceV4PQReceiptCommands(receipt){
 const query=receipt.deviceV4PQRole?.kind===DEVICE_V4_QUERY_PQ_ROLE.kind,provisioning=query||receipt.deviceV4PQRole?.kind===DEVICE_V4_PROVISIONING_PQ_ROLE.kind,pending=provisioning||receipt.deviceV4PQRole?.kind===DEVICE_V4_PENDING_PQ_ROLE.kind;
 if(JSON.stringify(receipt.deviceV4PQRole)!==JSON.stringify(query?DEVICE_V4_QUERY_PQ_ROLE:provisioning?DEVICE_V4_PROVISIONING_PQ_ROLE:pending?DEVICE_V4_PENDING_PQ_ROLE:DEVICE_V4_PQ_ROLE)||JSON.stringify(receipt.architectures)!==JSON.stringify(['arm64'])||!Array.isArray(receipt.pqNativeBaseCommands))fail();
 const actual=composeDeviceV4PQCommands(receipt.pqNativeBaseCommands,receipt.sourceRoot,receipt.headerRoot,pending,provisioning,query);
 if(JSON.stringify(receipt.commands)!==JSON.stringify(actual.commands))fail();
 return receipt.pqNativeBaseCommands;
}

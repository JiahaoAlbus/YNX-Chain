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
export function deviceV4PQSupplierInputs(pins){
 const row=pins?.find(p=>p.path===DEVICE_V4_PQ_NODE.path);
 if(pins?.length!==117||row?.bytes!==83132||row?.sha256!=='4f9cb0eecdb50a6081118a1adf3d836aba7e6f5da2984557b9bae2964038a815')fail();
 return pins.map(p=>p.path===DEVICE_V4_PQ_NODE.path?DEVICE_V4_PQ_NODE:p);
}
export function deviceV4PQWalletInputs(inputs){
 if(!Array.isArray(inputs)||inputs.filter(p=>p.path===PQ_NATIVE_ARCHIVE.path).length!==1||inputs.filter(p=>p.path===PQ_NATIVE_SOURCE.path).length!==1)fail();
 return [...inputs.filter(p=>p.path!==PQ_NATIVE_ARCHIVE.path&&p.path!==PQ_NATIVE_SOURCE.path),...DEVICE_V4_PQ_PROTOCOL_INPUTS];
}
/** One fresh combined recipe, not two linked addons/Go runtimes. The legacy
 * caller composition remains DATA for exact receipt replay only; none of its
 * commands execute before this plan is returned. Old roles are not changed. */
export function composeDeviceV4PQCommands(baseCommands,repo,headers){
 if(typeof repo!=='string'||!path.isAbsolute(repo)||path.normalize(repo)!==repo||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)fail();
 // A receipt may be consumed by another checkout. Derive EVERY source and
 // output from its explicit original root, never the verifier module's root.
 // Actual source pins are still checked by the normal component verifier.
 const regular=file=>{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(file)!==file)fail();return readFileSync(file);};
 for(const pin of DEVICE_V4_PQ_PROTOCOL_INPUTS){const raw=regular(path.join(repo,pin.path));if(raw.length!==pin.bytes||createHash('sha256').update(raw).digest('hex')!==pin.sha256)fail();}
 const legacy=composePQNativeCommands(baseCommands,repo),wallet=path.join(repo,'apps/wallet-desktop/native');
 const oldArchive=path.join(repo,PQ_NATIVE_ARCHIVE.path),archive=path.join(repo,DEVICE_V4_PQ_PROTOCOL_INPUTS[0].path),oldLink=legacy.commands.at(-1);
 if(oldLink.tool!=='/usr/bin/xcrun'||oldLink.argv.filter(p=>p.endsWith('.a')).join()!==oldArchive)fail();
 const flags=['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_SOURCE_STAGE','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE'];
 if(baseCommands.some(c=>c.argv.some(a=>flags.includes(a)||a.includes('PUBLIC_TEST')||a.startsWith('-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_'))))fail();
 const cpp=legacy.commands.filter(c=>c.tool==='/usr/bin/clang++');
 if(cpp.length!==18||legacy.commands.length!==20)fail();
 const extraSources=['original-product-device-v4-factory.mm','original-product-device-v4-slot.mm'].map(name=>path.join(wallet,name)),e5Source=path.join(wallet,'product-device-v4-e5.c');
 for(const file of [...extraSources,e5Source])regular(file);
 const e5Object=path.join(wallet,'original-product-device-v4-e5.arm64.o'),e5={tool:'/usr/bin/clang',argv:['-std=c11','-mmacosx-version-min=13.0','-arch','arm64','-I'+wallet,'-c',e5Source,'-o',e5Object]},extraObjects=extraSources.map((_,i)=>path.join(repo,'apps/wallet-desktop/native/pq-transaction/device-v4-'+i+'.o'));
 const decorate=command=>({tool:command.tool,argv:[...flags,...command.argv]});
 const template=cpp[0].argv,ci=template.indexOf('-c');if(ci<0||template.at(-2)!=='-o')fail();
 const extra=extraSources.map((source,i)=>({tool:'/usr/bin/clang++',argv:[...flags,...template.slice(0,ci),'-c',source,'-o',extraObjects[i]]}));
 const link={tool:oldLink.tool,argv:oldLink.argv.flatMap(a=>a===oldArchive?[e5Object,...extraObjects,archive]:[a])};
 if(link.argv.filter(p=>p.endsWith('.a')).join()!==archive||link.argv.includes(oldArchive))fail();
 const commands=[e5,...legacy.commands.slice(0,-1).map(c=>c.tool==='/usr/bin/clang++'?decorate(c):c),...extra,link];
 return {commands,intermediateOutputs:[e5Object,...legacy.intermediateOutputs,...extraObjects],deviceV4PQRole:DEVICE_V4_PQ_ROLE,pqNativeBaseCommands:baseCommands,protocolInputs:DEVICE_V4_PQ_PROTOCOL_INPUTS,sources:[...extraSources,e5Source],nativeGrant:false,approval:false};
}
export function deviceV4PQReceiptCommands(receipt){
 if(JSON.stringify(receipt.deviceV4PQRole)!==JSON.stringify(DEVICE_V4_PQ_ROLE)||JSON.stringify(receipt.architectures)!==JSON.stringify(['arm64'])||!Array.isArray(receipt.pqNativeBaseCommands))fail();
 const actual=composeDeviceV4PQCommands(receipt.pqNativeBaseCommands,receipt.sourceRoot,receipt.headerRoot);
 if(JSON.stringify(receipt.commands)!==JSON.stringify(actual.commands))fail();
 return receipt.pqNativeBaseCommands;
}

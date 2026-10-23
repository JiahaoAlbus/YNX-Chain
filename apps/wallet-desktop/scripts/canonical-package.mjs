import {createHash} from 'node:crypto';
import path from 'node:path';
import {WALLET_PUBLISHER_NATIVE_INPUTS} from './wallet-publisher-native-build.mjs';
export const CANONICAL_MAIN='code/apps/wallet-desktop/src/main.mjs';
export const CANONICAL_APP_METADATA='code/apps/wallet-desktop/package.json';
export const SDK_ALIAS='node_modules/@ynx-chain/wallet-auth';
export const SDK_CANONICAL='code/packages/wallet-auth';
export const NATIVE_CANONICAL='code/apps/wallet-desktop/native/original-auth-identity.node';
export const NATIVE_RECEIPT='code/apps/wallet-desktop/native/original-auth-identity-build.json';
export const CANONICAL_NATIVE_EVIDENCE_TESTS=Object.freeze([
 'packages/wallet-auth/native/original-auth-identity-joint-owner.test.mjs',
 'packages/wallet-auth/native/original-auth-identity-source-authority.test.mjs'
]);
export const SDK332_NATIVE_INVENTORY='packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json';
/** Production compilation and source-inspection tests are distinct inputs.
 * Only the independently frozen auth3 inventory may select the 55 production
 * leaves. Never infer that set from the receipt currently being checked. */
export function canonicalNativeInputSelection(sdkVersion,names,inventoryBytes,receiptInputs){
 const evidenceAssets=CANONICAL_NATIVE_EVIDENCE_TESTS.filter(n=>names.includes(n));
 const fixed={'1.3.0-pq.3.32-auth.3':{bytes:19696,sha256:'3600874dc48acc5032540ad8b8df39f34381cf85bd6b96f9fbe000e2da4da0ee'},'1.3.0-pq.3.32-auth.4':{bytes:21347,sha256:'e1955ad13cd5187ef4672c34619a48c94bc12120dda393ed950ba19adcb47bf7'},'1.3.0-pq.3.32-auth.5':{bytes:24580,sha256:'f74b7e805eebb86b1adff2f5865641d8c6cade0159bcf8f1baf214ae34d81b92'}};
 fixed['1.3.0-pq.3.32-auth.6']={bytes:24580,sha256:'cd7dd07ddd14d37e76b897fc179c5582cd739029a834a7134b0f8d9c9fe857f8'};
 fixed['1.3.0-pq.3.32-auth.13']={bytes:30418,sha256:'3d256c3c4581748448026d53bfd8160be1e00b80733b3d4c03af5ad30fb68a3c'};
 if(!Object.hasOwn(fixed,sdkVersion))return {inputs:names,evidenceAssets};
 const pin=fixed[sdkVersion];
 const bad=()=>{throw Error('Canonical Native source inventory differs');};
 if(!Buffer.isBuffer(inventoryBytes)||inventoryBytes.length!==pin.bytes||createHash('sha256').update(inventoryBytes).digest('hex')!==pin.sha256)bad();
 const inventory=JSON.parse(inventoryBytes),pins=inventory.NativeInputs,relay=sdkVersion==='1.3.0-pq.3.32-auth.13',paired=relay||['1.3.0-pq.3.32-auth.5','1.3.0-pq.3.32-auth.6'].includes(sdkVersion);
 if(inventory.schema!=='ynx-sdk332-r140-native-compatibility/v1'||inventory.version!==sdkVersion||pins?.length!==(relay?69:paired?62:55))bad();
 const helper=paired?inventory.HelperInputs:[];
 if(!Array.isArray(helper)||paired&&helper.length!==5)bad();
 const helperNative=helper.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path);
 const pairedInputCount=relay?74:67;
 if(paired&&(helperNative.length!==3||new Set([...pins,...helper].map(p=>p.path)).size!==pairedInputCount))bad();
 const wallet=relay&&WALLET_PUBLISHER_NATIVE_INPUTS.some(p=>names.includes(p.path))?WALLET_PUBLISHER_NATIVE_INPUTS:[];
 const inputs=[...pins,...wallet].map(p=>p.path),sorted=value=>[...value].sort();
 if(new Set(names).size!==names.length||JSON.stringify(sorted(names))!==JSON.stringify(sorted([...inputs,...helperNative,...CANONICAL_NATIVE_EVIDENCE_TESTS])))bad();
 if(!Array.isArray(receiptInputs)||receiptInputs.length!==pins.length+wallet.length)bad();
 const rows=receiptInputs.map(p=>({path:p.relative,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 if(JSON.stringify(rows)!==JSON.stringify([...pins,...wallet].sort((a,b)=>a.path.localeCompare(b.path,'en'))))bad();
 return {inputs,evidenceAssets,...(paired?{helperInputs:helper,pairedInputCount}:{}),...(wallet.length?{walletInputs:wallet,supplierNodeInputCount:pins.length}:{}),inventory:{path:SDK332_NATIVE_INVENTORY,bytes:inventoryBytes.length,sha256:pin.sha256}};
}
// Public Node headers from the already selected A build input, not a runtime
// authority or Native qualification. No network/ambient version substitution.
export const PINNED_NODE_HEADER_PINS=Object.freeze([
 {relative:'node_api.h',bytes:10731,sha256:'a6d6732d02b9ece6b53168edc3f8a53af2653db6a7ae13b1c03987e32e2d0125'},
 {relative:'node_api_types.h',bytes:1603,sha256:'8d5d854088d5725fec9775510e0aeeeb790a41ad083c49bb721d950b86e6bd61'},
 {relative:'js_native_api.h',bytes:32182,sha256:'89393f07881fcba3ed097a5989fba1746f1c2cf611f19ba4dcb17071da8a661e'},
 {relative:'js_native_api_types.h',bytes:7033,sha256:'0410c31e227f81e2981363c4d543f4832ac3df785343ec64cee621742ff8a034'},
 {relative:'node_version.h',bytes:4242,sha256:'bb880b41f17b217d6598f47bc3df2eac2caf32aa4d090e36623e58b2f4cbf2b1'}
].map(Object.freeze));
export function canonicalPackedPath(name){
 if(name==='src'||name.startsWith('src/'))return 'code/apps/wallet-desktop/'+name;
 if(name==='native'||name.startsWith('native/'))return 'code/apps/wallet-desktop/'+name;
 if(name===SDK_ALIAS||name.startsWith(SDK_ALIAS+'/'))return SDK_CANONICAL+name.slice(SDK_ALIAS.length);
 return name;
}
export function canonicalSourcePath(name){
 if(name.startsWith('apps/wallet-desktop/')||name.startsWith('packages/wallet-auth/'))return 'code/'+name;
 throw Error('Unlisted canonical source path: '+name);
}
export function canonicalMetadata(metadata){
 if(metadata.main!==CANONICAL_MAIN)throw Error('Canonical input main differs from fixed source recipe');
 return {...metadata,main:CANONICAL_MAIN};
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Closed path-only packaging, never source operand rewriting. The sole SDK
 * alias is a link to the canonical copy; the Native module has one unpacked
 * canonical path. The archive contains no second implementation. */
export function canonicalArchivePlan(before,metadataBytes,dependencyRows=[]){
 if(before.some(row=>row.path==='code'||row.path.startsWith('code/')))throw Error('Canonical packaging already applied or foreign code tree');
 const native=before.filter(row=>row.path.endsWith('/original-auth-identity.node'));
 if(native.length!==1||native[0].path!=='native/original-auth-identity.node'||native[0].type!=='file'||!native[0].unpacked)throw Error('Exactly one original unpacked Native module required');
 const sdk=before.find(row=>row.path===SDK_ALIAS);
 if(!sdk||sdk.type!=='directory')throw Error('Original SDK directory required, not an alias or second provider');
 const metadata=Buffer.from(JSON.stringify(canonicalMetadata(JSON.parse(metadataBytes.toString('utf8'))),null,2)+'\n');
 const rows=new Map();
 for(const row of before){
  const target=canonicalPackedPath(row.path);let next={...row,path:target};
  if(row.type==='link')next.link=canonicalPackedPath(row.link);
  if(row.path==='package.json'){
   if(row.type!=='file'||row.unpacked)throw Error('Normal packed package metadata required');
   next={...next,bytes:metadata.length,sha256:digest(metadata)};
  }
  if(rows.has(target))throw Error('Duplicate canonical archive member: '+target);
  rows.set(target,next);
 }
 for(const row of dependencyRows){const previous=rows.get(row.path);if(previous&&(previous.type!=='file'||previous.unpacked||previous.executable||previous.bytes!==row.bytes||previous.sha256!==row.sha256))throw Error('Conflicting canonical SDK dependency input: '+row.path);rows.set(row.path,{...row});}
 // Native ESM's package-json reader cannot traverse an ASAR directory link.
 // Keep normal directories and exact regular package descriptors; every code
 // file alias realpaths to the sole canonical implementation/cache identity.
 rows.set(SDK_ALIAS,{path:SDK_ALIAS,type:'directory',unpacked:false});
 for(const row of [...rows.values()].filter(r=>r.path.startsWith(SDK_CANONICAL+'/'))){
  const alias=SDK_ALIAS+row.path.slice(SDK_CANONICAL.length);
  if(row.type==='directory')rows.set(alias,{path:alias,type:'directory',unpacked:false});
  else if(row.type==='file'&&path.posix.basename(row.path)==='package.json')rows.set(alias,{...row,path:alias,unpacked:false,executable:false,physicalMode:null});
  else rows.set(alias,{path:alias,type:'link',link:row.path,unpacked:false});
 }
 // Retain the app's original package scope at its repository-relative root.
 // Conditional imports/exports and relative package targets keep their normal
 // meaning there; only Electron's outer launcher selects canonical main.
 const appMetadata=Buffer.from(JSON.stringify({...JSON.parse(metadataBytes.toString('utf8')),main:'src/main.mjs'},null,2)+'\n');
 rows.set(CANONICAL_APP_METADATA,{path:CANONICAL_APP_METADATA,type:'file',unpacked:false,executable:false,physicalMode:null,bytes:appMetadata.length,sha256:digest(appMetadata)});
 for(const name of [...rows.keys()]){
  let parent=path.posix.dirname(name);
  while(parent!=='.'){
   if(!rows.has(parent))rows.set(parent,{path:parent,type:'directory',unpacked:false});
   if(rows.get(parent).type!=='directory')throw Error('Non-directory canonical parent: '+parent);
   parent=path.posix.dirname(parent);
  }
 }
 return {after:[...rows.values()].sort((a,b)=>a.path.localeCompare(b.path,'en')),metadata,appMetadata};
}
export function verifyCanonicalNativeReceipt(receipt,moduleBytes,expectedInputs,readSource){
 const bad=()=>{throw Error('Native build receipt or input pins differ');};
 if(receipt?.schemaVersion!==1||receipt.kind!=='YNX_WALLET_ORIGINAL_NATIVE_BUILD'||receipt.napiVersion!==8||receipt.headerVersion!=='22.13.1'||receipt.minimumSystemVersion!=='13.0'||typeof receipt.readbackOnly!=='boolean'||receipt.appSigned!==false||receipt.nativeQualified!==false||receipt.registrationAccepted!==false)bad();
 if(receipt.commandsKind!==(receipt.readbackOnly?'normal-build-plan':'executed-normal-build'))bad();
 if(JSON.stringify(receipt.relativeBases)!==JSON.stringify({inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'}))bad();
 if(!Array.isArray(receipt.inputFiles)||!Array.isArray(receipt.headers)||!Array.isArray(receipt.commands)||!Array.isArray(receipt.architectures)||!path.isAbsolute(receipt.sourceRoot??'')||!path.isAbsolute(receipt.headerRoot??''))bad();
 const pinShape=p=>p&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&typeof p.sha256==='string'&&/^[a-f0-9]{64}$/.test(p.sha256);
 const names=receipt.inputFiles.map(p=>p.relative).sort();
 if(JSON.stringify(names)!==JSON.stringify([...expectedInputs].sort())||new Set(names).size!==names.length)bad();
 for(const p of receipt.inputFiles){
  if(!pinShape(p)||! /^(?:apps\/wallet-desktop|packages\/wallet-auth)\/native\/[^/]+\.(?:h|mm|mjs)$/.test(p.relative))bad();
  const bytes=readSource(p.relative);if(bytes.length!==p.bytes||digest(bytes)!==p.sha256)bad();
 }
 const headers=receipt.headers.map(p=>p.relative);
 if(new Set(headers).size!==headers.length||!headers.includes('node_api.h')||!headers.includes('node_version.h')||receipt.headers.some(p=>!pinShape(p)||! /^[A-Za-z0-9_.-]+\.h$/.test(p.relative)))bad();
 for(const expected of PINNED_NODE_HEADER_PINS){const actual=receipt.headers.find(p=>p.relative===expected.relative);if(!actual||actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)bad();}
 if(!pinShape(receipt.output)||receipt.output.relative!=='apps/wallet-desktop/native/original-auth-identity.node'||moduleBytes.length!==receipt.output.bytes||digest(moduleBytes)!==receipt.output.sha256)bad();
 const arches=receipt.architectures;if(arches.length<1||arches.length>2||new Set(arches).size!==arches.length||arches.some(a=>!['arm64','x86_64'].includes(a)))bad();
 const compilers=receipt.commands.filter(c=>c.tool==='/usr/bin/clang++');if(compilers.length!==arches.length||receipt.commands.length!==(arches.length===2?3:1))bad();
 const sourceRel=['apps/wallet-desktop/native/original-auth-identity-node.mm',...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm'].map(n=>'packages/wallet-auth/native/'+n)];
 // Select from the independent frozen source inventory, never receipt flags or
 // the argv being validated. Match the normal build hook's complete R114 set.
 const transport=['apps/wallet-desktop/native/original-ide-wallet-identity-source-owner.inc.mm',...['original-ide-wallet-identity-source.h','original-ide-wallet-identity-source.mm','original-ide-wallet-peer-launch.h','original-ide-wallet-peer-launch.mm'].map(n=>'packages/wallet-auth/native/'+n)];
 const selected=transport.map(name=>expectedInputs.includes(name)),withTransport=selected.some(Boolean);
 if(withTransport&&!selected.every(Boolean))bad();
 if(withTransport)sourceRel.push('packages/wallet-auth/native/original-ide-wallet-identity-source.mm','packages/wallet-auth/native/original-ide-wallet-peer-launch.mm');
 const selectGroup=group=>{const selected=group.map(name=>expectedInputs.includes(name));if(selected.some(Boolean)&&!selected.every(Boolean))bad();return selected.every(Boolean);};
 const helper=['original-ide-helper-client.h','original-ide-helper-client.mm','original-ide-helper-xpc-peer.h','original-ide-helper-xpc-peer.mm','original-ide-helper-build-release.h','original-ide-helper-service-contract.h','original-ide-helper-service-install.mm'].map(n=>'packages/wallet-auth/native/'+n);
 const withHelper=selectGroup(helper);
 if(withHelper){if(!withTransport)bad();sourceRel.push(...helper.filter(n=>n.endsWith('.mm')));}
 const publication=['original-ide-publication-artifact.h','original-ide-publication-artifact.mm'].map(n=>'packages/wallet-auth/native/'+n),withPublication=selectGroup(publication);
 if(withPublication){if(!withHelper)bad();sourceRel.push(publication[1]);}
 const relay=['apps/wallet-desktop/native/original-ide-contract-relay-binding.inc.mm',...['original-ide-contract-relay-owner.h','original-ide-contract-relay-owner.mm','original-ide-contract-relay-peer.h','original-ide-contract-relay-source.inc.mm'].map(n=>'packages/wallet-auth/native/'+n)],withRelay=selectGroup(relay);
 if(withRelay){if(!withPublication)bad();sourceRel.push('packages/wallet-auth/native/original-ide-contract-relay-owner.mm');}
 const withPublisherStore=selectGroup(WALLET_PUBLISHER_NATIVE_INPUTS.map(p=>p.path));
 if(withPublisherStore){if(!withRelay)bad();sourceRel.push(WALLET_PUBLISHER_NATIVE_INPUTS[1].path);}
 if(sourceRel.some(name=>!expectedInputs.includes(name)))bad();
 for(let i=0;i<compilers.length;i++){
  const expected=['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min=13.0','-I'+receipt.headerRoot,'-I'+path.join(receipt.sourceRoot,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security',...(withTransport?['-framework','AppKit']:[]),...(withHelper?['-framework','ServiceManagement']:[]),...(withPublisherStore?['-framework','LocalAuthentication']:[]),'-lbsm','-arch',arches[i],...sourceRel.map(p=>path.join(receipt.sourceRoot,p)),'-o',path.join(receipt.sourceRoot,receipt.output.relative)+(arches.length===2?'.'+(arches[i]==='x86_64'?'x64':arches[i]):'')];
  if(JSON.stringify(compilers[i].argv)!==JSON.stringify(expected))bad();
 }
 if(arches.length===2){const output=path.join(receipt.sourceRoot,receipt.output.relative),last=receipt.commands[2];if(last.tool!=='/usr/bin/lipo'||JSON.stringify(last.argv)!==JSON.stringify(['-create',output+'.arm64',output+'.x64','-output',output]))bad();}
 return {output:receipt.output,pinsVerified:true,headerVersion:receipt.headerVersion,napiVersion:receipt.napiVersion,minimumSystemVersion:receipt.minimumSystemVersion,readbackOnly:receipt.readbackOnly,commandsKind:receipt.commandsKind,appSigned:false,nativeQualified:false};
}

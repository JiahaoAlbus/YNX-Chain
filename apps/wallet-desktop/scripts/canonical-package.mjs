import {createHash} from 'node:crypto';
import path from 'node:path';
export const CANONICAL_MAIN='code/apps/wallet-desktop/src/main.mjs';
export const CANONICAL_APP_METADATA='code/apps/wallet-desktop/package.json';
export const SDK_ALIAS='node_modules/@ynx-chain/wallet-auth';
export const SDK_CANONICAL='code/packages/wallet-auth';
export const NATIVE_CANONICAL='code/apps/wallet-desktop/native/original-auth-identity.node';
export const NATIVE_RECEIPT='code/apps/wallet-desktop/native/original-auth-identity-build.json';
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
export function canonicalArchivePlan(before,metadataBytes){
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
 rows.set(SDK_ALIAS,{path:SDK_ALIAS,type:'link',link:SDK_CANONICAL,unpacked:false});
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
 for(let i=0;i<compilers.length;i++){
  const expected=['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-mmacosx-version-min=13.0','-I'+receipt.headerRoot,'-I'+path.join(receipt.sourceRoot,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security','-lbsm','-arch',arches[i],...sourceRel.map(p=>path.join(receipt.sourceRoot,p)),'-o',path.join(receipt.sourceRoot,receipt.output.relative)+(arches.length===2?'.'+(arches[i]==='x86_64'?'x64':arches[i]):'')];
  if(JSON.stringify(compilers[i].argv)!==JSON.stringify(expected))bad();
 }
 if(arches.length===2){const output=path.join(receipt.sourceRoot,receipt.output.relative),last=receipt.commands[2];if(last.tool!=='/usr/bin/lipo'||JSON.stringify(last.argv)!==JSON.stringify(['-create',output+'.arm64',output+'.x64','-output',output]))bad();}
 return {output:receipt.output,pinsVerified:true,headerVersion:receipt.headerVersion,napiVersion:receipt.napiVersion,minimumSystemVersion:receipt.minimumSystemVersion,readbackOnly:receipt.readbackOnly,commandsKind:receipt.commandsKind,appSigned:false,nativeQualified:false};
}

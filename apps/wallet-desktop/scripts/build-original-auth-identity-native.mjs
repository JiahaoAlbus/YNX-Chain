import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,lstatSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PINNED_NODE_HEADER_PINS} from './canonical-package.mjs';
const here=fileURLToPath(import.meta.url),app=path.resolve(path.dirname(here),'..'),repo=path.resolve(app,'../..');
export function validateOriginalMacMinimumSystemVersion(value){
 if(typeof value!=='string'||!/^[1-9][0-9]*\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))?$/.test(value)||value.length>24)throw Error('AUTH_NATIVE_PACKAGE_MINIMUM_INVALID');
 const parts=value.split('.').map(Number);if(parts.some(n=>!Number.isSafeInteger(n))||parts[0]<11||parts[0]>99||parts.slice(1).some(n=>n>99))throw Error('AUTH_NATIVE_PACKAGE_MINIMUM_INVALID');return value;
}
export function originalAuthNativeBuildPlan(arch,headers){
 if(!['arm64','x64','universal'].includes(arch)||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)throw Error('AUTH_NATIVE_BUILD_INPUT_INVALID');
 const arches=arch==='universal'?['arm64','x64']:[arch],sources=[path.join(app,'native/original-auth-identity-node.mm'),...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm'].map(name=>path.join(repo,'packages/wallet-auth/native',name))];
 const minimumSystemVersion=validateOriginalMacMinimumSystemVersion(JSON.parse(readFileSync(path.join(app,'package.json'),'utf8'))?.build?.mac?.minimumSystemVersion);
 const output=path.join(app,'native/original-auth-identity.node');
 const commands=arches.map(a=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-mmacosx-version-min='+minimumSystemVersion,'-I'+headers,'-I'+path.join(repo,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security','-lbsm','-arch',a==='x64'?'x86_64':a,...sources,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});return {commands,output,sources,minimumSystemVersion};
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputPin=(root,relative)=>{const file=path.join(root,relative),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('AUTH_NATIVE_INPUT_NOT_REGULAR');const b=readFileSync(file);return {relative,bytes:b.length,sha256:sha(b)};};
export function originalAuthNativeInputPins(plan,headers){
 const appRoot=path.resolve(path.dirname(plan.output),'..'),sourceRoot=path.resolve(appRoot,'../..');
 const inputFiles=[];
 for(const dir of ['apps/wallet-desktop/native','packages/wallet-auth/native']){
  for(const name of readdirSync(path.join(sourceRoot,dir)).sort())if(/\.(?:mm|h|mjs)$/.test(name))inputFiles.push(inputPin(sourceRoot,dir+'/'+name));
 }
 for(const source of plan.sources)if(!inputFiles.some(p=>path.join(sourceRoot,p.relative)===source))throw Error('AUTH_NATIVE_SOURCE_INPUT_MISSING');
 const version=readFileSync(path.join(headers,'node_version.h'),'utf8');
 for(const [name,value] of [['MAJOR',22],['MINOR',13],['PATCH',1]])if(!new RegExp('^#define\\s+NODE_'+name+'_VERSION\\s+'+value+'\\s*$','m').test(version))throw Error('AUTH_NATIVE_PINNED_HEADER_VERSION_REQUIRED');
 const headerPins=readdirSync(headers).filter(name=>name.endsWith('.h')).sort().map(name=>inputPin(headers,name));
 if(!headerPins.some(p=>p.relative==='node_api.h'))throw Error('AUTH_NATIVE_PINNED_HEADERS_REQUIRED');
 for(const expected of PINNED_NODE_HEADER_PINS){const actual=headerPins.find(p=>p.relative===expected.relative);if(!actual||actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)throw Error('AUTH_NATIVE_PINNED_HEADER_BYTES_REQUIRED');}
 return {inputFiles,headers:headerPins};
}
/** Readback only: caller must independently retain actual compile/link/load
 * evidence. This capture does not compile, sign, enroll or qualify a module. */
export function captureOriginalAuthNativeBuildReceipt(plan,headers){
 const pins=originalAuthNativeInputPins(plan,headers),bytes=readFileSync(plan.output);
 return {schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:path.resolve(path.dirname(plan.output),'../../..'),headerRoot:headers,napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:plan.minimumSystemVersion,architectures:plan.commands.filter(c=>c.tool==='/usr/bin/clang++').map(c=>c.argv[c.argv.indexOf('-arch')+1]),commandsKind:'normal-build-plan',commands:plan.commands,...pins,output:{relative:'apps/wallet-desktop/native/original-auth-identity.node',bytes:bytes.length,sha256:sha(bytes)},readbackOnly:true,appSigned:false,nativeQualified:false,registrationAccepted:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){
 if(process.platform!=='darwin')throw Error('AUTH_NATIVE_MAC_ONLY');
 const plan=originalAuthNativeBuildPlan(process.argv[2]??'arm64',process.argv[3]);
 if(!existsSync(path.join(process.argv[3],'node_api.h')))throw Error('AUTH_NATIVE_PINNED_HEADERS_REQUIRED');
 const before=originalAuthNativeInputPins(plan,process.argv[3]);
 // Explicit local headers only; no download, external library or hidden build.
 for(const {tool,argv} of plan.commands)execFileSync(tool,argv,{stdio:'inherit'});
 const receipt=captureOriginalAuthNativeBuildReceipt(plan,process.argv[3]);
 if(JSON.stringify(before)!==JSON.stringify({inputFiles:receipt.inputFiles,headers:receipt.headers}))throw Error('AUTH_NATIVE_INPUT_CHANGED_DURING_BUILD');
 writeFileSync(path.join(path.dirname(plan.output),'original-auth-identity-build.json'),JSON.stringify({...receipt,readbackOnly:false,commandsKind:'executed-normal-build'},null,2)+'\n');
}

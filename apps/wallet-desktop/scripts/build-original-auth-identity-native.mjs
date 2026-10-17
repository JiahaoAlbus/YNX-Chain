import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=fileURLToPath(import.meta.url),app=path.resolve(path.dirname(here),'..'),repo=path.resolve(app,'../..');
export function validateOriginalMacMinimumSystemVersion(value){
 if(typeof value!=='string'||!/^[1-9][0-9]*\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))?$/.test(value)||value.length>24)throw Error('AUTH_NATIVE_PACKAGE_MINIMUM_INVALID');
 const parts=value.split('.').map(Number);if(parts.some(n=>!Number.isSafeInteger(n))||parts[0]<11||parts[0]>99||parts.slice(1).some(n=>n>99))throw Error('AUTH_NATIVE_PACKAGE_MINIMUM_INVALID');return value;
}
export function originalAuthNativeBuildPlan(arch,headers){
 if(!['arm64','x64','universal'].includes(arch)||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)throw Error('AUTH_NATIVE_BUILD_INPUT_INVALID');
 const arches=arch==='universal'?['arm64','x64']:[arch],sources=[path.join(app,'native/original-auth-identity-node.mm'),path.join(repo,'packages/wallet-auth/native/original-auth-identity-joint-owner.mm'),path.join(repo,'packages/wallet-auth/native/original-auth-identity-source-authority.mm')];
 const minimumSystemVersion=validateOriginalMacMinimumSystemVersion(JSON.parse(readFileSync(path.join(app,'package.json'),'utf8'))?.build?.mac?.minimumSystemVersion);
 const output=path.join(app,'native/original-auth-identity.node');
 const commands=arches.map(a=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-mmacosx-version-min='+minimumSystemVersion,'-I'+headers,'-framework','Foundation','-framework','Security','-arch',a==='x64'?'x86_64':a,...sources,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});
 // Client journal IO is part of this same original addon. The separate
 // Auth-current SERVER IO module has an explicit command, never an implicit
 // extra desktop dependency or second application artifact.
 return {commands,output,outputs:[output],sources,minimumSystemVersion};
}
export function originalAuthSourceCurrentIOBuildPlan(platform,arch,headers){
 if(!['darwin','linux'].includes(platform)||!['arm64','x64','universal'].includes(arch)||platform==='linux'&&arch==='universal'||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)throw Error('AUTH_SOURCE_CURRENT_IO_BUILD_INPUT_INVALID');
 const source=path.join(repo,'packages/wallet-auth/native/original-source-current-dirfd-node.cpp'),output=path.join(app,'native/original-source-current-dirfd.node'),arches=arch==='universal'?['arm64','x64']:[arch];
 const commands=arches.map(a=>({tool:platform==='darwin'?'/usr/bin/clang++':'/usr/bin/c++',argv:['-std=c++17',...(platform==='darwin'?['-dynamiclib','-undefined','dynamic_lookup','-arch',a==='x64'?'x86_64':a]:['-shared','-fPIC']),'-DNAPI_VERSION=8','-I'+headers,source,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});return {commands,output,source};
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){
 const ioOnly=process.argv[2]==='source-current-io',headers=ioOnly?process.argv[4]:process.argv[3];
 if(!ioOnly&&process.platform!=='darwin')throw Error('AUTH_NATIVE_MAC_ONLY');
 if(ioOnly&&process.platform==='linux'&&process.argv[3]!==process.arch)throw Error('AUTH_SOURCE_CURRENT_IO_CROSS_COMPILER_NOT_SUPPLIED');
 const plan=ioOnly?originalAuthSourceCurrentIOBuildPlan(process.platform,process.argv[3],headers):originalAuthNativeBuildPlan(process.argv[2]??'arm64',headers);
 if(!existsSync(path.join(headers,'node_api.h')))throw Error('AUTH_NATIVE_PINNED_HEADERS_REQUIRED');
 // Explicit local headers only; no download, external library or hidden build.
 for(const {tool,argv} of plan.commands)execFileSync(tool,argv,{stdio:'inherit'});
}

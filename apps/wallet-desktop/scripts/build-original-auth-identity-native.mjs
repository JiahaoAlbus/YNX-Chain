import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=fileURLToPath(import.meta.url),app=path.resolve(path.dirname(here),'..'),repo=path.resolve(app,'../..');
export function validateOriginalMacMinimumSystemVersion(value){
 if(typeof value!=='string'||!/^[1-9][0-9]*\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))?$/.test(value)||value.length>24)throw Error('AUTH_NATIVE_PACKAGE_MINIMUM_INVALID');
 const parts=value.split('.').map(Number);if(parts.some(n=>!Number.isSafeInteger(n))||parts[0]<11||parts[0]>99||parts.slice(1).some(n=>n>99))throw Error('AUTH_NATIVE_PACKAGE_MINIMUM_INVALID');return value;
}
export function originalAuthNativeBuildPlan(arch,headers){
 if(!['arm64','x64','universal'].includes(arch)||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)throw Error('AUTH_NATIVE_BUILD_INPUT_INVALID');
 const arches=arch==='universal'?['arm64','x64']:[arch],native=path.join(repo,'packages/wallet-auth/native');
 // Same original module: the complete R111 baseline is six translation units.
 const sources=[path.join(app,'native/original-auth-identity-node.mm'),...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm'].map(name=>path.join(native,name))];
 const transport=[path.join(app,'native/original-ide-wallet-identity-source-owner.inc.mm'),...['original-ide-wallet-identity-source.h','original-ide-wallet-identity-source.mm','original-ide-wallet-peer-launch.h','original-ide-wallet-peer-launch.mm'].map(name=>path.join(native,name))];
 const regular=file=>{try{const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('AUTH_NATIVE_SOURCE_NOT_REGULAR');return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 const selected=transport.map(regular),withTransport=selected.some(Boolean);
 if(withTransport&&!selected.every(Boolean))throw Error('AUTH_NATIVE_TRANSPORT_SOURCE_SELECTION_INCOMPLETE');
 if(sources.some(file=>!regular(file)))throw Error('AUTH_NATIVE_BASE_SOURCE_SELECTION_INCOMPLETE');
 if(withTransport)sources.push(path.join(native,'original-ide-wallet-identity-source.mm'),path.join(native,'original-ide-wallet-peer-launch.mm'));
 const helperFiles=['original-ide-helper-client.h','original-ide-helper-client.mm','original-ide-helper-xpc-peer.h','original-ide-helper-xpc-peer.mm','original-ide-helper-build-release.h','original-ide-helper-service-contract.h','original-ide-helper-service-install.mm'].map(name=>path.join(native,name));
 const helperSelected=helperFiles.map(regular),withHelper=helperSelected.some(Boolean);
 if(withHelper&&!helperSelected.every(Boolean))throw Error('AUTH_NATIVE_HELPER_SOURCE_SELECTION_INCOMPLETE');
 if(withHelper)sources.push(...['original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm'].map(name=>path.join(native,name)));
 const minimumSystemVersion=validateOriginalMacMinimumSystemVersion(JSON.parse(readFileSync(path.join(app,'package.json'),'utf8'))?.build?.mac?.minimumSystemVersion);
 if(withHelper&&Number(minimumSystemVersion.split('.')[0])<13)throw Error('AUTH_NATIVE_HELPER_MINIMUM_INVALID');
 const output=path.join(app,'native/original-auth-identity.node');
 const commands=arches.map(a=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min='+minimumSystemVersion,'-I'+headers,'-I'+native,'-framework','Foundation','-framework','Security',...(withTransport?['-framework','AppKit']:[]),...(withHelper?['-framework','ServiceManagement']:[]),'-lbsm','-arch',a==='x64'?'x86_64':a,...sources,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});
 // Client journal IO is part of this same original addon. The separate
 // Auth-current SERVER IO module has an explicit command, never an implicit
 // extra desktop dependency or second application artifact.
 return {commands,output,outputs:[output],sources,minimumSystemVersion};
}
// Source-only normal helper executable recipe. No install, signing, Root row
// or system approval is performed by constructing or executing this compiler.
export function originalIDEHelperBuildPlan(arch){
 if(!['arm64','x64','universal'].includes(arch))throw Error('AUTH_NATIVE_HELPER_BUILD_INPUT_INVALID');
 const arches=arch==='universal'?['arm64','x64']:[arch],native=path.join(repo,'packages/wallet-auth/native');
 const sources=[path.join(repo,'apps/developer/helper/main.mm'),...['original-ide-helper-listener.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-kernel.mm','original-ide-parent-source-binding.mm'].map(n=>path.join(native,n)),path.join(app,'native/original-ide-auth-request-source.inc.mm'),path.join(native,'original-ide-helper-client.mm')];
 const headers=['original-ide-helper-listener.h','original-ide-helper-effect-contract.h','original-ide-helper-client.h','original-ide-helper-xpc-peer.h','original-ide-helper-service-contract.h','original-ide-helper-build-release.h'].map(n=>path.join(native,n));
 for(const file of [...sources,...headers]){let st;try{st=lstatSync(file);}catch{throw Error('AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE');}if(!st.isFile()||st.isSymbolicLink())throw Error('AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE');}
 const output=path.join(repo,'apps/developer/helper/YNXIdentityReceiver'),minimumSystemVersion='13.0';
 const commands=arches.map(a=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-I'+native,'-framework','Foundation','-framework','Security','-framework','ServiceManagement','-lbsm','-arch',a==='x64'?'x86_64':a,...sources,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});
 return {commands,output,outputs:[output],sources,minimumSystemVersion};
}
export function originalAuthSourceCurrentIOBuildPlan(platform,arch,headers){
 if(!['darwin','linux'].includes(platform)||!['arm64','x64','universal'].includes(arch)||platform==='linux'&&arch==='universal'||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)throw Error('AUTH_SOURCE_CURRENT_IO_BUILD_INPUT_INVALID');
 const source=path.join(repo,'packages/wallet-auth/native/original-source-current-dirfd-node.cpp'),output=path.join(app,'native/original-source-current-dirfd.node'),arches=arch==='universal'?['arm64','x64']:[arch];
 const commands=arches.map(a=>({tool:platform==='darwin'?'/usr/bin/clang++':'/usr/bin/c++',argv:['-std=c++17',...(platform==='darwin'?['-dynamiclib','-undefined','dynamic_lookup','-arch',a==='x64'?'x86_64':a]:['-shared','-fPIC']),'-DNAPI_VERSION=8','-I'+headers,source,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});return {commands,output,source};
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){
 const helperOnly=process.argv[2]==='helper',ioOnly=process.argv[2]==='source-current-io',headers=ioOnly?process.argv[4]:process.argv[3];
 if(!ioOnly&&process.platform!=='darwin')throw Error('AUTH_NATIVE_MAC_ONLY');
 if(ioOnly&&process.platform==='linux'&&process.argv[3]!==process.arch)throw Error('AUTH_SOURCE_CURRENT_IO_CROSS_COMPILER_NOT_SUPPLIED');
 if(helperOnly&&process.argv.length!==4)throw Error('AUTH_NATIVE_HELPER_BUILD_INPUT_INVALID');
 const plan=helperOnly?originalIDEHelperBuildPlan(process.argv[3]):ioOnly?originalAuthSourceCurrentIOBuildPlan(process.platform,process.argv[3],headers):originalAuthNativeBuildPlan(process.argv[2]??'arm64',headers);
 if(!helperOnly&&!existsSync(path.join(headers,'node_api.h')))throw Error('AUTH_NATIVE_PINNED_HEADERS_REQUIRED');
 // Explicit local headers only; no download, external library or hidden build.
 for(const {tool,argv} of plan.commands)execFileSync(tool,argv,{stdio:'inherit'});
}

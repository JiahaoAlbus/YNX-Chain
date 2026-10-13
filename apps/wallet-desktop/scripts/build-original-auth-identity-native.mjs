import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=fileURLToPath(import.meta.url),app=path.resolve(path.dirname(here),'..'),repo=path.resolve(app,'../..');
export function originalAuthNativeBuildPlan(arch,headers){
 if(!['arm64','x64','universal'].includes(arch)||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)throw Error('AUTH_NATIVE_BUILD_INPUT_INVALID');
 const arches=arch==='universal'?['arm64','x64']:[arch],sources=[path.join(app,'native/original-auth-identity-node.mm'),path.join(repo,'packages/wallet-auth/native/original-auth-identity-joint-owner.mm'),path.join(repo,'packages/wallet-auth/native/original-auth-identity-source-authority.mm')];
 const output=path.join(app,'native/original-auth-identity.node');
 const commands=arches.map(a=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-I'+headers,'-framework','Foundation','-framework','Security','-arch',a==='x64'?'x86_64':a,...sources,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});return {commands,output,sources};
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){
 if(process.platform!=='darwin')throw Error('AUTH_NATIVE_MAC_ONLY');
 const plan=originalAuthNativeBuildPlan(process.argv[2]??'arm64',process.argv[3]);
 if(!existsSync(path.join(process.argv[3],'node_api.h')))throw Error('AUTH_NATIVE_PINNED_HEADERS_REQUIRED');
 // Explicit local headers only; no download, external library or hidden build.
 for(const {tool,argv} of plan.commands)execFileSync(tool,argv,{stdio:'inherit'});
}

import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{spawnSync}from'node:child_process';
const root=path.resolve(import.meta.dirname,'../../..'),sdk=root+'/packages/wallet-auth',contract=()=>JSON.parse(fs.readFileSync(sdk+'/integration/SDK332_R140_NATIVE_COMPATIBILITY.json'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function exact(p,pin){const s=fs.lstatSync(p),b=fs.readFileSync(p);if(!s.isFile()||s.isSymbolicLink()||b.length!==pin.bytes||sha(b)!==pin.sha256)throw Error('IDE_V2_BUILD_PIN_CHANGED:'+p)}
export function originalIDEDeploymentV2BuildPlan(arch,headers,coreRoot){
 if(arch!=='arm64'||!headers||!coreRoot)throw Error('IDE_V2_BUILD_INPUT_INVALID');
 const c=contract(),v=c.ideDeploymentManifestV2Source,n=sdk+'/native',archive=path.resolve(coreRoot,'libynx_artifact_release.a'),output=root+'/apps/wallet-desktop/native/original-ide-deployment-v2.node';
 if(fs.existsSync(output))throw Error('IDE_V2_EXISTING_OUTPUT_PRESERVED');
 if(!fs.statSync(path.resolve(headers,'node_api.h')).isFile())throw Error('IDE_V2_NODE_HEADERS_REQUIRED');
 exact(archive,v.CoreTuple.archive);for(const r of v.newNativeInputs)exact(root+'/'+r.path,r);
 const args=['-arch',arch,'-std=c++17','-Wall','-Wextra','-Werror','-Wno-unused-function','-fPIC','-shared','-undefined','dynamic_lookup','-I'+path.resolve(headers),n+'/original-ide-deployment-v2-addon.cpp',n+'/original-ide-deployment-v2-call.cpp',archive,'-framework','CoreFoundation','-framework','Security','-o',output];
 return{schema:'ynx-ide-deployment-v2-native-build/v1',arch,compiler:'/usr/bin/clang++',args,output,coreTuple:v.CoreTuple,newNativeInputs:v.newNativeInputs,includedNotSeparateTU:n+'/original-ide-deployment-v2-key-loan.cpp',normalCIRelease:false,SourceAdmission:false,installed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){
 const args=process.argv.slice(2),planOnly=args.length===4&&args[3]==='--plan';if(args.length!==3&&!planOnly)throw Error('IDE_V2_BUILD_ARGUMENTS_INVALID');
 const plan=originalIDEDeploymentV2BuildPlan(...args.slice(0,3));if(planOnly)console.log(JSON.stringify(plan));else{if(process.platform!=='darwin')throw Error('IDE_V2_NATIVE_PLATFORM_NOT_SUPPLIED');const r=spawnSync(plan.compiler,plan.args,{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error('IDE_V2_NATIVE_BUILD_FAILED');console.log(JSON.stringify({...plan,built:true,outputSHA256:sha(fs.readFileSync(plan.output))}));}
}

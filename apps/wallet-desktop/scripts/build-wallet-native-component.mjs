import {execFileSync} from 'node:child_process';
import {verifySDK48FullAuthRuntime,SDK48_FULL_AUTH_RUNTIME_SOURCE} from './sdk14-runtime-union.mjs';
import {verifySDK49FullRuntimeTables} from './sdk49-runtime-source.mjs';
import {readFileSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as originalBuild from './build-original-auth-identity-native.mjs';
import {deviceV4PQSupplierInputs} from './wallet-device-v4-pq-role.mjs';
import {pqNativeSupplierInputs} from './wallet-pq-native-build.mjs';
import {CC7_NATIVE_ROLE,cc7WalletNativeInputs,composeCC7WalletNativeBuildPlan,verifyCC7NativeRoleInputClosure} from './wallet-cc7-native-role.mjs';
import {inspectOriginalC5NativeContinuation,nativeContinuationFilePin} from './wallet-native-continuation.mjs';
import {inspectOriginalSDK46RecordFinalization} from './wallet-native-record-finalization.mjs';
import {composeWalletPublisherNativeBuildPlan,walletPublisherNativeInputs,walletNativeSourceProfile} from './wallet-publisher-native-build.mjs';
import {PINNED_NODE_HEADER_PINS} from './canonical-package.mjs';
import {SDK13_HELPER_SOURCE_OUTPUT,SDK13_HELPER_ASSET,SDK13_HELPER_PLIST,sdk13HelperBuildCommands,verifySDK13NativeComponent} from './sdk13-native-component.mjs';
import {verifySDKRuntimeUnion,SDK_RUNTIME_UNIONS,SDK14_RUNTIME_UNION_SOURCE} from './sdk14-runtime-union.mjs';
const here=fileURLToPath(import.meta.url),app=path.resolve(path.dirname(here),'..'),repo=path.resolve(app,'../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
function assertMatchedOriginalBuild(){
 const sdk=JSON.parse(readFileSync(path.join(repo,'packages/wallet-auth/package.json')));
 const profile=walletNativeSourceProfile(sdk.version);
 const tool=path.join(app,'scripts/build-original-auth-identity-native.mjs'),toolStat=lstatSync(tool),toolBytes=readFileSync(tool);
 if(!toolStat.isFile()||toolStat.isSymbolicLink()||toolBytes.length!==profile.tool.bytes||hash(toolBytes)!==profile.tool.sha256)throw Error('WALLET_NATIVE_ORIGINAL_BUILD_TOOL_DIFFERS');
 return profile;
}
export function walletNativeComponentBuildPlan(arch,headers,artifactRelease=false,projectControl=false,controlCABI=false,pqNative=false,cc7=false,deviceV4=false){
 const profile=assertMatchedOriginalBuild();
 if(typeof deviceV4!=='boolean'||deviceV4!==(profile.version==='1.3.0-pq.3.32-auth.49'&&profile.supplierNodeInputs===117)||deviceV4&&(cc7||arch!=='arm64'||!artifactRelease||!projectControl||!controlCABI||!pqNative))throw Error('WALLET_DEVICE_V4_EXPLICIT_FULL_ROLE_REQUIRED');
 if(typeof cc7!=='boolean'||cc7&&(profile.version!==CC7_NATIVE_ROLE.sdk.version||arch!=='arm64'||!artifactRelease||!projectControl||!controlCABI||!pqNative))throw Error('WALLET_CC7_MATCHED_FULL_ROLE_REQUIRED');
 if(pqNative&&!['1.3.0-pq.3.32-auth.42','1.3.0-pq.3.32-auth.46','1.3.0-pq.3.32-auth.49'].includes(profile.version))throw Error('WALLET_PQ_NATIVE_MATCHED_SDK42_OR_46_REQUIRED');
 for(const pin of cc7?cc7WalletNativeInputs():walletPublisherNativeInputs(profile.supplierNodeInputs,artifactRelease,projectControl,controlCABI,pqNative,profile.version)){const file=path.join(repo,pin.path),stat=lstatSync(file),bytes=readFileSync(file);if(!stat.isFile()||stat.isSymbolicLink()||bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('WALLET_NATIVE_PUBLISHER_SOURCE_DIFFERS');}
 const original=originalBuild.originalAuthNativeBuildPlan(arch,headers);
 return cc7?composeCC7WalletNativeBuildPlan(original,repo):composeWalletPublisherNativeBuildPlan(original,repo,profile.supplierNodeInputs,artifactRelease,projectControl,controlCABI,pqNative,profile.version);
}
const regular=file=>{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('WALLET_NATIVE_BUILD_FILE_NOT_REGULAR');return readFileSync(file);};
const pin=(relative,bytes)=>({relative,bytes:bytes.length,sha256:hash(bytes)});
function createExclusive(file,bytes,mode){let fd;try{fd=openSync(file,'wx',mode);writeFileSync(fd,bytes);fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}const parent=openSync(path.dirname(file),'r');try{fsyncSync(parent);}finally{closeSync(parent);}}
/** Sole original builder entry. Executes the exact original supplier plans
 * plus the separately pinned Wallet user-addon TU, then records real exits.
 * Never installs a service, accesses custody or claims Native admission.
 */
export function buildWalletNativeComponent(arch,headers,artifactRelease=false,projectControl=false,controlCABI=false,pqNative=false,continuation=null,finalization=null,cc7=false,deviceV4=false){
 if(deviceV4&&(continuation||finalization||cc7))throw Error('WALLET_DEVICE_V4_FRESH_BUILD_REQUIRED');
 if(cc7&&(continuation||finalization))throw Error('WALLET_CC7_FRESH_BUILD_REQUIRED');
 if(finalization&&(continuation||!pqNative||!artifactRelease||!projectControl||!controlCABI||arch!=='arm64'||Object.keys(finalization).join('|')!=='handoffPath'))throw Error('WALLET_NATIVE_FINALIZATION_ROLE_REQUIRED');
 if(continuation&&(!pqNative||!artifactRelease||!projectControl||!controlCABI||arch!=='arm64'||Object.keys(continuation).sort().join('|')!=='asciiTmpdir|handoffPath|probeOnly'))throw Error('WALLET_NATIVE_CONTINUATION_ROLE_REQUIRED');
 const node=walletNativeComponentBuildPlan(arch,headers,artifactRelease,projectControl,controlCABI,pqNative,cc7,deviceV4),helper=originalBuild.originalIDEHelperBuildPlan(arch),architectures=arch==='universal'?['arm64','x86_64']:[arch==='x64'?'x86_64':arch];
 const profile=assertMatchedOriginalBuild(),inventoryPin=profile.inventory;
 if(JSON.stringify(helper.commands)!==JSON.stringify(sdk13HelperBuildCommands(repo,architectures)))throw Error('WALLET_NATIVE_HELPER_PLAN_DIFFERS');
 const inventoryRelative='packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',inventoryBytes=regular(path.join(repo,inventoryRelative));
 if(inventoryBytes.length!==inventoryPin.bytes||hash(inventoryBytes)!==inventoryPin.sha256)throw Error('WALLET_NATIVE_SOURCE_INVENTORY_DIFFERS');
 const inventory=JSON.parse(inventoryBytes),selectedNative=deviceV4?deviceV4PQSupplierInputs(inventory.NativeInputs):pqNativeSupplierInputs(inventory.NativeInputs,pqNative),supplier=[...selectedNative,...inventory.HelperInputs];
 if(profile.requiresRuntimeUnion&&!Object.hasOwn(SDK_RUNTIME_UNIONS,profile.version))throw Error('WALLET_MATCHED_RUNTIME_UNION_NOT_SUPPLIED');
 const runtimeUnion=Object.hasOwn(SDK_RUNTIME_UNIONS,profile.version)?verifySDKRuntimeUnion(profile.version,path.join(repo,'packages/wallet-auth'),regular(path.join(repo,SDK14_RUNTIME_UNION_SOURCE))):null;
 if(profile.version==='1.3.0-pq.3.32-auth.48')verifySDK48FullAuthRuntime(regular(path.join(repo,SDK48_FULL_AUTH_RUNTIME_SOURCE)),regular(path.join(repo,SDK14_RUNTIME_UNION_SOURCE)));
 if(profile.version==='1.3.0-pq.3.32-auth.49')verifySDK49FullRuntimeTables(regular(path.join(repo,SDK48_FULL_AUTH_RUNTIME_SOURCE)),regular(path.join(repo,SDK14_RUNTIME_UNION_SOURCE)));
 for(const p of supplier){const bytes=regular(path.join(repo,p.path));if(bytes.length!==p.bytes||hash(bytes)!==p.sha256)throw Error('WALLET_NATIVE_SUPPLIER_SOURCE_DIFFERS');}
 if(cc7)verifyCC7NativeRoleInputClosure({plan:node,inventoryBytes},name=>regular(path.join(repo,name)));
 const headerPins=PINNED_NODE_HEADER_PINS.map(p=>{const bytes=regular(path.join(headers,p.relative));if(bytes.length!==p.bytes||hash(bytes)!==p.sha256)throw Error('WALLET_NATIVE_PINNED_HEADERS_DIFFER');return {...p};});
 const recordPath=path.join(app,'native/original-auth-identity-build.json'),helperAlias=path.join(repo,SDK13_HELPER_ASSET);
 const resumed=continuation?inspectOriginalC5NativeContinuation({repo,headers,node,helper,handoffPath:continuation.handoffPath,asciiTmpdir:continuation.asciiTmpdir}):null;
 const finalized=finalization?inspectOriginalSDK46RecordFinalization({repo,headers,node,helper,handoffPath:finalization.handoffPath}):null;
 // A uses an isolated matching source tree. Existing outputs are preserved;
 // a repeated build must not replace a previously uncertain component.
 const outputs=[...(node.intermediateOutputs??[]),...node.commands.filter(c=>c.tool==='/usr/bin/clang++').map(c=>c.argv.at(-1)),node.output,...helper.commands.filter(c=>c.tool==='/usr/bin/clang++').map(c=>c.argv.at(-1)),helper.output,recordPath,helperAlias];
 for(const file of new Set(outputs)){if(resumed?.objects.some(p=>p.path===file)||finalized?.outputs.some(p=>p.path===file))continue;try{lstatSync(file);throw Error('WALLET_NATIVE_COMPONENT_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(finalized)createExclusive(path.join(path.dirname(finalization.handoffPath),'SDK46_RECORD_FINALIZATION_INTENT.json'),Buffer.from(JSON.stringify({kind:'YNX_SDK46_RECORD_FINALIZATION_INTENT/v1',original:finalized,compilerExecution:false},null,2)+'\n'),0o600);
 let continuationRecord=null;
 if(resumed){
  const probePath=path.join(resumed.attempt,'NATIVE_SAME_ATTEMPT_CONTINUATION_PROBE.json'),probeIntent=path.join(resumed.attempt,'NATIVE_SAME_ATTEMPT_CONTINUATION_PROBE_INTENT.json');
  if(continuation.probeOnly){
   createExclusive(probeIntent,Buffer.from(JSON.stringify({kind:'YNX_NATIVE_SAME_ATTEMPT_PROBE_INTENT/v1',original:resumed,compilerExecution:false},null,2)+'\n'),0o600);
   let output,failed=false,cause;
   try{output=execFileSync(resumed.probe.tool,resumed.probe.argv,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});}catch(error){failed=true;cause=error;}
   const result={kind:'YNX_NATIVE_SAME_ATTEMPT_PROBE/v1',original:resumed,actualCommand:resumed.probe,exit:failed?(cause.status??null):0,signal:failed?(cause.signal??null):null,stdoutSHA256:hash(Buffer.from(output??cause?.stdout??'')),stderrSHA256:hash(Buffer.from(cause?.stderr??'')),metadataOnly:true,compilerExecution:false};
   createExclusive(probePath,Buffer.from(JSON.stringify(result,null,2)+'\n'),0o600);if(failed)throw cause;
   return {probePath,probe:nativeContinuationFilePin(probePath),objectsRetained:19,compilerExecution:false,strictToolchainIdentityQualified:false,futureToolchainReuseAuthorized:false,installed:false};
  }
  const probe=JSON.parse(regular(probePath));
  if(probe.kind!=='YNX_NATIVE_SAME_ATTEMPT_PROBE/v1'||probe.exit!==0||probe.signal!==null||probe.metadataOnly!==true||probe.compilerExecution!==false||JSON.stringify(probe.original)!==JSON.stringify(resumed)||JSON.stringify(probe.actualCommand)!==JSON.stringify(resumed.probe))throw Error('WALLET_NATIVE_CONTINUATION_PROBE_REQUIRED');
  const runIntent=path.join(resumed.attempt,'NATIVE_SAME_ATTEMPT_CONTINUATION_RUN_INTENT.json');
  createExclusive(runIntent,Buffer.from(JSON.stringify({kind:'YNX_NATIVE_SAME_ATTEMPT_CONTINUATION_INTENT/v1',original:resumed,probe:nativeContinuationFilePin(probePath),commands:resumed.remainingCommands},null,2)+'\n'),0o600);
  continuationRecord={kind:'YNX_WALLET_NATIVE_SAME_ATTEMPT_CONTINUATION/v1',original:resumed,probe:nativeContinuationFilePin(probePath),runIntent:nativeContinuationFilePin(runIntent),priorPrefixCommands:19,thisInvocationNodeCommands:1,thisInvocationHelperCommands:helper.commands.length,originalPrefixExecutedPreviously:true,strictToolchainIdentityQualified:false,futureToolchainReuseAuthorized:false};
 }
 for(const command of finalized?[]:resumed?resumed.remainingCommands:[...node.commands,...helper.commands])execFileSync(command.tool,command.argv,{stdio:'inherit'});
 const scan=plan=>{const stdout=execFileSync(plan.ownedUndefinedScan.tool,plan.ownedUndefinedScan.argv,{encoding:'utf8'});originalBuild.assertOriginalAuthOwnedSymbols(stdout);return {...plan.ownedUndefinedScan,exit:0,stdoutSHA256:hash(Buffer.from(stdout)),ownedUndefined:[]};};
 const nodeScan=scan(node),helperScan=scan(helper),moduleBytes=regular(node.output),helperBytes=regular(helper.output);
 const record={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0',readbackOnly:false,commandsKind:'executed-normal-build',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:repo,headerRoot:headers,sourceInventory:{relative:inventoryRelative,...inventoryPin},inputFiles:[...selectedNative,...node.walletInputFiles].map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})),headers:headerPins,architectures,commands:node.commands,exitCodes:node.commands.map(()=>0),ownedUndefinedScan:nodeScan,output:pin('apps/wallet-desktop/native/original-auth-identity.node',moduleBytes),helperBuild:{kind:'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1',sourceRoot:repo,architectures,readbackOnly:false,commandsKind:'executed-normal-build',executed:true,serviceRegistered:false,installed:false,nativeQualified:false,appSigned:false,inputFiles:supplier.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en')),commands:helper.commands,exitCodes:helper.commands.map(()=>0),ownedUndefinedScan:helperScan,output:pin(SDK13_HELPER_SOURCE_OUTPUT,helperBytes),packagedOutput:SDK13_HELPER_ASSET,plist:pin(SDK13_HELPER_PLIST,regular(path.join(repo,SDK13_HELPER_PLIST)))}};
 // Use the exact selected build closure, including the explicit artifact role
 // when requested; never describe a linked archive with the base-only inputs.
 record.inputFiles=[...selectedNative,...node.walletInputFiles].map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));
 if(pqNative){if(deviceV4)record.deviceV4PQRole=node.deviceV4PQRole;else record.pqNativeRole=node.pqNativeRole;record.pqNativeBaseCommands=node.pqNativeBaseCommands;}
 if(runtimeUnion)record.runtimeUnion=runtimeUnion;
 if(continuationRecord)record.buildContinuation=continuationRecord;
 if(finalized)record.buildFinalization=finalized;
 verifySDK13NativeComponent({record,inventoryBytes,moduleBytes,helperBytes},name=>regular(path.join(repo,name)));
 createExclusive(helperAlias,helperBytes,0o755);
 createExclusive(recordPath,Buffer.from(JSON.stringify(record,null,2)+'\n'),0o600);
 return {recordPath,sourceInputs:supplier.length+node.walletInputFiles.length,nodeTranslationUnits:node.sources.length,helperTranslationUnits:11,appSigned:false,nativeQualified:false,installed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){
 if(process.platform!=='darwin')throw Error('AUTH_NATIVE_MAC_ONLY');
 assertMatchedOriginalBuild();
 if(process.argv[2]==='component-device-v4-pq-native-project-control-cabi-artifact-release'){
  if(process.argv.length!==5)throw Error('WALLET_NATIVE_BUILD_ARGUMENTS_INVALID');
  const result=buildWalletNativeComponent(process.argv[3],process.argv[4],true,true,true,true,null,null,false,true);process.stdout.write(JSON.stringify(result)+'\n');
 }else{
 const requestedMode=process.argv[2],continuationMode=/^component-pq-native-project-control-cabi-artifact-release-continue(?:-check)?$/.test(requestedMode??''),mode=continuationMode?'component-pq-native-project-control-cabi-artifact-release':requestedMode;
 if(requestedMode==='component-cc7-native-project-control-cabi-artifact-release'){if(process.argv.length!==5)throw Error('WALLET_NATIVE_BUILD_ARGUMENTS_INVALID');const result=buildWalletNativeComponent(process.argv[3],process.argv[4],true,true,true,true,null,null,true);process.stdout.write(JSON.stringify(result)+'\n');}
 else if(requestedMode==='component-pq-native-project-control-cabi-artifact-release-finalize'){if(process.argv.length!==6)throw Error('WALLET_NATIVE_BUILD_ARGUMENTS_INVALID');const result=buildWalletNativeComponent(process.argv[3],process.argv[4],true,true,true,true,null,{handoffPath:process.argv[5]});process.stdout.write(JSON.stringify(result)+'\n');}
 else if(continuationMode){if(process.argv.length!==7)throw Error('WALLET_NATIVE_BUILD_ARGUMENTS_INVALID');const result=buildWalletNativeComponent(process.argv[3],process.argv[4],true,true,true,true,{handoffPath:process.argv[5],asciiTmpdir:process.argv[6],probeOnly:requestedMode.endsWith('-check')});process.stdout.write(JSON.stringify(result)+'\n');}
 else if(['component','component-artifact-release','component-project-control','component-project-control-artifact-release','component-project-control-cabi','component-project-control-cabi-artifact-release','component-pq-native','component-pq-native-project-control-cabi-artifact-release'].includes(mode)){if(process.argv.length!==5)throw Error('WALLET_NATIVE_BUILD_ARGUMENTS_INVALID');buildWalletNativeComponent(process.argv[3],process.argv[4],mode.includes('artifact-release'),mode.includes('project-control'),mode.includes('control-cabi'),mode.includes('pq-native'));}
 else {
 const helper=mode==='helper',io=mode==='source-current-io';
 if(helper&&process.argv.length!==4||io&&process.argv.length!==5||!helper&&!io&&process.argv.length!==4)throw Error('WALLET_NATIVE_BUILD_ARGUMENTS_INVALID');
 // Helper and separately explicit server IO retain the original supplier plan;
 // the Wallet Keychain class must NEVER be compiled into the privileged helper.
 const plan=helper?originalBuild.originalIDEHelperBuildPlan(process.argv[3]):io?originalBuild.originalAuthSourceCurrentIOBuildPlan(process.platform,process.argv[3],process.argv[4]):walletNativeComponentBuildPlan(mode??'arm64',process.argv[3]);
 for(const {tool,argv} of plan.commands)execFileSync(tool,argv,{stdio:'inherit'});
 if(!io)originalBuild.assertOriginalAuthOwnedSymbols(execFileSync(plan.ownedUndefinedScan.tool,plan.ownedUndefinedScan.argv,{encoding:'utf8'}));
 }
}
}

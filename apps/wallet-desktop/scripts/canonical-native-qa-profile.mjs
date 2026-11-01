// Closed QA source/build receipt profile. Never Root, Native admission or A.
import {readFileSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import data from './canonical-native-qa-profile-data.json' with {type:'json'};
import * as originalBuild from './build-original-auth-identity-native.mjs';
export const COMMON_QA_ROLE='YNX_WALLET_CANONICAL_COMMON_QA/v1';
export const COMMON_QA_INPUT_NAMES=Object.freeze(data.nodeInputs.map(x=>x.path));
export const COMMON_QA_PROVENANCE_NAMES=Object.freeze([...data.provenanceScripts]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const same=(a,b)=>{if(!isDeepStrictEqual(a,b))fail('COMMON_QA_RECORD_DIFFERS');};
const pin=b=>({bytes:b.length,sha256:sha(b)});
const rows=x=>x.map(({path:relative,bytes,sha256})=>({relative,bytes,sha256}));
const regular=f=>{const s=lstatSync(f);if(!s.isFile()||s.isSymbolicLink())fail('COMMON_QA_SOURCE_NOT_REGULAR');return readFileSync(f);};
const abs=x=>{if(typeof x!=='string'||!path.isAbsolute(x)||path.normalize(x)!==x)fail('COMMON_QA_ROOT_INVALID');};
const check=(b,x)=>{if(!Buffer.isBuffer(b)||b.length!==x.bytes||sha(b)!==x.sha256)fail('COMMON_QA_SOURCE_PIN_DIFFERS');};
export function canonicalCommonQAProfile(version,inventoryBytes){
 if(version!==data.version||!Buffer.isBuffer(inventoryBytes)||inventoryBytes.length!==data.inventory.bytes||sha(inventoryBytes)!==data.inventory.sha256)return null;
 return Object.freeze({version,normalCommonImage:true,profileId:data.id,supplierNodeInputs:224,requiresRuntimeUnion:false,inventory:{bytes:data.inventory.bytes,sha256:data.inventory.sha256},tool:{bytes:data.tool.bytes,sha256:data.tool.sha256}});
}
export function isCommonQARecord(record){return record?.normalCommonImageRole?.kind===COMMON_QA_ROLE;}
export function isCommonQASourceAsset(name){return COMMON_QA_INPUT_NAMES.includes(name);}
export function selectCommonQAInputs(version,inventoryBytes){
 const profile=canonicalCommonQAProfile(version,inventoryBytes);if(!profile)fail('COMMON_QA_PROFILE_NOT_SELECTED');
 return {inputs:[...COMMON_QA_INPUT_NAMES],walletInputs:[],supplierNodeInputCount:224,inventory:profile.inventory,evidenceAssets:[],normalCommonImage:true};
}
export function inspectCanonicalCommonQAExecutionRuntimeDATA(version,uv,executableBytes){
 if(version!==data.manifest.node.version||uv!==data.manifest.node.uv||!Buffer.isBuffer(executableBytes)||sha(executableBytes)!==data.manifest.node.sha256)fail('COMMON_QA_EXECUTION_NODE_DIFFERS');
 return {executionNodeVersion:version,compilerHeaderVersion:data.headerVersion,compilerExecuted:false};
}
export function inspectCanonicalCommonQASourceData(inventoryBytes,readSource){
 if(!canonicalCommonQAProfile(data.version,inventoryBytes))fail('COMMON_QA_PROFILE_NOT_SELECTED');
 for(const x of data.helperInputs)check(readSource(x.path),x);
 check(readSource(data.inventory.path),data.inventory);
 return Object.freeze({nodeInputs:data.nodeInputs.length,helperInputs:data.helperInputs.length,translationUnits:50,swiftSources:2,commands:52,compilerHeaderVersion:data.headerVersion,executionNodeVersion:data.manifest.node.version,dataOnly:true,NativeAdmission:false,helperExecuted:false});
}
function helperCommands(root){return [{tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-I'+path.join(root,'apps/wallet-desktop/native'),'-I'+path.join(root,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security','-framework','LocalAuthentication','-framework','ServiceManagement','-lbsm','-arch','arm64',...data.helperTranslationUnits.map(x=>path.join(root,x)),'-o',path.join(root,'apps/developer/helper/YNXIdentityReceiver')]}];}
// Reader-only exact recipe reconstruction; execution is only the canonical
// producer plan below, not a second compiler/provider entry.
function nodeCommands(root,headers){
 const m=data.manifest,include=['-I',headers,'-I',path.join(root,'apps/wallet-desktop/native'),'-I',path.join(root,'packages/wallet-auth/native'),'-I',path.join(root,'packages/wallet-auth/native/vendor/link/include'),'-I',path.join(root,'apps/pay/native/producer')],out=path.join(root,'apps/wallet-desktop/native'),objects=[],commands=[];
 for(const [i,row]of m.translationUnits.entries()){
  const file=path.join(root,row.path),c=file.endsWith('.c'),objc=file.endsWith('.mm'),obj=path.join(out,'original-auth-common.arm64.'+i+'.o');objects.push(obj);
  commands.push({tool:c?'/usr/bin/clang':'/usr/bin/clang++',argv:[c?'-std=c11':'-std=c++17',...(row.legacyBaseline?['-Wno-deprecated-declarations']:['-Wall','-Wextra','-Werror']),'-fPIC','-mmacosx-version-min=13.0','-DYNX_ORIGINAL_WALLET_NATIVE_PQ_CUSTODY=1',...include,...(objc?['-fobjc-arc']:[]),'-c',file,'-o',obj]});
 }
 const sw=path.join(out,'original-auth-common.arm64.PQ.o');objects.push(sw);
 commands.push({tool:'/usr/bin/swiftc',argv:['-parse-as-library','-whole-module-optimization','-emit-object','-module-name','YNXWalletPrivatePQ','-target','arm64-apple-macosx13.0','-DYNX_ACCOUNT_INITIAL_NATIVE_V1','-Xcc','-DYNX_ACCOUNT_INITIAL_NATIVE_V1','-import-objc-header',path.join(root,m.swiftHeader),...m.swiftSources.map(x=>path.join(root,x)),'-o',sw]});
 commands.push({tool:'/usr/bin/swiftc',argv:['-emit-library','-o',path.join(out,'original-auth-identity.node'),...objects,path.join(root,m.archive),...['Foundation','Security','IOKit','AppKit','ServiceManagement'].flatMap(x=>['-framework',x]),'-lresolv','-Xlinker','-lbsm',...m.systemLibraries.flatMap(x=>['-Xlinker',x]),'-Xlinker','-undefined','-Xlinker','dynamic_lookup']});return commands;
}
export function inspectCanonicalCommonQAHelperPlanDATA(plan,root){
 abs(root);same(plan.commands,helperCommands(root));same(plan.sources,data.helperTranslationUnits.map(x=>path.join(root,x)));same(plan.minimumSystemVersion,'13.0');
 return Object.freeze({commands:plan.commands.length,translationUnits:plan.sources.length,dataOnly:true,helperExecuted:false,NativeAdmission:false});
}
export function inspectCanonicalCommonQAPlanDATA(plan,root,headers){
 abs(root);abs(headers);same(plan.normalCommonImage,true);same(plan.commands,nodeCommands(root,headers));
 same(plan.sources,[...data.manifest.translationUnits.map(x=>path.join(root,x.path)),...data.manifest.swiftSources.map(x=>path.join(root,x))]);
 same(plan.postCommands.length,2);same(plan.postCommands.map(x=>x.argv),[[path.join(root,data.manifest.strictGate),path.join(root,'apps/wallet-desktop/native/original-auth-common-plan.json')],[path.join(root,data.manifest.readback),path.join(root,'apps/wallet-desktop/native/original-auth-identity.node')]]);
 same(plan.goArchives.length,1);same(plan.systemInputs,data.manifest.systemInputs);same(plan.nativeAdmission,false);same(plan.sourceAdmission,false);
 return Object.freeze({commands:plan.commands.length,objects:plan.intermediateOutputs.length,postCommands:plan.postCommands.length,dataOnly:true,compilerExecuted:false,helperExecuted:false,NativeAdmission:false});
}
export function verifyCommonQAComponent({record,inventoryBytes,moduleBytes,helperBytes},readSource){
 if(!isCommonQARecord(record)||!canonicalCommonQAProfile(data.version,inventoryBytes))fail('COMMON_QA_PROFILE_NOT_SELECTED');
 abs(record.sourceRoot);abs(record.headerRoot);const root=record.sourceRoot,r=record.normalCommonImageRole;
 same(r.kind,COMMON_QA_ROLE);same(r.profileId,data.id);same(r.manifest,data.manifestPin);same(r.runtime,data.manifest.node);same(r.systemInputs,data.manifest.systemInputs);
 same(record.schemaVersion,1);same(record.kind,'YNX_WALLET_ORIGINAL_NATIVE_BUILD');same(record.napiVersion,8);same(record.headerVersion,data.headerVersion);same(record.minimumSystemVersion,'13.0');same(record.architectures,['arm64']);
 for(const k of ['readbackOnly','appSigned','nativeQualified','registrationAccepted'])same(record[k],false);
 same(record.commandsKind,'executed-normal-build');same(record.sourceInventory,{relative:data.inventory.path,bytes:data.inventory.bytes,sha256:data.inventory.sha256});same(record.inputFiles,rows(data.nodeInputs));same(record.commands,nodeCommands(root,record.headerRoot));same(record.exitCodes,record.commands.map(()=>0));
 same(record.relativeBases,{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'});
 same(record.headers,[...data.manifest.node.headers.map(x=>({relative:x.name,bytes:x.bytes,sha256:x.sha256})),{relative:data.headerVersionPin.name,bytes:data.headerVersionPin.bytes,sha256:data.headerVersionPin.sha256}]);
 const post=[{tool:r.nodeExecutable,argv:[path.join(root,data.manifest.strictGate),path.join(root,'apps/wallet-desktop/native/original-auth-common-plan.json')]},{tool:r.nodeExecutable,argv:[path.join(root,data.manifest.readback),path.join(root,'apps/wallet-desktop/native/original-auth-identity.node')]}];abs(r.nodeExecutable);same(r.postCommands,post);same(r.postExitCodes,[0,0]);
 for(const x of data.helperInputs)check(readSource(x.path),x);check(inventoryBytes,data.inventory);
 same(record.sourceProvenanceFiles.map(x=>x.relative),COMMON_QA_PROVENANCE_NAMES);for(const x of record.sourceProvenanceFiles){check(readSource(x.relative),x);}
 const helper=record.helperBuild;
 if(!helper)fail('COMMON_QA_HELPER_NOT_EXECUTED');same(helper.kind,'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1');same(helper.sourceRoot,root);same(helper.architectures,['arm64']);same(helper.commands,helperCommands(root));same(helper.exitCodes,[0]);same(helper.inputFiles,rows(data.helperInputs));same(helper.commandsKind,'executed-normal-build');same(helper.executed,true);
 for(const k of ['readbackOnly','serviceRegistered','installed','nativeQualified','appSigned'])same(helper[k],false);
 same(record.output.relative,'apps/wallet-desktop/native/original-auth-identity.node');check(moduleBytes,record.output);same(helper.output.relative,'apps/developer/helper/YNXIdentityReceiver');check(helperBytes,helper.output);same(helper.packagedOutput,'apps/wallet-desktop/native/YNXIdentityReceiver');same(helper.plist,{relative:data.helperPlist.path,bytes:data.helperPlist.bytes,sha256:data.helperPlist.sha256});
 for(const [owner,output]of [[record,record.output.relative],[helper,helper.output.relative]]){const s=owner.ownedUndefinedScan;same(s?.tool,'/usr/bin/nm');same(s.argv,['-u',path.join(root,output)]);same(s.exit,0);same(s.ownedUndefined,[]);if(!/^[a-f0-9]{64}$/.test(s.stdoutSHA256))fail('COMMON_QA_SCAN_MISSING');}
 return {normalCommonImage:true,normalCommonImageRole:r,sourceBytesVerified:true,artifactBytesVerified:true,walletInputs:[],selectedNativeInputs:data.nodeInputs,supplierNodeInputCount:224,helper:{output:helper.output,packagedOutput:helper.packagedOutput,translationUnits:data.helperTranslationUnits.length,sourceInputs:data.helperInputs.length},installed:false,serviceRegistered:false,nativeQualified:false,SourceAdmission:false};
}
export function canonicalCommonQAGatePayloadDATA(plan,imageBytes){
 if(!Buffer.isBuffer(imageBytes)||!Array.isArray(plan.goArchives)||plan.goArchives.length!==1)fail('COMMON_QA_GATE_INPUT_INVALID');
 return {version:1,image:{path:plan.output,...pin(imageBytes)},goArchives:plan.goArchives};
}
function exclusive(file,bytes,mode=0o600){let fd;try{fd=openSync(file,'wx',mode);writeFileSync(fd,bytes);fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}}
export function buildCanonicalCommonQAComponent({root,arch,headers}){
 if(process.platform!=='darwin'||arch!=='arm64')fail('COMMON_QA_DARWIN_ARM64_ONLY');abs(root);abs(headers);
 inspectCanonicalCommonQAExecutionRuntimeDATA(process.version,process.versions.uv,regular(process.execPath));
 const read=rel=>regular(path.join(root,rel)),inventoryBytes=read(data.inventory.path);if(!canonicalCommonQAProfile(data.version,inventoryBytes))fail('COMMON_QA_PROFILE_NOT_SELECTED');
 for(const x of data.helperInputs)check(read(x.path),x);check(read('apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs'),data.tool);check(read(data.manifestPin.path),data.manifestPin);
 const hp=[...data.manifest.node.headers,data.headerVersionPin].map(x=>{const b=regular(path.join(headers,x.name));check(b,x);return{relative:x.name,...pin(b)};});
 const provenanceBefore=COMMON_QA_PROVENANCE_NAMES.map(relative=>({relative,...pin(read(relative))}));
 const plan=originalBuild.originalAuthNativeBuildPlan(arch,headers),helper=originalBuild.originalIDEHelperBuildPlan(arch);if(plan.normalCommonImage!==true)fail('COMMON_QA_CANONICAL_PLAN_REQUIRED');same(plan.commands,nodeCommands(root,headers));same(helper.commands,helperCommands(root));
 const recordPath=path.join(root,'apps/wallet-desktop/native/original-auth-identity-build.json'),alias=path.join(root,'apps/wallet-desktop/native/YNXIdentityReceiver'),ledgerPath=recordPath+'.common-qa-attempt.json';
 const outputs=[...plan.intermediateOutputs,plan.output,helper.output,recordPath,alias,ledgerPath,plan.gatePlanFile];for(const f of outputs){try{lstatSync(f);fail('COMMON_QA_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
 const ledger=[];let failed=false,cause;
 const run=c=>{try{const raw=execFileSync(c.tool,c.argv,{encoding:'buffer',maxBuffer:16<<20});ledger.push({tool:c.tool,argv:c.argv,exit:0,stdoutSHA256:sha(raw)});return raw;}catch(e){ledger.push({tool:c.tool,argv:c.argv,exit:e.status??null,signal:e.signal??null,stdoutSHA256:sha(e.stdout??Buffer.alloc(0)),stderrSHA256:sha(e.stderr??Buffer.alloc(0))});throw e;}};
 let record,moduleBytes,helperBytes;
 try{
  for(const c of plan.commands)run(c);
  const scan=p=>{const raw=run(p.ownedUndefinedScan);originalBuild.assertOriginalAuthOwnedSymbols(raw.toString());return{...p.ownedUndefinedScan,exit:0,stdoutSHA256:sha(raw),ownedUndefined:[]};};
  const nodeScan=scan(plan);moduleBytes=regular(plan.output);
  exclusive(plan.gatePlanFile,Buffer.from(JSON.stringify(canonicalCommonQAGatePayloadDATA(plan,moduleBytes))+'\n'));
  for(const c of plan.postCommands)run(c);
  for(const row of [...plan.matchingInputs,...plan.systemInputs])check(regular(row.path),row);
  for(const c of helper.commands)run(c);const helperScan=scan(helper);helperBytes=regular(helper.output);
  record={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:data.headerVersion,minimumSystemVersion:'13.0',readbackOnly:false,commandsKind:'executed-normal-build',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:root,headerRoot:headers,sourceInventory:{relative:data.inventory.path,bytes:data.inventory.bytes,sha256:data.inventory.sha256},inputFiles:rows(data.nodeInputs),headers:hp,architectures:['arm64'],commands:plan.commands,exitCodes:plan.commands.map(()=>0),ownedUndefinedScan:nodeScan,output:{relative:'apps/wallet-desktop/native/original-auth-identity.node',...pin(moduleBytes)},sourceProvenanceFiles:provenanceBefore,normalCommonImageRole:{kind:COMMON_QA_ROLE,profileId:data.id,manifest:data.manifestPin,runtime:data.manifest.node,systemInputs:data.manifest.systemInputs,nodeExecutable:process.execPath,postCommands:plan.postCommands,postExitCodes:plan.postCommands.map(()=>0)},helperBuild:{kind:'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1',sourceRoot:root,architectures:['arm64'],readbackOnly:false,commandsKind:'executed-normal-build',executed:true,serviceRegistered:false,installed:false,nativeQualified:false,appSigned:false,inputFiles:rows(data.helperInputs),commands:helper.commands,exitCodes:helper.commands.map(()=>0),ownedUndefinedScan:helperScan,output:{relative:'apps/developer/helper/YNXIdentityReceiver',...pin(helperBytes)},packagedOutput:'apps/wallet-desktop/native/YNXIdentityReceiver',plist:{relative:data.helperPlist.path,bytes:data.helperPlist.bytes,sha256:data.helperPlist.sha256}}};
  verifyCommonQAComponent({record,inventoryBytes,moduleBytes,helperBytes},read);exclusive(alias,helperBytes,0o755);exclusive(recordPath,Buffer.from(JSON.stringify(record,null,2)+'\n'));
 }catch(e){failed=true;cause=e;}finally{exclusive(ledgerPath,Buffer.from(JSON.stringify({kind:'COMMON_QA_ACTUAL_EXECUTION_ATTEMPT/v1',ledger,failed,failureCode:failed?(cause.code??null):null,recordWritten:!failed,NativeAdmission:false},null,2)+'\n'));}
 if(failed)throw cause;return{recordPath,ledgerPath,nodeTranslationUnits:50,swiftSources:2,helperTranslationUnits:data.helperTranslationUnits.length,recordWritten:true,nativeQualified:false,installed:false};
}

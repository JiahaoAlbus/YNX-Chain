// Closed QA source/build receipt profile. Never Root, Native admission or A.
import {readFileSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync,constants,fstatSync,readSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual,types} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import continuationData from './canonical-native-portable-qa-continuation-data.json' with {type:'json'};
import data from './canonical-native-portable-qa-profile-data.json' with {type:'json'};
import * as originalBuild from './build-original-auth-identity-native.mjs';
export const PORTABLE_QA_ROLE='YNX_WALLET_CANONICAL_PORTABLE_QA/v1';
export const PORTABLE_QA_INPUT_NAMES=Object.freeze(data.nodeInputs.map(x=>x.path));
export const PORTABLE_QA_PROVENANCE_NAMES=Object.freeze([...data.provenanceScripts]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const same=(a,b)=>{if(!isDeepStrictEqual(a,b))fail('PORTABLE_QA_RECORD_DIFFERS');};
const pin=b=>({bytes:b.length,sha256:sha(b)});
const rows=x=>x.map(({path:relative,bytes,sha256})=>({relative,bytes,sha256}));
const regular=f=>{const before=lstatSync(f);if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>(16<<20))fail('PORTABLE_QA_SOURCE_NOT_REGULAR');let fd;try{fd=openSync(f,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const a=fstatSync(fd);if(!a.isFile()||a.ino!==before.ino||a.dev!==before.dev||a.size!==before.size||a.size<1||a.size>(16<<20)||a.mtimeMs!==before.mtimeMs||a.ctimeMs!==before.ctimeMs)fail('PORTABLE_QA_SOURCE_CHANGED');const b=Buffer.alloc(a.size+1);let n=0;while(n<b.length){const k=readSync(fd,b,n,b.length-n,n);if(!k)break;n+=k;}const z=fstatSync(fd),named=lstatSync(f);if(n!==a.size||z.ino!==a.ino||z.dev!==a.dev||z.size!==a.size||z.mtimeMs!==a.mtimeMs||z.ctimeMs!==a.ctimeMs||named.ino!==z.ino||named.dev!==z.dev||named.isSymbolicLink())fail('PORTABLE_QA_SOURCE_CHANGED');return b.subarray(0,n);}finally{if(fd!==undefined)closeSync(fd);}};
const abs=x=>{if(typeof x!=='string'||!path.isAbsolute(x)||path.normalize(x)!==x)fail('PORTABLE_QA_ROOT_INVALID');};
const check=(b,x)=>{if(!Buffer.isBuffer(b)||!Number.isSafeInteger(x.bytes)||x.bytes<1||x.bytes>(16<<20)||b.length!==x.bytes||sha(b)!==x.sha256)fail('PORTABLE_QA_SOURCE_PIN_DIFFERS');};
function inventorySelected(version,inventoryBytes){return version===data.version&&Buffer.isBuffer(inventoryBytes)&&inventoryBytes.length===data.inventory.bytes&&sha(inventoryBytes)===data.inventory.sha256;}
export function canonicalPortableQAProfile(version,inventoryBytes,manifestBytes){
 if(!Buffer.isBuffer(manifestBytes)||manifestBytes.length!==data.manifestPin.bytes||sha(manifestBytes)!==data.manifestPin.sha256||version!==data.version||!Buffer.isBuffer(inventoryBytes)||inventoryBytes.length!==data.inventory.bytes||sha(inventoryBytes)!==data.inventory.sha256)return null;
 return Object.freeze({version,normalCommonImage:true,profileId:data.id,supplierNodeInputs:262,requiresRuntimeUnion:false,inventory:{bytes:data.inventory.bytes,sha256:data.inventory.sha256},tool:{bytes:data.tool.bytes,sha256:data.tool.sha256}});
}
export function isPortableQARecord(record){if(!record||types.isProxy(record))return false;const r=Object.getOwnPropertyDescriptor(record,'normalPortableImageRole')?.value;if(!r||types.isProxy(r))return false;return Object.getOwnPropertyDescriptor(r,'kind')?.value===PORTABLE_QA_ROLE;}
export function isPortableQASourceAsset(name){return PORTABLE_QA_INPUT_NAMES.includes(name);}
export function isPortableQAInputSelection(names){return Array.isArray(names)&&names.includes('apps/wallet-desktop/native/original-wallet-portable-runtime-inputs.json');}
export function selectPortableQAInputs(version,inventoryBytes,receiptInputs){
 if(!inventorySelected(version,inventoryBytes))fail('PORTABLE_QA_PROFILE_NOT_SELECTED');same(receiptInputs,rows(data.nodeInputs));
 return {inputs:[...PORTABLE_QA_INPUT_NAMES],walletInputs:[],supplierNodeInputCount:262,inventory:data.inventory,evidenceAssets:[],normalCommonImage:true,portableRuntime:true};
}
export function inspectCanonicalPortableQAExecutionRuntimeDATA(version,uv,executableBytes){
 if(version!==data.manifest.node.version||uv!==data.manifest.node.uv||!Buffer.isBuffer(executableBytes)||sha(executableBytes)!==data.manifest.node.sha256)fail('PORTABLE_QA_EXECUTION_NODE_DIFFERS');
 return {executionNodeVersion:version,compilerHeaderVersion:data.headerVersion,compilerExecuted:false};
}
export function inspectCanonicalPortableQASourceData(inventoryBytes,readSource){
 if(!inventorySelected(data.version,inventoryBytes))fail('PORTABLE_QA_PROFILE_NOT_SELECTED');
 for(const x of data.helperInputs)check(readSource(x.path),x);
 check(readSource(data.inventory.path),data.inventory);
 return Object.freeze({nodeInputs:data.nodeInputs.length,helperInputs:data.helperInputs.length,translationUnits:50,swiftSources:2,commands:53,compilerHeaderVersion:data.headerVersion,executionNodeVersion:data.manifest.node.version,dataOnly:true,NativeAdmission:false,helperExecuted:false});
}
function helperCommands(root){return [{tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-I'+path.join(root,'apps/wallet-desktop/native'),'-I'+path.join(root,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security','-framework','LocalAuthentication','-framework','ServiceManagement','-lbsm','-arch','arm64',...data.helperTranslationUnits.map(x=>path.join(root,x)),'-o',path.join(root,'apps/developer/helper/YNXIdentityReceiver')]}];}
// Reader-only exact recipe reconstruction; execution is only the canonical
// producer plan below, not a second compiler/provider entry.
export function canonicalPortableQACommandsDATA(root,headers,nodeExecutable){
 abs(root);abs(headers);abs(nodeExecutable);return nodeCommands(root,headers,nodeExecutable);
}
function nodeCommands(root,headers,nodeExecutable){
 const m=data.manifest,include=['-I',headers,'-I',path.join(root,'apps/wallet-desktop/native'),'-I',path.join(root,'packages/wallet-auth/native'),'-I',path.join(root,'packages/wallet-auth/native/vendor/link/include'),'-I',path.join(root,'apps/pay/native/producer')],out=path.join(root,'apps/wallet-desktop/native'),objects=[],commands=[];
 for(const [i,row]of m.translationUnits.entries()){
  const file=path.join(root,row.path),c=file.endsWith('.c'),objc=file.endsWith('.mm'),obj=path.join(out,'original-auth-common.arm64.'+i+'.o');objects.push(obj);
  commands.push({tool:c?'/usr/bin/clang':'/usr/bin/clang++',argv:[c?'-std=c11':'-std=c++17',...(row.legacyBaseline?['-Wno-deprecated-declarations']:['-Wall','-Wextra','-Werror']),'-fPIC','-mmacosx-version-min=13.0','-DYNX_ORIGINAL_WALLET_NATIVE_PQ_CUSTODY=1',...include,...(objc?['-fobjc-arc']:[]),'-c',file,'-o',obj]});
 }
 const sw=path.join(out,'original-auth-common.arm64.PQ.o');objects.push(sw);
 commands.push({tool:'/usr/bin/swiftc',argv:['-parse-as-library','-whole-module-optimization','-emit-object','-module-name','YNXWalletPrivatePQ','-target','arm64-apple-macosx13.0','-DYNX_ACCOUNT_INITIAL_NATIVE_V1','-Xcc','-DYNX_ACCOUNT_INITIAL_NATIVE_V1','-import-objc-header',path.join(root,m.swiftHeader),...m.swiftSources.map(x=>path.join(root,x)),'-o',sw]});
 commands.push({tool:'/usr/bin/swiftc',argv:['-emit-library','-target','arm64-apple-macosx13.0','-o',path.join(out,'original-auth-identity.linked.node'),...objects,path.join(root,m.archive),...['Foundation','Security','IOKit','AppKit','ServiceManagement'].flatMap(x=>['-framework',x]),'-lresolv','-Xlinker','-lbsm',...data.runtimeManifest.libraries.flatMap(x=>['-Xlinker',path.join(root,x.input.path)]),'-Xlinker','-undefined','-Xlinker','dynamic_lookup']});commands.push({tool:nodeExecutable,argv:[path.join(root,'apps/wallet-desktop/scripts/original-auth-portable-stage.mjs')]});return commands;
}
export function inspectCanonicalPortableQAHelperPlanDATA(plan,root){
 abs(root);same(plan.commands,helperCommands(root));same(plan.sources,data.helperTranslationUnits.map(x=>path.join(root,x)));same(plan.minimumSystemVersion,'13.0');
 return Object.freeze({commands:plan.commands.length,translationUnits:plan.sources.length,dataOnly:true,helperExecuted:false,NativeAdmission:false});
}
export function inspectCanonicalPortableQAPlanDATA(plan,root,headers){
 abs(root);abs(headers);same(plan.normalCommonImage,true);const executable=plan.commands.at(-1)?.tool;abs(executable);const libraries=data.runtimeManifest.libraries.map(x=>path.join(root,x.input.path));const argv=plan.commands[51]?.argv??[];if(libraries.some(x=>!argv.includes(x)))fail('PORTABLE_QA_FOREIGN_LINK_ROOT');same(plan.commands,nodeCommands(root,headers,executable));same(plan.postCommands.map(x=>x.tool),[executable,executable]);same(plan.goArchives,[{...data.manifest.files.find(x=>x.path===data.manifest.archive),path:path.join(root,data.manifest.archive)}]);same(plan.matchingInputs,data.manifest.files.map(x=>({...x,path:path.join(root,x.path)})));
 same(plan.sources,[...data.manifest.translationUnits.map(x=>path.join(root,x.path)),...data.manifest.swiftSources.map(x=>path.join(root,x))]);
 const native=path.join(root,'apps/wallet-desktop/native'),output=path.join(native,'original-auth-identity.node');same(plan.output,output);same(plan.outputs,[output]);same(plan.normalManifest,path.join(root,data.manifestPin.path));same(plan.minimumSystemVersion,'13.0');same(plan.gatePlanFile,path.join(native,'original-auth-common-plan.json'));same(plan.intermediateOutputs,[...data.manifest.translationUnits.map((_,i)=>path.join(native,'original-auth-common.arm64.'+i+'.o')),path.join(native,'original-auth-common.arm64.PQ.o'),path.join(native,'original-auth-identity.linked.node'),path.join(native,'original-auth-runtime-libs'),path.join(native,'.original-auth-portable-component'),path.join(native,'original-auth-portable-runtime.json')]);same(plan.ownedUndefinedScan,{tool:'/usr/bin/nm',argv:['-u',output],rejectPattern:'YNX|ynx'});
 if(plan.commands.length!==53)fail('PORTABLE_QA_COMMAND_COUNT');same(plan.postCommands.length,2);same(plan.postCommands.map(x=>x.argv),[[path.join(root,data.manifest.strictGate),path.join(root,'apps/wallet-desktop/native/original-auth-common-plan.json')],[path.join(root,data.manifest.readback),path.join(root,'apps/wallet-desktop/native/original-auth-identity.node')]]);
 same(plan.goArchives.length,1);same(plan.systemInputs,data.manifest.systemInputs);same(plan.nativeAdmission,false);same(plan.sourceAdmission,false);
 return Object.freeze({commands:plan.commands.length,objects:plan.intermediateOutputs.filter(x=>x.endsWith('.o')).length,postCommands:plan.postCommands.length,dataOnly:true,compilerExecuted:false,helperExecuted:false,NativeAdmission:false});
}
export function verifyPortableQAComponent({record,inventoryBytes,moduleBytes,helperBytes},readSource){
 record=captureRecordDATA(record);
 if(!isPortableQARecord(record)||!inventorySelected(data.version,inventoryBytes))fail('PORTABLE_QA_PROFILE_NOT_SELECTED');
 abs(record.sourceRoot);abs(record.headerRoot);const root=record.sourceRoot,r=record.normalPortableImageRole;
 exact(record,['schemaVersion','kind','napiVersion','headerVersion','minimumSystemVersion','readbackOnly','commandsKind','appSigned','nativeQualified','registrationAccepted','relativeBases','sourceRoot','headerRoot','sourceInventory','inputFiles','headers','architectures','commands','exitCodes','ownedUndefinedScan','output','sourceProvenanceFiles','normalPortableImageRole','portableRuntime','helperBuild']);exact(r,['kind','profileId','manifest','runtime','systemInputs','nodeExecutable','postCommands','postExitCodes',...(Object.hasOwn(r,'postBuildContinuation')?['postBuildContinuation']:[])]);same(r.kind,PORTABLE_QA_ROLE);same(r.profileId,data.id);same(r.manifest,data.manifestPin);same(r.runtime,data.manifest.node);same(r.systemInputs,data.manifest.systemInputs);
 same(record.schemaVersion,1);same(record.kind,'YNX_WALLET_ORIGINAL_NATIVE_BUILD');same(record.napiVersion,8);same(record.headerVersion,data.headerVersion);same(record.minimumSystemVersion,'13.0');same(record.architectures,['arm64']);
 for(const k of ['readbackOnly','appSigned','nativeQualified','registrationAccepted'])same(record[k],false);
 same(record.commandsKind,'executed-normal-build');same(record.sourceInventory,{relative:data.inventory.path,bytes:data.inventory.bytes,sha256:data.inventory.sha256});same(record.inputFiles,rows(data.nodeInputs));same(record.commands,nodeCommands(root,record.headerRoot,r.nodeExecutable));same(record.exitCodes,record.commands.map(()=>0));
 same(record.relativeBases,{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'});
 same(record.headers,[...data.manifest.node.headers.map(x=>({relative:x.name,bytes:x.bytes,sha256:x.sha256})),{relative:data.headerVersionPin.name,bytes:data.headerVersionPin.bytes,sha256:data.headerVersionPin.sha256}]);
 const post=[{tool:r.nodeExecutable,argv:[path.join(root,data.manifest.strictGate),path.join(root,'apps/wallet-desktop/native/original-auth-common-plan.json')]},{tool:r.nodeExecutable,argv:[path.join(root,data.manifest.readback),path.join(root,'apps/wallet-desktop/native/original-auth-identity.node')]}];abs(r.nodeExecutable);same(r.postCommands,post);same(r.postExitCodes,[0,0]);
 for(const x of data.helperInputs)check(readSource(x.path),x);check(inventoryBytes,data.inventory);
 verifyPortableRuntimeRecordDATA(record,moduleBytes,readSource);
 same(record.sourceProvenanceFiles.map(x=>x.relative),PORTABLE_QA_PROVENANCE_NAMES);for(const x of record.sourceProvenanceFiles){exact(x,['relative','bytes','sha256']);check(readSource(x.relative),x);}
 const helper=record.helperBuild;
 if(!helper)fail('PORTABLE_QA_HELPER_NOT_EXECUTED');exact(helper,['kind','sourceRoot','architectures','readbackOnly','commandsKind','executed','serviceRegistered','installed','nativeQualified','appSigned','inputFiles','commands','exitCodes','ownedUndefinedScan','output','packagedOutput','plist']);same(helper.kind,'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1');same(helper.sourceRoot,root);same(helper.architectures,['arm64']);same(helper.commands,helperCommands(root));same(helper.exitCodes,[0]);same(helper.inputFiles,rows(data.helperInputs));same(helper.commandsKind,'executed-normal-build');same(helper.executed,true);
 for(const k of ['readbackOnly','serviceRegistered','installed','nativeQualified','appSigned'])same(helper[k],false);
 same(record.output.relative,'apps/wallet-desktop/native/original-auth-identity.node');check(moduleBytes,record.output);same(helper.output.relative,'apps/developer/helper/YNXIdentityReceiver');check(helperBytes,helper.output);same(helper.packagedOutput,'apps/wallet-desktop/native/YNXIdentityReceiver');same(helper.plist,{relative:data.helperPlist.path,bytes:data.helperPlist.bytes,sha256:data.helperPlist.sha256});
 for(const [owner,output]of [[record,record.output.relative],[helper,helper.output.relative]]){const s=owner.ownedUndefinedScan;exact(s,['tool','argv','exit','stdoutSHA256','ownedUndefined']);same(s?.tool,'/usr/bin/nm');same(s.argv,['-u',path.join(root,output)]);same(s.exit,0);same(s.ownedUndefined,[]);if(!/^[a-f0-9]{64}$/.test(s.stdoutSHA256))fail('PORTABLE_QA_SCAN_MISSING');}
 if(Object.hasOwn(r,'postBuildContinuation')){const role=verifyPortableQAContinuationRoleDATA(record);for(const x of role.producerFiles)check(readSource(x.relative),x);}
 return {normalCommonImage:true,normalPortableImageRole:r,sourceBytesVerified:true,artifactBytesVerified:true,walletInputs:[],selectedNativeInputs:data.nodeInputs,supplierNodeInputCount:262,portableRuntime:true,runtimeLibraryOutputs:record.portableRuntime.libraryOutputs,licenseOutputs:record.portableRuntime.licenseOutputs,helper:{output:helper.output,packagedOutput:helper.packagedOutput,translationUnits:data.helperTranslationUnits.length,sourceInputs:data.helperInputs.length},installed:false,serviceRegistered:false,nativeQualified:false,SourceAdmission:false};
}
/** Project the original fixed nm scan plan into the closed five-field receipt.
 * DATA only: preserves the actual owned-symbol check; never runs a process. */
export function canonicalPortableQAOwnedScanRecordDATA(scan,raw){
 scan=captureRecordDATA(scan);exact(scan,['tool','argv','rejectPattern']);same(scan.tool,'/usr/bin/nm');same(scan.rejectPattern,'YNX|ynx');
 if(!Array.isArray(scan.argv)||scan.argv.length!==2||scan.argv[0]!=='-u')fail('PORTABLE_QA_SCAN_MISSING');abs(scan.argv[1]);
 if(!Buffer.isBuffer(raw)||raw.length>(16<<20))fail('PORTABLE_QA_SCAN_MISSING');originalBuild.assertOriginalAuthOwnedSymbols(raw.toString());
 return {tool:scan.tool,argv:scan.argv,exit:0,stdoutSHA256:sha(raw),ownedUndefined:[]};
}
export function canonicalPortableQAGatePayloadDATA(plan,imageBytes){
 if(!Buffer.isBuffer(imageBytes)||!Array.isArray(plan.goArchives)||plan.goArchives.length!==1)fail('PORTABLE_QA_GATE_INPUT_INVALID');
 return {version:1,image:{path:plan.output,...pin(imageBytes)},goArchives:plan.goArchives};
}
function exclusive(file,bytes,mode=0o600){let fd;try{fd=openSync(file,'wx',mode);writeFileSync(fd,bytes);fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}}
const moduleRelative='apps/wallet-desktop/native/original-auth-identity.node';
const libraryRelative='apps/wallet-desktop/native/original-auth-runtime-libs/';
const runtimeNames=Object.freeze(data.runtimeManifest.libraries.map(x=>x.name));
const licenseInputs=[...new Map(data.runtimeManifest.libraries.flatMap(x=>x.licenses).map(x=>[x.name,x.input])).entries()];
const systemDependency=s=>s.startsWith('/System/Library/')||s.startsWith('/usr/lib/');
function captureRecordDATA(v,depth=0,state={nodes:0}){if(depth>32||++state.nodes>100000)fail('PORTABLE_QA_CLOSED_RECORD');if(v===null||['string','boolean'].includes(typeof v)||typeof v==='number'&&Number.isSafeInteger(v))return v;if(!v||types.isProxy(v)||typeof v!=='object')fail('PORTABLE_QA_CLOSED_RECORD');const d=Object.getOwnPropertyDescriptors(v);if(Array.isArray(v)){if(Object.getPrototypeOf(v)!==Array.prototype||Reflect.ownKeys(d).length!==v.length+1)fail('PORTABLE_QA_CLOSED_RECORD');const a=[];for(let i=0;i<v.length;i++){if(!d[i]?.enumerable||!Object.hasOwn(d[i],'value'))fail('PORTABLE_QA_CLOSED_RECORD');a.push(captureRecordDATA(d[i].value,depth+1,state));}return a;}if(Object.getPrototypeOf(v)!==Object.prototype)fail('PORTABLE_QA_CLOSED_RECORD');const o={};for(const k of Reflect.ownKeys(d)){if(typeof k!=='string'||k==='__proto__'||!d[k].enumerable||!Object.hasOwn(d[k],'value'))fail('PORTABLE_QA_CLOSED_RECORD');o[k]=captureRecordDATA(d[k].value,depth+1,state);}return o;}
const exact=(o,keys)=>{if(!o||Object.getPrototypeOf(o)!==Object.prototype||Object.keys(o).sort().join('|')!==[...keys].sort().join('|'))fail('PORTABLE_QA_CLOSED_RECORD');};
const hexd=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
/** Mach-O load-command DATA. A code-signature command is not a valid signature,
 * and deployment metadata does not establish execution on macOS 13. */
export function inspectPortableMachOQAData(original,relative){
 if(!Buffer.isBuffer(original)||original.length<32||original.length>(16<<20)||original.readUInt32LE(0)!==0xfeedfacf||original.readUInt32LE(4)!==0x100000c)fail('PORTABLE_QA_MACHO_INVALID');
 const n=original.readUInt32LE(16),total=original.readUInt32LE(20);if(!n||n>4096||total>original.length-32)fail('PORTABLE_QA_MACHO_INVALID');let at=32,minimum=null,id=null,signature=false;const dependencies=[];
 for(let i=0;i<n;i++){
  if(at+8>32+total)fail('PORTABLE_QA_MACHO_INVALID');const cmd=original.readUInt32LE(at),size=original.readUInt32LE(at+4);if(size<8||size%8||at+size>32+total)fail('PORTABLE_QA_MACHO_INVALID');
  if(cmd===0x32){if(size<24||minimum!==null||original.readUInt32LE(at+8)!==1)fail('PORTABLE_QA_MINOS');minimum=original.readUInt32LE(at+12);}
  if([0xc,0xd,0x80000018,0x8000001f,0x80000023].includes(cmd)){
   if(size<24)fail('PORTABLE_QA_MACHO_INVALID');const off=original.readUInt32LE(at+8);if(off<24||off>=size)fail('PORTABLE_QA_MACHO_INVALID');const end=original.indexOf(0,at+off);if(end<0||end>=at+size)fail('PORTABLE_QA_MACHO_INVALID');const name=original.subarray(at+off,end).toString('utf8');if(Buffer.from(name).compare(original.subarray(at+off,end))||!name)fail('PORTABLE_QA_MACHO_INVALID');if(cmd===0xd){if(id!==null)fail('PORTABLE_QA_MACHO_INVALID');id=name;}else dependencies.push(name);
  }
  if(cmd===0x1d){if(size!==16||signature)fail('PORTABLE_QA_MACHO_INVALID');const start=original.readUInt32LE(at+8),len=original.readUInt32LE(at+12);if(!len||start>original.length-len)fail('PORTABLE_QA_MACHO_INVALID');signature=true;}
  at+=size;
 }
 if(at!==32+total||minimum!==0xd0000||!signature)fail('PORTABLE_QA_MINOS_OR_SIGNATURE_COMMAND');
 const isNode=relative===moduleRelative,name=relative.slice(libraryRelative.length);if(!isNode&&(!relative.startsWith(libraryRelative)||!runtimeNames.includes(name)))fail('PORTABLE_QA_OUTPUT_PATH');
 if(id!==(isNode?'@rpath/original-auth-identity.node':'@rpath/'+name))fail('PORTABLE_QA_INSTALL_ID');
 const expected=isNode?runtimeNames.map(x=>'@loader_path/original-auth-runtime-libs/'+x):name==='libssl.3.dylib'?['@loader_path/libcrypto.3.dylib']:[];
 same(dependencies.filter(x=>!systemDependency(x)),expected);
 return Object.freeze({relative,minimumSystemVersion:'13.0',minimumOSMetadataOnly:true,installId:id,dependencies,codeSignatureLoadCommandPresent:true,signatureVerified:false,actualOS13Runtime:false,ElectronLoad:false,dataOnly:true,RootAdmission:false,SourceAdmission:false});
}
export function verifyPortableRuntimeRecordDATA(record,moduleBytes,readSource){
 record=captureRecordDATA(record);const r=record.portableRuntime;exact(r,['version','manifest','sourceBuildReceipt','sourceBuildRecipe','sourceMappings','libraryOutputs','licenseOutputs','readback','codeSignVerifications','recordOrdering','adhocQAOnly','productionCodeSigned','actualOS13Runtime','ElectronLoad','RootAdmission','SourceAdmission']);
 same(r.version,1);same(r.manifest,data.runtimeManifestPin);same(r.sourceBuildReceipt,data.sourceBuildReceipt);same(r.sourceBuildRecipe,data.sourceBuildRecipe);same(r.sourceMappings,data.runtimeManifest.libraries);same(r.recordOrdering,'compile53-with-nested-QA-sign -> post-sign-readback -> strong42-root0 -> helper13 -> final-hashes-record -> asar -> outer-App-sign');same(r.adhocQAOnly,true);
 for(const k of['productionCodeSigned','actualOS13Runtime','ElectronLoad','RootAdmission','SourceAdmission'])same(r[k],false);
 for(const x of[data.runtimeManifestPin,data.sourceBuildReceipt,data.sourceBuildRecipe])check(readSource(x.path),x);
 same(r.libraryOutputs.map(x=>x.relative),runtimeNames.map(x=>libraryRelative+x));same(r.licenseOutputs,licenseInputs.map(([name,x])=>({relative:libraryRelative+name,bytes:x.bytes,sha256:x.sha256})));
 for(const x of[...r.libraryOutputs,...r.licenseOutputs]){exact(x,['relative','bytes','sha256']);check(readSource(x.relative),x);}
 const all=[record.output,...r.libraryOutputs];same(r.readback,all.map((x,i)=>inspectPortableMachOQAData(i?readSource(x.relative):moduleBytes,x.relative)));
 const order=[...r.libraryOutputs,record.output];same(r.codeSignVerifications.map(x=>({tool:x.tool,argv:x.argv,exit:x.exit})),order.map(x=>({tool:'/usr/bin/codesign',argv:['--verify','--strict',path.join(record.sourceRoot,x.relative)],exit:0})));
 for(const x of r.codeSignVerifications){exact(x,['tool','argv','exit','stdoutSHA256']);if(!hexd(x.stdoutSHA256))fail('PORTABLE_QA_CODESIGN_RECORD');}
 return {libraryOutputs:r.libraryOutputs,licenseOutputs:r.licenseOutputs,postSignBytesVerified:true,adHocQAExecutionRecorded:true,signatureVerified:false,actualOS13Runtime:false,RootAdmission:false,SourceAdmission:false};
}
export function planCanonicalPortableQAComponentDATA({root,arch,headers}){
 abs(root);abs(headers);if(arch!=='arm64')fail('PORTABLE_QA_DARWIN_ARM64_ONLY');
 const read=rel=>regular(path.join(root,rel)),inventory=read(data.inventory.path);
 if(!canonicalPortableQAProfile(data.version,inventory,read(data.manifestPin.path)))fail('PORTABLE_QA_PROFILE_NOT_SELECTED');
 inspectCanonicalPortableQASourceData(inventory,read);check(read(data.tool.path),data.tool);
 const plan=originalBuild.originalAuthNativeBuildPlan(arch,headers),helper=originalBuild.originalIDEHelperBuildPlan(arch);
 inspectCanonicalPortableQAPlanDATA(plan,root,headers);inspectCanonicalPortableQAHelperPlanDATA(helper,root);
 return {plan,helper,compilerExecuted:false,helperExecuted:false,RootAdmission:false,SourceAdmission:false};
}
/** Original fixed normal entry, only actual command executions produce records.
 * No process runner/provider injection, reused old record or build-only receipt. */
export function buildCanonicalPortableQAComponent({root,arch,headers}){
 if(process.platform!=='darwin'||arch!=='arm64')fail('PORTABLE_QA_DARWIN_ARM64_ONLY');
 inspectCanonicalPortableQAExecutionRuntimeDATA(process.version,process.versions.uv,regular(process.execPath));
 const read=rel=>regular(path.join(root,rel)),inventoryBytes=read(data.inventory.path),prepared=planCanonicalPortableQAComponentDATA({root,arch,headers}),{plan,helper}=prepared;
 const hp=[...data.manifest.node.headers,data.headerVersionPin].map(x=>{const b=regular(path.join(headers,x.name));check(b,x);return{relative:x.name,...pin(b)};});
 const provenanceBefore=PORTABLE_QA_PROVENANCE_NAMES.map(relative=>({relative,...pin(read(relative))}));
 const recordPath=path.join(root,'apps/wallet-desktop/native/original-auth-identity-build.json'),alias=path.join(root,'apps/wallet-desktop/native/YNXIdentityReceiver'),ledgerPath=recordPath+'.portable-qa-attempt.json';
 for(const f of[...plan.intermediateOutputs,plan.output,helper.output,recordPath,alias,ledgerPath,plan.gatePlanFile]){try{lstatSync(f);fail('PORTABLE_QA_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
 const ledger=[];let failed=false,cause;const run=c=>{try{const raw=execFileSync(c.tool,c.argv,{encoding:'buffer',maxBuffer:16<<20});const row={tool:c.tool,argv:c.argv,exit:0,stdoutSHA256:sha(raw)};ledger.push(row);return {raw,row};}catch(e){ledger.push({tool:c.tool,argv:c.argv,exit:e.status??null,signal:e.signal??null,stdoutSHA256:sha(e.stdout??Buffer.alloc(0)),stderrSHA256:sha(e.stderr??Buffer.alloc(0))});throw e;}};
 let record;
 try{
  // command53 is the supplier's zero-argument stage; its nested signing must
  // finish before these original output bytes are read and hashed.
  for(const c of plan.commands)run(c);
  const moduleBytes=regular(plan.output),output={relative:moduleRelative,...pin(moduleBytes)};
  const libraryOutputs=runtimeNames.map(name=>({relative:libraryRelative+name,...pin(read(libraryRelative+name))}));
  const licenseOutputs=licenseInputs.map(([name,x])=>{const b=read(libraryRelative+name);check(b,x);return{relative:libraryRelative+name,...pin(b)};});
  const codeSignVerifications=[...libraryOutputs,output].map(x=>run({tool:'/usr/bin/codesign',argv:['--verify','--strict',path.join(root,x.relative)]}).row);
  const readback=[output,...libraryOutputs].map(x=>inspectPortableMachOQAData(read(x.relative),x.relative));
  const scan=p=>{const {raw}=run(p.ownedUndefinedScan);return canonicalPortableQAOwnedScanRecordDATA(p.ownedUndefinedScan,raw);};
  const nodeScan=scan(plan);exclusive(plan.gatePlanFile,Buffer.from(JSON.stringify(canonicalPortableQAGatePayloadDATA(plan,moduleBytes))+'\n'));
  for(const c of plan.postCommands)run(c);
  for(const row of[...plan.matchingInputs,...plan.systemInputs])check(regular(row.path),row);
  for(const c of helper.commands)run(c);const helperScan=scan(helper),helperBytes=regular(helper.output);
  record=portableQARecordDATA({root,headers,plan,helper,hp,provenanceBefore,moduleBytes,output,libraryOutputs,licenseOutputs,codeSignVerifications,readback,nodeScan,helperScan,helperBytes});
  // Re-read all sources and final nested bytes after gates/helper. Any later
  // nested resign/replace is a failure; no expected pin is silently refreshed.
  verifyPortableQAComponent({record,inventoryBytes,moduleBytes:regular(plan.output),helperBytes},read);
  exclusive(alias,helperBytes,0o755);exclusive(recordPath,Buffer.from(JSON.stringify(record,null,2)+'\n'));
 }catch(e){failed=true;cause=e;}finally{exclusive(ledgerPath,Buffer.from(JSON.stringify({kind:'PORTABLE_QA_ACTUAL_EXECUTION_ATTEMPT/v1',ledger,failed,failureCode:failed?(cause?.code??null):null,recordWritten:!failed,RootAdmission:false,NativeAdmission:false},null,2)+'\n'));}
 if(failed)throw cause;return{recordPath,ledgerPath,nodeTranslationUnits:50,swiftSources:2,objects:51,commands:53,helperTranslationUnits:13,recordWritten:true,nativeQualified:false,RootAdmission:false,SourceAdmission:false,installed:false};
}
/** Fixed application-output mapping from the supplier PACK_CONTRACT. Caller
 * source URLs/paths cannot create assets; full component verification precedes
 * production use. This DATA mapping never claims outer application signing. */
export function portableRuntimePackAssetsDATA(record){
 record=captureRecordDATA(record);if(!isPortableQARecord(record))fail('PORTABLE_QA_PROFILE_NOT_SELECTED');
 same(record.output?.relative,moduleRelative);same(record.portableRuntime?.libraryOutputs?.map(x=>x.relative),runtimeNames.map(x=>libraryRelative+x));same(record.portableRuntime?.licenseOutputs,licenseInputs.map(([name,x])=>({relative:libraryRelative+name,bytes:x.bytes,sha256:x.sha256})));
 return [record.output,...record.portableRuntime.libraryOutputs,...record.portableRuntime.licenseOutputs].map(x=>{exact(x,['relative','bytes','sha256']);if(!Number.isSafeInteger(x.bytes)||x.bytes<1||x.bytes>(16<<20)||!hexd(x.sha256))fail('PORTABLE_QA_OUTPUT_PIN');return Object.freeze({sourceRelative:x.relative,unpackedRelative:x.relative.slice('apps/wallet-desktop/'.length),bytes:x.bytes,sha256:x.sha256,mustBeRegularUnpackedFile:true});});
}
export function assertPortableRuntimePackagedBytesDATA(record,readPackaged){
 const assets=portableRuntimePackAssetsDATA(record);for(const x of assets)check(readPackaged(x.unpackedRelative),x);
 return {assetsVerified:assets.length,nodeSame:true,librariesSame:3,licensesSame:5,outerSignatureVerified:false,ElectronLoad:false,actualOS13Runtime:false,RootAdmission:false,SourceAdmission:false,dataOnly:true};
}

function portableQARecordDATA({root,headers,plan,helper,hp,provenanceBefore,moduleBytes,output,libraryOutputs,licenseOutputs,codeSignVerifications,readback,nodeScan,helperScan,helperBytes}){return {schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:data.headerVersion,minimumSystemVersion:'13.0',readbackOnly:false,commandsKind:'executed-normal-build',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:root,headerRoot:headers,sourceInventory:{relative:data.inventory.path,bytes:data.inventory.bytes,sha256:data.inventory.sha256},inputFiles:rows(data.nodeInputs),headers:hp,architectures:['arm64'],commands:plan.commands,exitCodes:plan.commands.map(()=>0),ownedUndefinedScan:nodeScan,output,sourceProvenanceFiles:provenanceBefore,normalPortableImageRole:{kind:PORTABLE_QA_ROLE,profileId:data.id,manifest:data.manifestPin,runtime:data.manifest.node,systemInputs:data.manifest.systemInputs,nodeExecutable:process.execPath,postCommands:plan.postCommands,postExitCodes:plan.postCommands.map(()=>0)},portableRuntime:{version:1,manifest:data.runtimeManifestPin,sourceBuildReceipt:data.sourceBuildReceipt,sourceBuildRecipe:data.sourceBuildRecipe,sourceMappings:data.runtimeManifest.libraries,libraryOutputs,licenseOutputs,readback,codeSignVerifications,recordOrdering:'compile53-with-nested-QA-sign -> post-sign-readback -> strong42-root0 -> helper13 -> final-hashes-record -> asar -> outer-App-sign',adhocQAOnly:true,productionCodeSigned:false,actualOS13Runtime:false,ElectronLoad:false,RootAdmission:false,SourceAdmission:false},helperBuild:{kind:'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1',sourceRoot:root,architectures:['arm64'],readbackOnly:false,commandsKind:'executed-normal-build',executed:true,serviceRegistered:false,installed:false,nativeQualified:false,appSigned:false,inputFiles:rows(data.helperInputs),commands:helper.commands,exitCodes:helper.commands.map(()=>0),ownedUndefinedScan:helperScan,output:{relative:'apps/developer/helper/YNXIdentityReceiver',...pin(helperBytes)},packagedOutput:'apps/wallet-desktop/native/YNXIdentityReceiver',plist:{relative:data.helperPlist.path,bytes:data.helperPlist.bytes,sha256:data.helperPlist.sha256}}};}

// Immutable module-owned contract; exported DATA views cannot alter expectations.
(function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}})(continuationData);
const continuationRelative='apps/wallet-desktop/scripts/canonical-native-portable-qa-continuation-data.json';
const producerRelative='apps/wallet-desktop/scripts/canonical-native-portable-qa-profile.mjs';
export const PORTABLE_QA_CONTINUATION_PRODUCER_NAMES=Object.freeze([...PORTABLE_QA_PROVENANCE_NAMES,continuationRelative]);
const continuationKind='YNX_WALLET_PORTABLE_ACTUAL62_POST_BUILD_CONTINUATION/v1';
function continuationCommands(){const c=continuationData;return [c.NodeScan,c.helperScan,...[...c.originalOutputs.filter(x=>x.relative.endsWith('.dylib')||x.relative.endsWith('.node')),c.originalOutputs.find(x=>x.relative==='apps/developer/helper/YNXIdentityReceiver')].map(x=>({tool:'/usr/bin/codesign',argv:['--verify','--strict',x.path]})),...c.plan.postCommands].map(({tool,argv})=>({tool,argv}));}
export function inspectPortableQAOriginalAttemptDATA(attempt){
 attempt=captureRecordDATA(attempt);exact(attempt,['kind','ledger','failed','failureCode','recordWritten','RootAdmission','NativeAdmission']);same(attempt.kind,'PORTABLE_QA_ACTUAL_EXECUTION_ATTEMPT/v1');
 same(attempt.failed,true);same(attempt.recordWritten,false);same(attempt.failureCode,'PORTABLE_QA_CLOSED_RECORD');same(attempt.RootAdmission,false);same(attempt.NativeAdmission,false);same(attempt.ledger.length,62);
 for(const [i,r]of attempt.ledger.entries()){exact(r,['tool','argv','exit','stdoutSHA256']);same(r.tool,continuationData.originalCommands[i].tool);same(r.argv,continuationData.originalCommands[i].argv);same(r.exit,0);same(r.stdoutSHA256,continuationData.originalLedgerStdoutSHA256[i]);}
 return {commands:62,allExit0:true,recordWritten:false,failed:true,compilerExecuted:false};
}
/** Closed dual-role metadata. This never upgrades the original failed attempt
 * to success or assigns the record producer's Git identity to the old compile. */
export function verifyPortableQAContinuationRoleDATA(record){
 record=captureRecordDATA(record);const c=continuationData,r=record.normalPortableImageRole?.postBuildContinuation;
 exact(r,['kind','compileSource','originalAttempt','originalFailure','originalOutputs','recordProducer','freshCommands','freshResults','compilerReexecuted','helperReexecuted','RootAdmission','SourceAdmission']);same(r.kind,continuationKind);
 same(r.compileSource,{commit:c.compileSourceCommit,tree:c.compileSourceTree,root:c.compileSourceRoot});same(r.originalAttempt,c.originalAttempt);same(r.originalFailure,c.originalFailure);same(r.originalOutputs,c.originalOutputs);
 for(const k of['compilerReexecuted','helperReexecuted','RootAdmission','SourceAdmission'])same(r[k],false);
 const p=r.recordProducer;exact(p,['commit','root','entry','argv','sourceFiles']);if(!/^[a-f0-9]{40}$/.test(p.commit)||p.commit===c.compileSourceCommit)fail('PORTABLE_QA_CONTINUATION_PRODUCER_GIT');same(p.root,record.sourceRoot);same(record.sourceRoot,c.compileSourceRoot);same(p.entry,producerRelative);
 same(p.argv,[record.normalPortableImageRole.nodeExecutable,path.join(p.root,producerRelative),'--continue-post-build',c.compileSourceRoot,c.headerRoot,p.commit]);same(p.sourceFiles.map(x=>x.relative),PORTABLE_QA_CONTINUATION_PRODUCER_NAMES);
 for(const x of p.sourceFiles){exact(x,['relative','bytes','sha256']);if(!Number.isSafeInteger(x.bytes)||x.bytes<1||x.bytes>(16<<20)||!hexd(x.sha256))fail('PORTABLE_QA_CONTINUATION_PRODUCER_PIN');}
 same(record.headerRoot,c.headerRoot);same(record.inputFiles,rows(data.nodeInputs));same(record.helperBuild.inputFiles,rows(data.helperInputs));same(record.commands,c.plan.commands);same(record.exitCodes,c.plan.commands.map(()=>0));same(record.helperBuild.commands,c.helper.commands);same(record.helperBuild.exitCodes,c.helper.commands.map(()=>0));
 same(record.sourceProvenanceFiles,p.sourceFiles.slice(0,-1));same(r.freshCommands,continuationCommands());same(r.freshResults.map(x=>({tool:x.tool,argv:x.argv,exit:x.exit})),r.freshCommands.map(x=>({...x,exit:0})));
 for(const x of r.freshResults){exact(x,['tool','argv','exit','stdoutSHA256']);if(!hexd(x.stdoutSHA256))fail('PORTABLE_QA_CONTINUATION_RESULT');}
 const outputs=[record.output,...record.portableRuntime.libraryOutputs,...record.portableRuntime.licenseOutputs,record.helperBuild.output];same(outputs,c.originalOutputs.map(({relative,bytes,sha256})=>({relative,bytes,sha256})));
 return {compileSourceCommit:c.compileSourceCommit,recordProducerCommit:p.commit,producerFiles:p.sourceFiles,compileInputs:c.sourceInputs,compileProvenance:c.compileProvenance.map(({relative,bytes,sha256})=>({relative,bytes,sha256})),originalAttempt:c.originalAttempt,compilerReexecuted:false,helperReexecuted:false,RootAdmission:false,SourceAdmission:false};
}
function continuationPin(file,row){check(regular(file),row);}
function continuationGit(root,commit,relative,row){const b=execFileSync('/usr/bin/git',['-C',root,'show',commit+':'+relative],{maxBuffer:16<<20});check(b,row);const entry=execFileSync('/usr/bin/git',['-C',root,'ls-tree',commit,'--',relative],{encoding:'utf8'});if(!/^(100644|100755) blob [a-f0-9]{40}\t/.test(entry))fail('PORTABLE_QA_CONTINUATION_SOURCE_NOT_BLOB');}
function preparePortableQAContinuation({root,headers,producerCommit}){
 abs(root);abs(headers);const c=continuationData;same(root,c.compileSourceRoot);same(headers,c.headerRoot);
 if(typeof producerCommit!=='string'||!/^[a-f0-9]{40}$/.test(producerCommit)||producerCommit===c.compileSourceCommit)fail('PORTABLE_QA_CONTINUATION_PRODUCER_GIT');
 const producerRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');same(producerRoot,root);same(execFileSync('/usr/bin/git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),producerCommit);
 if(execFileSync('/usr/bin/git',['-C',root,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())fail('PORTABLE_QA_CONTINUATION_TRACKED_DIRTY');
 inspectCanonicalPortableQAExecutionRuntimeDATA(process.version,process.versions.uv,regular(process.execPath));
 continuationPin(c.originalAttempt.path,c.originalAttempt);inspectPortableQAOriginalAttemptDATA(JSON.parse(regular(c.originalAttempt.path)));continuationPin(c.originalWrapperResult.path,c.originalWrapperResult);
 for(const x of c.sourceInputs){continuationPin(path.join(root,x.path),x);continuationGit(root,c.compileSourceCommit,x.path,x);continuationGit(root,producerCommit,x.path,x);}
 for(const x of c.compileProvenance)continuationGit(root,c.compileSourceCommit,x.relative,x);
 const producerFiles=PORTABLE_QA_CONTINUATION_PRODUCER_NAMES.map(relative=>({relative,...pin(regular(path.join(root,relative)))}));for(const x of producerFiles)continuationGit(root,producerCommit,x.relative,x);
 for(const x of c.headerPins)continuationPin(x.path,x);for(const x of c.tools){same(fsRealpath(x.requested),x.resolved);continuationPin(x.resolved,x);}for(const x of [...c.originalOutputs,...c.originalObjects,...c.originalGeneratedRecords])continuationPin(x.path,x);
 const {plan,helper}=planCanonicalPortableQAComponentDATA({root,arch:'arm64',headers});same(plan,c.plan);same(helper,c.helper);
 const recordPath=path.join(root,'apps/wallet-desktop/native/original-auth-identity-build.json'),alias=path.join(root,'apps/wallet-desktop/native/YNXIdentityReceiver'),journal=recordPath+'.portable-post-build-continuation.json';for(const f of[recordPath,alias,journal]){try{lstatSync(f);fail('PORTABLE_QA_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return {plan,helper,producerFiles,recordPath,alias,journal};
}
// The filesystem identity check deliberately has no caller-supplied resolver.
function fsRealpath(file){return realpathSync(file);}
export function planCanonicalPortableQAPostBuildContinuation(options){const p=preparePortableQAContinuation(options);return {kind:continuationKind,compileSourceCommit:continuationData.compileSourceCommit,recordProducerCommit:options.producerCommit,originalCommands:62,newCompilerCommands:0,newHelperCommands:0,freshVerificationCommands:continuationCommands(),recordPath:p.recordPath,journal:p.journal,recordWritten:false,RootAdmission:false,SourceAdmission:false};}
export function continueCanonicalPortableQAPostBuild(options){
 if(process.platform!=='darwin')fail('PORTABLE_QA_DARWIN_ARM64_ONLY');const {root,headers,producerCommit}=options,c=continuationData,prepared=preparePortableQAContinuation(options),{plan,helper,producerFiles,recordPath,alias,journal}=prepared;
 same(process.argv,[process.execPath,path.join(root,producerRelative),'--continue-post-build',root,headers,producerCommit]);
 const read=relative=>regular(path.join(root,relative)),ledger=[];let failed=true,cause,record;
 try{
  for(const cmd of continuationCommands()){let raw;try{raw=execFileSync(cmd.tool,cmd.argv,{encoding:'buffer',maxBuffer:16<<20});}catch(e){ledger.push({...cmd,exit:e.status??null,signal:e.signal??null,stdoutSHA256:sha(e.stdout??Buffer.alloc(0)),stderrSHA256:sha(e.stderr??Buffer.alloc(0))});throw e;}ledger.push({...cmd,exit:0,stdoutSHA256:sha(raw)});if(cmd.tool==='/usr/bin/nm')originalBuild.assertOriginalAuthOwnedSymbols(raw.toString());}
  // Gates are checks, never an excuse to refresh a changed expected output.
  preparePortableQAContinuation(options);
  const moduleBytes=read(moduleRelative),helperBytes=regular(helper.output),output={relative:moduleRelative,...pin(moduleBytes)},libraryOutputs=runtimeNames.map(n=>({relative:libraryRelative+n,...pin(read(libraryRelative+n))})),licenseOutputs=licenseInputs.map(([name,x])=>({relative:libraryRelative+name,bytes:x.bytes,sha256:x.sha256}));
  const nodeScan={...ledger[0],ownedUndefined:[]},helperScan={...ledger[1],ownedUndefined:[]};
  const codeSignVerifications=libraryOutputs.concat(output).map(x=>ledger.find(y=>y.tool==='/usr/bin/codesign'&&y.argv[2]===path.join(root,x.relative)));if(codeSignVerifications.some(x=>!x))fail('PORTABLE_QA_CONTINUATION_SIGNATURE_MISSING');
  const readback=[output,...libraryOutputs].map(x=>inspectPortableMachOQAData(read(x.relative),x.relative));
  const hp=c.headerPins.map(({relative,bytes,sha256})=>({relative,bytes,sha256}));
  record=portableQARecordDATA({root,headers,plan,helper,hp,provenanceBefore:producerFiles.slice(0,-1),moduleBytes,output,libraryOutputs,licenseOutputs,codeSignVerifications,readback,nodeScan,helperScan,helperBytes});
  record.normalPortableImageRole.postBuildContinuation={kind:continuationKind,compileSource:{commit:c.compileSourceCommit,tree:c.compileSourceTree,root:c.compileSourceRoot},originalAttempt:c.originalAttempt,originalFailure:c.originalFailure,originalOutputs:c.originalOutputs,recordProducer:{commit:producerCommit,root,entry:producerRelative,argv:process.argv,sourceFiles:producerFiles},freshCommands:continuationCommands(),freshResults:ledger,compilerReexecuted:false,helperReexecuted:false,RootAdmission:false,SourceAdmission:false};
  verifyPortableQAComponent({record,inventoryBytes:read(data.inventory.path),moduleBytes,helperBytes},read);for(const x of producerFiles)continuationPin(path.join(root,x.relative),x);for(const x of c.originalOutputs)continuationPin(x.path,x);
  exclusive(alias,helperBytes,0o755);exclusive(recordPath,Buffer.from(JSON.stringify(record,null,2)+'\n'));failed=false;
 }catch(e){cause=e;}finally{exclusive(journal,Buffer.from(JSON.stringify({kind:'PORTABLE_QA_ACTUAL_POST_BUILD_CONTINUATION_ATTEMPT/v1',originalAttempt:c.originalAttempt,compileSourceCommit:c.compileSourceCommit,recordProducerCommit:producerCommit,ledger,failed,recordWritten:!failed,failureCode:cause?.code??null,RootAdmission:false,NativeAdmission:false},null,2)+'\n'));}
 if(failed)throw cause;return {recordPath,journal,recordWritten:true,compileSourceCommit:c.compileSourceCommit,recordProducerCommit:producerCommit,compilerReexecuted:false,helperReexecuted:false,RootAdmission:false,SourceAdmission:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,root,headers,producerCommit]=process.argv.slice(2);if(process.argv.length!==6||!['--continue-post-build-plan','--continue-post-build'].includes(mode))fail('PORTABLE_QA_CONTINUATION_ARGV_INVALID');
 console.log(JSON.stringify(mode==='--continue-post-build-plan'?planCanonicalPortableQAPostBuildContinuation({root,headers,producerCommit}):continueCanonicalPortableQAPostBuild({root,headers,producerCommit}),null,2));
}

/** Read-only prepublication plan: verifies the immutable original failed
 * attempt's input/output/tool baseline; does not invent a future producer Git. */
export function inspectCanonicalPortableQAPostBuildBaseline(){
 const c=continuationData;continuationPin(c.originalAttempt.path,c.originalAttempt);inspectPortableQAOriginalAttemptDATA(JSON.parse(regular(c.originalAttempt.path)));continuationPin(c.originalWrapperResult.path,c.originalWrapperResult);
 for(const x of c.sourceInputs){continuationPin(path.join(c.compileSourceRoot,x.path),x);continuationGit(c.compileSourceRoot,c.compileSourceCommit,x.path,x);}for(const x of c.compileProvenance)continuationGit(c.compileSourceRoot,c.compileSourceCommit,x.relative,x);
 for(const x of c.headerPins)continuationPin(x.path,x);for(const x of c.tools){same(fsRealpath(x.requested),x.resolved);continuationPin(x.resolved,x);}for(const x of [...c.originalOutputs,...c.originalObjects,...c.originalGeneratedRecords])continuationPin(x.path,x);
 return {status:'ORIGINAL62_BASELINE_PIN_PLAN_PASS_NEW_PRODUCER_GIT_NOT_BOUND',compileSourceCommit:c.compileSourceCommit,originalCommands:62,originalObjects:51,sourceInputs:c.sourceInputs.length,compileProvenance:c.compileProvenance.length,originalOutputs:c.originalOutputs.length,tools:c.tools.length,freshCommands:continuationCommands(),originalFailedAttemptRetained:true,newCompilerCommands:0,newHelperCommands:0,newProducerCommit:'NOT_SUPPLIED_BEFORE_PARENT_PUBLICATION',recordWritten:false,compilerExecuted:false,helperExecuted:false,signatureVerifiedHere:false,RootAdmission:false,SourceAdmission:false};
}

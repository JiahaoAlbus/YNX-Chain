// Closed QA source/build receipt profile. Never Root, Native admission or A.
import {readFileSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync,constants,fstatSync,readSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual,types} from 'node:util';
import path from 'node:path';
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
 exact(record,['schemaVersion','kind','napiVersion','headerVersion','minimumSystemVersion','readbackOnly','commandsKind','appSigned','nativeQualified','registrationAccepted','relativeBases','sourceRoot','headerRoot','sourceInventory','inputFiles','headers','architectures','commands','exitCodes','ownedUndefinedScan','output','sourceProvenanceFiles','normalPortableImageRole','portableRuntime','helperBuild']);exact(r,['kind','profileId','manifest','runtime','systemInputs','nodeExecutable','postCommands','postExitCodes']);same(r.kind,PORTABLE_QA_ROLE);same(r.profileId,data.id);same(r.manifest,data.manifestPin);same(r.runtime,data.manifest.node);same(r.systemInputs,data.manifest.systemInputs);
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
 return {normalCommonImage:true,normalPortableImageRole:r,sourceBytesVerified:true,artifactBytesVerified:true,walletInputs:[],selectedNativeInputs:data.nodeInputs,supplierNodeInputCount:262,portableRuntime:true,runtimeLibraryOutputs:record.portableRuntime.libraryOutputs,licenseOutputs:record.portableRuntime.licenseOutputs,helper:{output:helper.output,packagedOutput:helper.packagedOutput,translationUnits:data.helperTranslationUnits.length,sourceInputs:data.helperInputs.length},installed:false,serviceRegistered:false,nativeQualified:false,SourceAdmission:false};
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
  const scan=p=>{const {raw,row}=run(p.ownedUndefinedScan);originalBuild.assertOriginalAuthOwnedSymbols(raw.toString());return{...p.ownedUndefinedScan,exit:0,stdoutSHA256:row.stdoutSHA256,ownedUndefined:[]};};
  const nodeScan=scan(plan);exclusive(plan.gatePlanFile,Buffer.from(JSON.stringify(canonicalPortableQAGatePayloadDATA(plan,moduleBytes))+'\n'));
  for(const c of plan.postCommands)run(c);
  for(const row of[...plan.matchingInputs,...plan.systemInputs])check(regular(row.path),row);
  for(const c of helper.commands)run(c);const helperScan=scan(helper),helperBytes=regular(helper.output);
  record={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:data.headerVersion,minimumSystemVersion:'13.0',readbackOnly:false,commandsKind:'executed-normal-build',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:root,headerRoot:headers,sourceInventory:{relative:data.inventory.path,bytes:data.inventory.bytes,sha256:data.inventory.sha256},inputFiles:rows(data.nodeInputs),headers:hp,architectures:['arm64'],commands:plan.commands,exitCodes:plan.commands.map(()=>0),ownedUndefinedScan:nodeScan,output,sourceProvenanceFiles:provenanceBefore,normalPortableImageRole:{kind:PORTABLE_QA_ROLE,profileId:data.id,manifest:data.manifestPin,runtime:data.manifest.node,systemInputs:data.manifest.systemInputs,nodeExecutable:process.execPath,postCommands:plan.postCommands,postExitCodes:plan.postCommands.map(()=>0)},portableRuntime:{version:1,manifest:data.runtimeManifestPin,sourceBuildReceipt:data.sourceBuildReceipt,sourceBuildRecipe:data.sourceBuildRecipe,sourceMappings:data.runtimeManifest.libraries,libraryOutputs,licenseOutputs,readback,codeSignVerifications,recordOrdering:'compile53-with-nested-QA-sign -> post-sign-readback -> strong42-root0 -> helper13 -> final-hashes-record -> asar -> outer-App-sign',adhocQAOnly:true,productionCodeSigned:false,actualOS13Runtime:false,ElectronLoad:false,RootAdmission:false,SourceAdmission:false},helperBuild:{kind:'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1',sourceRoot:root,architectures:['arm64'],readbackOnly:false,commandsKind:'executed-normal-build',executed:true,serviceRegistered:false,installed:false,nativeQualified:false,appSigned:false,inputFiles:rows(data.helperInputs),commands:helper.commands,exitCodes:helper.commands.map(()=>0),ownedUndefinedScan:helperScan,output:{relative:'apps/developer/helper/YNXIdentityReceiver',...pin(helperBytes)},packagedOutput:'apps/wallet-desktop/native/YNXIdentityReceiver',plist:{relative:data.helperPlist.path,bytes:data.helperPlist.bytes,sha256:data.helperPlist.sha256}}};
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

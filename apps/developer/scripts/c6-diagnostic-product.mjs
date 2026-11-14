// Independent normal build branch. Its fixed supplier never grants runtime authority.
import {readFile,writeFile,mkdir,symlink,realpath,lstat,unlink,rmdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {verifyPhysicalPin} from './next-product-supplier-input.mjs';
import {C6_HANDOFF as ORIGINAL_C6_HANDOFF,C6_INPUTS} from './c6-diagnostic-input.mjs';
import {C6_SCOPE_HANDOFF,C6_SCOPE_INPUTS} from './c6-scope-phase-input.mjs';
import {CONTROL_MATCHED_HANDOFF,CONTROL_MATCHED_VARIANT,controlMatchedInput,matchedNodePackageSourceRoles} from './c6-control-matched-input.mjs';
export const C6_HANDOFF=CONTROL_MATCHED_HANDOFF;
const exec=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
export const C6_VARIANT='C6_DIAGNOSTIC_NORMAL_PRODUCT';
export function assertC6CocoaReuseDATA(plan,execution,originalPin){
 if(!isDeepStrictEqual(plan.reusedCocoaExecution,originalPin)||!isDeepStrictEqual(execution.cocoaExecution,originalPin)||execution.compiledCocoaReused!==true||!Array.isArray(plan.commands)||plan.commands.length||!isDeepStrictEqual(plan.sourceRoles,plan.CocoaPlan?.sourceRoles)||!isDeepStrictEqual(execution.sourceRoles,plan.CocoaPlan?.sourceRoles))throw Error('Exact original Cocoa custody and separate assembly roles required');
 return true;
}
export async function rethrowC6Primary(error,record,onSecondary=()=>{}){
 try{await record();}catch(secondary){try{onSecondary(secondary);}catch{}}
 throw error;
}
export function assertC6CocoaReceiptDATA(r,p,contractSHA){
 if(p.retainedRootObjects&&!isDeepStrictEqual(r?.normalContinuation,{originalFailedExecution:p.originalFailedExecution,originalInputContract:p.originalInputContract,reusedMainParentObjects:p.retainedRootObjects}))throw Error('Complete same-plan Cocoa continuation custody required');
 if(r?.schema!=='YNX_IDE_C6_PRODUCT_COCOA_EXECUTION/v1'||r.complete!==true||r.error!==null||r.inputContractSHA256!==contractSHA||r.outputRoot!==p.outputRoot||!isDeepStrictEqual(r.sourceRoles,p.sourceRoles)||!isDeepStrictEqual(r.commands,p.commands)||r.results?.length!==p.commands.length||r.results.some((x,i)=>x.name!==p.commands[i].name||x.status!==0||x.signal!==null)||!Array.isArray(r.ownedUndefined)||r.ownedUndefined.length||r.output?.path!==p.output||!Number.isSafeInteger(r.output.bytes)||r.output.bytes<1||!/^[a-f0-9]{64}$/.test(r.output.sha256||''))throw Error('Complete same-plan c6 Cocoa execution required');
 return true;
}
export function assertC6CocoaDependenciesDATA(text,rewrites){
 const dependencies=text.split('\n').slice(1).map(line=>line.trim().split(/\s+/)[0]).filter(Boolean);
 const allowed=new Set(['libssl.3.dylib','libcrypto.3.dylib','libuv.1.dylib'].map(name=>'@rpath/'+name));
 if(dependencies.some(name=>!name.startsWith('/System/')&&!name.startsWith('/usr/lib/')&&!allowed.has(name))||rewrites.some(row=>dependencies.includes(row.from)||!dependencies.includes(row.to)))throw Error('c6 Cocoa vendor dependencies must use the exact relative runtime');
 return true;
}
async function pin(path){const b=await readFile(path);return{path,bytes:b.length,sha256:sha(b)};}
export async function c6Input(){
 // Preserve and verify the original compile/custody branch independently.
 await c6ScopePhaseInput();
 return controlMatchedInput();
}
export async function c6ScopePhaseInput(){
 await verifyPhysicalPin(ORIGINAL_C6_HANDOFF);
 for(const row of Object.values(C6_INPUTS))await verifyPhysicalPin(row);
 const base=JSON.parse(await readFile(C6_INPUTS.baseSourceFiles.path)),baseRoot=dirname(C6_INPUTS.baseSourceFiles.path);
 if(base.privateSupplierCodeCommit!=='5869cd914cf62659adcaa904a3aef1d1a1090cdd'||base.files?.length!==28)throw Error('Exact original c6 supplier source required');
 for(const row of base.files){const path=resolve(baseRoot,row.path);if(!path.startsWith(baseRoot+'/'))throw Error('c6 base supplier path escaped');await verifyPhysicalPin({...row,path});}
 const source=JSON.parse(await readFile(C6_INPUTS.sourceFiles.path)),supplierRoot=dirname(C6_INPUTS.sourceFiles.path);
 if(source.privateSupplierCodeCommit!=='115d4942d33378fea69e51ce55a446c4cd64bae1'||source.sourceBase!==base.privateSupplierCodeCommit||source.files?.length!==10)throw Error('Exact frozen c6 repair source required');
 for(const row of source.files){const path=resolve(supplierRoot,row.path);if(!path.startsWith(supplierRoot+'/')||row.after?.path!==path)throw Error('c6 repair supplier path escaped');await verifyPhysicalPin({...row.after,path});}
 const contract=JSON.parse(await readFile(C6_INPUTS.contract.path));
 if(contract.schema!=='YNX_IDE_C6_DIAGNOSTIC_NORMAL_PRODUCT/v1'||contract.roles.SDKPublic!=='98956ed2bbac8bb5c86de83c4f1df24314e19bf0'||contract.roles.NativeCPP!=='3c9ead1f8a5920fb2428553dfed4e6943f882968'||contract.roles.NativeSwift!=='c6af5521c96433f44b5fa91597fb30415a47c1d6'||contract.finite7!==false||contract.RootAdmission!==false||contract.SourceAdmission!==false)throw Error('Exact ordinary c6 diagnostic cohort required');
 const originalModule=await import(pathToFileURL(C6_INPUTS.module.path));
 for(const row of [contract.c6Reader,contract.projectionModule,contract.helperReader])await verifyPhysicalPin(row);
 await verifyPhysicalPin(C6_SCOPE_HANDOFF);
 for(const row of Object.values(C6_SCOPE_INPUTS))await verifyPhysicalPin(row);
 const successorSource=JSON.parse(await readFile(C6_SCOPE_INPUTS.sourceFiles.path)),successorRoot=dirname(C6_SCOPE_INPUTS.sourceFiles.path);
 if(successorSource.privateSupplierCodeCommit!=='a03725174c45c87525bce012dabcc7510dfe6129'||successorSource.sourceBase!==source.privateSupplierCodeCommit||successorSource.SDKPublic!=='4a807cdc6e09c25467f06cc912a655a294ccc975'||successorSource.files?.length!==39)throw Error('Exact frozen scope-phase supplier source required');
 for(const row of successorSource.files){const path=resolve(successorRoot,row.path);if(!path.startsWith(successorRoot+'/')||row.after?.path!==path)throw Error('Scope-phase supplier path escaped');await verifyPhysicalPin(row.after);}
 const successor=JSON.parse(await readFile(C6_SCOPE_INPUTS.contract.path));
 if(successor.schema!==contract.schema||successor.roles.SDKPublic!=='4a807cdc6e09c25467f06cc912a655a294ccc975'||successor.SDKResourceOnlySuccessor!==true||successor.NativeBuildOrRelinkRequested!==false||successor.finite7!==false||successor.RootAdmission!==false||successor.SourceAdmission!==false||!isDeepStrictEqual(successor.originalCocoaInputContract,C6_INPUTS.contract)||!isDeepStrictEqual(successor.originalCocoaAdopter,C6_INPUTS.module))throw Error('Exact resource-only scope-phase cohort required');
 for(const key of ['NativeCPP','NativeSwift','helperCompile','helperRecordProducer','P03Consumer'])if(successor.roles[key]!==contract.roles[key])throw Error('Scope-phase successor changed compiled role');
 for(const row of [successor.c6Reader,successor.projectionModule,successor.helperReader])await verifyPhysicalPin(row);
 const module=await import(pathToFileURL(C6_SCOPE_INPUTS.module.path));
 return{contract:successor,module,originalContract:contract,originalModule};
}
async function assertCommitted(sourceRoot,sourceCommit){
 const git=async args=>(await exec('/usr/bin/git',args,{cwd:sourceRoot})).stdout.trim();
 if(await git(['rev-parse','HEAD'])!==sourceCommit||await git(['status','--porcelain','--untracked-files=no']))throw Error('Clean committed c6 producer required');
}
export async function buildC6Product({workRoot,binary,minimumOS,sourceCommit,sourceRoot,execute}){
 if(minimumOS!=='15.0')throw Error('Exact measured c6 target required');
 await assertCommitted(sourceRoot,sourceCommit);
 const{contract,module}=await c6Input(),planner=await import(pathToFileURL(C6_INPUTS.cocoaPlan.path));
 if(contract.SDKResourceOnlySuccessor===true){
  const receipt=JSON.parse(await readFile(C6_SCOPE_INPUTS.originalCocoaReceipt.path));
  const p=planner.cocoaPlanDATA(receipt.outputRoot);
  assertC6CocoaReceiptDATA(receipt,p,C6_INPUTS.contract.sha256);
  for(const row of p.sourceInputs){if(!row.relativePath?.startsWith('apps/developer/desktop/macos/')||row.path!==join(sourceRoot,row.relativePath))throw Error('Original Cocoa source escaped');await verifyPhysicalPin(row);}
  const plan={schema:'YNX_IDE_C6_PRODUCT_PLAN/v1',variant:C6_VARIANT,sourceCommit,SDKSourceCommit:contract.roles.SDKPublic,sourceRoles:p.sourceRoles,supplierHandoff:C6_HANDOFF,commands:[],objectCount:p.objectCount,inputs:[{...p.singleGoArchive,relativePath:'packages/wallet-auth/native/vendor/link/libynx_artifact_release.a'}],CocoaPlan:p,reusedCocoaExecution:C6_SCOPE_INPUTS.originalCocoaReceipt,minimumOS,binary,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,finite7:false};
  await mkdir(workRoot,{mode:0o700});await writeFile(join(workRoot,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  if(!execute)return plan;
  await module.adoptDiagnosticCocoa({receipt:C6_SCOPE_INPUTS.originalCocoaReceipt.path,binary});
  const undefinedText=(await exec('/usr/bin/nm',['-u',binary],{maxBuffer:16*1024**2})).stdout;
  const ownedUndefined=module.ownedCocoaUndefinedDATA(undefinedText);
  if(ownedUndefined.length)throw Error('Reused Cocoa owned undefined symbols remain');
  await writeFile(join(workRoot,'undefined.txt'),undefinedText,{flag:'wx'});
  await module.stageDiagnosticAssets(binary.slice(0,-'/Contents/MacOS/YNXDeveloper'.length)+'/Contents/Resources/code/apps/developer');
  await assertCommitted(sourceRoot,sourceCommit);
  await writeFile(join(workRoot,'execution.json'),JSON.stringify({sourceCommit,complete:true,ownedUndefined,binarySHA256:receipt.output.sha256,cocoaExecution:C6_SCOPE_INPUTS.originalCocoaReceipt,sourceRoles:p.sourceRoles,compiledCocoaReused:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false},null,2)+'\n',{flag:'wx'});
  return{staged:true,binary,sourceCommit,sourceRoles:p.sourceRoles,compiledCocoaReused:true};
 }
 const cocoaRoot=join(workRoot,'cocoa'),p=planner.cocoaPlan(cocoaRoot);
 for(const row of p.sourceInputs){
  if(!row.relativePath?.startsWith('apps/developer/desktop/macos/')||row.path!==join(sourceRoot,row.relativePath))throw Error('c6 native consumer source escaped');
  await verifyPhysicalPin(row);
 }
 const plan={schema:'YNX_IDE_C6_PRODUCT_PLAN/v1',variant:C6_VARIANT,sourceCommit,SDKSourceCommit:contract.roles.SDKPublic,sourceRoles:p.sourceRoles,supplierHandoff:C6_HANDOFF,commands:p.commands,objectCount:p.objectCount,inputs:[{...p.singleGoArchive,relativePath:'packages/wallet-auth/native/vendor/link/libynx_artifact_release.a'}],CocoaPlan:p,minimumOS,binary,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,finite7:false};
 await mkdir(workRoot,{mode:0o700});
 await writeFile(join(workRoot,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
 if(!execute)return plan;
 await mkdir(join(cocoaRoot,'objects'),{recursive:true,mode:0o700});
 await mkdir(dirname(p.output),{recursive:true,mode:0o700});
 const temporary=join(cocoaRoot,'tmp');await mkdir(temporary,{mode:0o700});
 // A short compiler-only alias points into this same owned output. No source
 // path, runtime isolation or user's environment is rewritten.
 const{mkdtemp}=await import('node:fs/promises');
 const aliasRoot=await mkdtemp('/private/tmp/ynx-c6-build-'),alias=join(aliasRoot,'tmp');
 await symlink(temporary,alias);
 const receipt={schema:'YNX_IDE_C6_PRODUCT_COCOA_EXECUTION/v1',outputRoot:cocoaRoot,inputContractSHA256:C6_INPUTS.contract.sha256,sourceRoles:p.sourceRoles,commands:p.commands,results:[],complete:false,error:null,...(p.retainedRootObjects?{normalContinuation:{originalFailedExecution:p.originalFailedExecution,originalInputContract:p.originalInputContract,reusedMainParentObjects:p.retainedRootObjects}}:{})};
 const receiptPath=join(workRoot,'cocoa-execution.json');
 const save=()=>writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');
 const secondary=error=>{(receipt.secondaryErrors??=[]).push(String(error?.code||'C6_RECORD_WRITE_FAILED'));console.warn('C6_SECONDARY_RECORD_FAILED');};
 let primaryFailure=false;
 try{
  for(const[name,command]of p.commands.entries()){
   await assertCommitted(sourceRoot,sourceCommit);
   const state=await lstat(aliasRoot);
   if(state.uid!==process.getuid()||!state.isDirectory()||state.isSymbolicLink()||await realpath(alias)!==temporary)throw Error('Compiler temporary alias changed');
   let result;
   try{result=await exec(command.argv[0],command.argv.slice(1),{cwd:cocoaRoot,env:{...process.env,TMPDIR:alias},timeout:885000,maxBuffer:16*1024**2});}
   catch(error){receipt.results.push({name:command.name,status:error.code??null,signal:error.signal??null});await rethrowC6Primary(error,()=>writeFile(join(workRoot,`cocoa-${name}.stderr`),error.stderr||''),secondary);}
   await writeFile(join(workRoot,`cocoa-${name}.stdout`),result.stdout);await writeFile(join(workRoot,`cocoa-${name}.stderr`),result.stderr);
   receipt.results.push({name:command.name,status:0,signal:null});await save();
  }
  const undefinedText=(await exec('/usr/bin/nm',['-u',p.output],{maxBuffer:16*1024**2})).stdout;
  await writeFile(join(workRoot,'undefined.txt'),undefinedText,{flag:'wx'});
  receipt.ownedUndefined=module.ownedCocoaUndefinedDATA(undefinedText);
  if(receipt.ownedUndefined.length)throw Error('c6 Cocoa owned undefined symbols remain');
  const dependencies=(await exec('/usr/bin/otool',['-L',p.output],{maxBuffer:1024**2})).stdout;
  const cocoaInputs=JSON.parse(await readFile(C6_INPUTS.cocoaInputs.path));
  assertC6CocoaDependenciesDATA(dependencies,cocoaInputs.relativeLibraryRewrites);
  await writeFile(join(workRoot,'cocoa-dependencies.txt'),dependencies,{flag:'wx'});
  receipt.dependencies=await pin(join(workRoot,'cocoa-dependencies.txt'));
  receipt.output=await pin(p.output);receipt.complete=true;await save();
  await module.adoptDiagnosticCocoa({receipt:receiptPath,binary});
  await module.stageDiagnosticAssets(binary.slice(0,-'/Contents/MacOS/YNXDeveloper'.length)+'/Contents/Resources/code/apps/developer');
  await writeFile(join(workRoot,'execution.json'),JSON.stringify({sourceCommit,complete:true,ownedUndefined:[],binarySHA256:receipt.output.sha256,cocoaExecution:await pin(receiptPath),sourceRoles:p.sourceRoles,RootAdmission:false,SourceAdmission:false,NativeAdmission:false},null,2)+'\n',{flag:'wx'});
 }catch(error){primaryFailure=true;receipt.complete=false;receipt.error=String(error?.code||error?.message||'C6_COMPILER_FAILED');await rethrowC6Primary(error,save,secondary);}
 finally{
  try{
   if(await realpath(alias)!==temporary)throw Error('Compiler alias changed; retained for reconciliation');
   await unlink(alias);await rmdir(aliasRoot);
  }catch(error){receipt.cleanupError=String(error.message);if(!primaryFailure)await rethrowC6Primary(error,save,secondary);else try{await save();}catch(writeError){secondary(writeError);}}
 }
 return{staged:true,binary,sourceCommit,sourceRoles:p.sourceRoles};
}
export async function copyC6SDK(destination){const{module}=await c6Input();return module.copyDiagnosticSDK(destination);}
export async function finalizeC6(app){const{module}=await c6Input();return module.postNestedDiagnostic(app);}
export async function preservedC6Signatures(app){
 if(resolve(app)!==app||await realpath(app)!==app)throw Error('Canonical c6 App required');
 const{contract,module}=await c6Input(),developer=join(app,'Contents/Resources/code/apps/developer');
 const rows=contract.assets.filter(row=>row.machO).map(row=>({...row,path:join(developer,row.relative)}));
 rows.push({...contract.targetNode,path:join(app,'Contents/Resources/runtime/node'),mode:0o755});
 for(const row of rows){
  module.readRegular(row.path,row);
  await exec('/usr/bin/codesign',['--verify','--strict',row.path]);
  const metadata=await exec('/usr/bin/codesign',['--display','--verbose=4',row.path]);
  if(!/^Signature=adhoc$/m.test(metadata.stderr)||!/^TeamIdentifier=not set$/m.test(metadata.stderr))throw Error('Pinned c6 component must retain approved no-Team ad-hoc class');
 }
 return rows.map(({path,bytes,sha256,mode})=>({path,bytes,sha256,mode}));
}
export async function c6SourceRoles(app,applicationCommit,applicationTree){
 const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
 await assertCommitted(sourceRoot,applicationCommit);
 if((await exec('/usr/bin/git',['rev-parse','HEAD^{tree}'],{cwd:sourceRoot})).stdout.trim()!==applicationTree)throw Error('Exact c6 producer tree required');
 const ownLoader=join(sourceRoot,'apps/developer/desktop/identity-sdk-loader.mjs'),packedLoader=join(app,'Contents/Resources/code/apps/developer/desktop/identity-sdk-loader.mjs');
 if(!(await readFile(ownLoader)).equals(await readFile(packedLoader)))throw Error('Packaged c6 loader differs from committed producer');
 const{contract,module,originalContract}=await c6Input();
 const folder=join(app,'Contents/Resources/native-link'),plan=JSON.parse(await readFile(join(folder,'plan.json'))),execution=JSON.parse(await readFile(join(folder,'execution.json')));
 if(plan.variant!==C6_VARIANT||plan.supplierHandoff.sha256!==C6_HANDOFF.sha256||plan.sourceCommit!==applicationCommit||execution.sourceCommit!==applicationCommit||execution.complete!==true||execution.ownedUndefined.length)throw Error('Matching c6 product execution required');
 assertC6CocoaReuseDATA(plan,execution,C6_SCOPE_INPUTS.originalCocoaReceipt);
 await verifyPhysicalPin(execution.cocoaExecution);
 const original=JSON.parse(await readFile(execution.cocoaExecution.path)),planner=await import(pathToFileURL(C6_INPUTS.cocoaPlan.path)),expected=planner.cocoaPlanDATA(original.outputRoot);
 assertC6CocoaReceiptDATA(original,expected,C6_INPUTS.contract.sha256);
 if(!isDeepStrictEqual(plan.CocoaPlan,expected)||!isDeepStrictEqual(execution.sourceRoles,expected.sourceRoles)||execution.binarySHA256!==original.output.sha256)throw Error('c6 role receipt differs from actual Cocoa execution');
 module.verifyDiagnosticAssets(join(app,'Contents/Resources/code/apps/developer'));
 return{schema:'YNX_IDE_CURRENT_PACKAGE_SOURCE_ROLES/v1',applicationSourceCommit:applicationCommit,applicationSourceTree:applicationTree,assembledSourceCommit:applicationCommit,compiledNativeSourceCommit:contract.roles.NativeCPP,compiledNativeSwiftSourceCommit:contract.roles.NativeSwift,SDKResourceSourceCommit:contract.roles.SDKPublic,consumerVariantSourceCommit:contract.roles.P03Consumer,diagnosticConsumerSourceCommit:contract.roles.P03DiagnosticConsumer,compiledSDKSourceCommit:originalContract.roles.SDKPublic,compiledCocoaReceipt:C6_SCOPE_INPUTS.originalCocoaReceipt,helperCompileSourceCommit:contract.roles.helperCompile,sourceVariant:CONTROL_MATCHED_VARIANT,...matchedNodePackageSourceRoles(contract),originalNativeReceiptsPreserved:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,finite7:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4||process.argv[2]!=='--preserved-signatures')throw Error('Exact c6 signature-preservation input required');
 console.log(JSON.stringify(await preservedC6Signatures(process.argv[3])));
}

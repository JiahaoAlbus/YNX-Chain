import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyPhysicalPin} from './next-product-supplier-input.mjs';
import {ownedUndefinedSymbols} from './native-macos-link-plan.mjs';
import {assertBundledSDKPublicExports} from '../desktop/identity-sdk-loader.mjs';
import {readRoot63NativeCompletion} from './root63-native-completion.mjs';
export const ROOT63_HANDOFF='/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-root14-product45-normal-builder-successor-20261101/resource8-successor/package-consumer-successor/archive-gate-post-successor/normal-finish-successor/final-sdk-resource-successor/HANDOFF.json';
const accepted={path:ROOT63_HANDOFF,bytes:13462,sha256:'ec37a3546dce6cb6eb0fdd6b0ec613a05dd5e3d176680d864fbd142e1285bd43'};
const sha=b=>createHash('sha256').update(b).digest('hex');
const developer=fileURLToPath(new URL('../',import.meta.url));
async function readPin(row){await verifyPhysicalPin(row);return JSON.parse(await readFile(row.path));}
async function pin(path){const b=await readFile(path),r={path,bytes:b.length,sha256:sha(b)};await verifyPhysicalPin(r);return r;}
export async function root63Input(){
 const h=await readPin(accepted);
 if(h.schema!=='YNX_ROOT63_795_FINAL_PRODUCTION_RESOURCE_HANDOFF/v1'||h.sourceCommit!=='c1d0af61a5b1be9b3905768c7019a9bc1d974d0d'||h.publicSDKSourceCommit!=='795991c5f2877b4abe7b555b34f0b8ffec7eea13'||h.AppBuilt!==false||h.RootAdmission!==false||h.SourceAdmission!==false)throw Error('Exact final Root63 production resource required');
 for(const key of ['SOURCEFILES','sourceBundle','FUNCTION_RESULT','productionAuthorityH','productionDependencyReadback','sixOriginalArchiveClosure','completePrefix','sourceComposition','projection','runtimeInventory','binding','codePins','actualNativeCompletion','completeNativeOutput','finalResourceContract','normalResourcePlan','copyEntry','postNestedEntry','postNestedModule','P03FiniteLoaderDelta','actualSupplierReadback'])await verifyPhysicalPin(h[key]);
 const inventory=JSON.parse(await readFile(h.SOURCEFILES.path));
 for(const row of inventory.files)await verifyPhysicalPin(row);
 const code=JSON.parse(await readFile(h.codePins.path));
 const packagePin=code.files.find(row=>row.path==='package.json');
 if(!packagePin)throw Error('Root63 SDK package pin missing');
 const packagePath=join(h.projectedPhysicalPrefix,'package.json');await verifyPhysicalPin({...packagePin,path:packagePath});
 assertBundledSDKPublicExports(JSON.parse(await readFile(packagePath)));
 return h;
}
export function assertRoot63Completion(e,o,h){
 const r=h.sourceRoles,names=['clone-exact-native-source','checkout-exact-native-source','cold63-normal-native','normal-current-P03-main.m','normal-current-P03-ynx-wallet-admission-parent.m','strict-root63-Cocoa-link','helper13-normal'];
 if(e.schema!=='YNX_IDE_ROOT63_COLD_NORMAL_EXECUTION/v1'||e.complete!==true||e.error!==null||e.sourceRoles?.native!==r.NativeCompiler||e.sourceRoles?.publicSDK!==r.SDKPublic||e.sourceRoles?.P03Native!==r.P03MainAndConsumer9||JSON.stringify(e.results?.map(x=>x.name))!==JSON.stringify(names)||e.results.some(x=>x.status!==0||x.signal!==null))throw Error('Root63 complete same-attempt journal required');
 if(o.schema!=='YNX_IDE_ROOT63_COLD_NORMAL_OUTPUTS/v1'||o.nativeSourceCommit!==r.NativeCompiler||o.publicSDKSourceCommit!==r.SDKPublic||o.P03NativeSourceCommit!==r.P03MainAndConsumer9||o.NativeRuntime?.length!==9||o.compiledByThisInvocation!==true||o.originalAuthComponentNotUsedAsBuildOutput!==true)throw Error('Root63 complete matching outputs required');
}
export async function runRoot63(mode){
 if(mode!=='--plan')throw Error('Native continuation is already complete; use the normal whole-package producer');
 const h=await root63Input(),n=await readRoot63NativeCompletion();return {resource:h.sourceCommit,native:n.o.sourceRoles,NativeCompileRepeated:false};
}
async function complete(h){
 const n=await readRoot63NativeCompletion();
 if(h.completeNativeOutput.sha256!==n.outputsPin.sha256)throw Error('Final resource is bound to another native output');
 const attempt=await readPin(n.o.originalFailedAttempt),gate=await readPin(n.post.compileRole.originalGatePlan);
 return {...n,nativeManifest:JSON.parse(await readFile(n.h.normalManifest.path)),cold:{commands:attempt.ledger.slice(0,65),sourceInputs:n.post.sourceInputs,sourceRoot:n.o.sourceRoot,image:gate.image},roles:{...n.o.sourceRoles,SDKPackageFinal:h.publicSDKSourceCommit}};
}
export async function adoptRoot63({workRoot,binary,minimumOS,sourceCommit,sourceRoot,execute}){
 const h=await root63Input(),{e,o,cold,roles,post,nativeManifest}=await complete(h);
 const nativeInputs=nativeManifest.sourcePins.filter(row=>row.path.includes('apps/developer/desktop/macos/'));
 if(nativeInputs.length!==9)throw Error('Exact nine native consumer inputs required');
 for(const row of nativeInputs){const marker='apps/developer/desktop/macos/',at=row.path.indexOf(marker);await verifyPhysicalPin({...row,path:join(sourceRoot,row.path.slice(at))});}
 const undefinedText=execFileSync('/usr/bin/nm',['-u',o.CocoaExecutable.path],{encoding:'utf8'});if(ownedUndefinedSymbols(undefinedText).length)throw Error('Root63 Cocoa owned symbols unresolved');
 const appCommands=e.results.map(x=>({tool:x.argv[0],argv:x.argv.slice(1)}));
 const plan={schema:'YNX_IDE_CURRENT_PRODUCT_QA_LINK_PLAN/v1',variant:'ROOT63_RESOURCE8',sourceCommit,compiledSource:{commit:roles.nativeCompilation},SDKSourceCommit:h.publicSDKSourceCommit,root63Handoff:accepted,minimumOS,workRoot,binary,commands:[...cold.commands,...appCommands],inputs:post.sourceInputs.map(row=>({...row,relativePath:relative(o.sourceRoot,row.path)})),originalFailedAttempt:o.originalFailedAttempt,originalFailedExecution:o.originalFailedExecution,postCompletion:o.postCompletion,nativeOutputs:h.completeNativeOutput,sourceRoles:roles,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
 await mkdir(workRoot,{mode:0o700});await writeFile(join(workRoot,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
 if(!execute)return plan;
 if(!binary.endsWith('/Contents/MacOS/YNXDeveloper'))throw Error('Exact normal App binary required');
 const app=binary.slice(0,-'/Contents/MacOS/YNXDeveloper'.length),native=join(app,'Contents/Resources/code/apps/developer/apps/wallet-desktop/native');
 async function clone(row,to){await verifyPhysicalPin(row);await mkdir(dirname(to),{recursive:true});await copyFile(row.path,to,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);await verifyPhysicalPin({...row,path:to});}
 await clone(o.CocoaExecutable,binary);await clone(o.helper,join(app,'Contents/Resources/code/apps/developer/helper/YNXIdentityReceiver'));
 const names=['original-auth-identity.node',...['libssl.3.dylib','libcrypto.3.dylib','libuv.1.dylib','LIBUV-LICENSE-docs.txt','LIBUV-LICENSE-extra.txt','LIBUV-LICENSE.txt','OPENSSL-AUTHORS.md','OPENSSL-LICENSE.txt'].map(x=>'original-auth-runtime-libs/'+x)];
 const seen=new Set();for(const row of o.NativeRuntime){const rel=row.relative;if(!names.includes(rel)||seen.has(rel))throw Error('Root63 native output escaped or duplicated');seen.add(rel);await clone(row,join(native,rel));}
 if(seen.size!==9)throw Error('Exact nine native assets required');
 await writeFile(join(workRoot,'undefined.txt'),undefinedText,{flag:'wx'});await writeFile(join(workRoot,'execution.json'),JSON.stringify({sourceCommit,complete:true,ownedUndefined:[],binarySHA256:o.CocoaExecutable.sha256,compiledNativeSource:roles.nativeCompilation,sourceRoles:roles,nativeOutputs:h.completeNativeOutput,originalFailedExecution:o.originalFailedExecution,RootAdmission:false,SourceAdmission:false,NativeAdmission:false},null,2)+'\n',{flag:'wx'});
 return {staged:true,binary,sourceCommit};
}
export async function copyRoot63(app){const h=await root63Input();return JSON.parse(execFileSync(h.copyCLI[0],[h.copyEntry.path,app],{encoding:'utf8',env:process.env,maxBuffer:4*1024**2}));}
export async function finalizeRoot63(app){const h=await root63Input();await complete(h);execFileSync(h.postNestedCLI[0],[h.postNestedEntry.path,app],{stdio:'inherit',env:process.env});}
export async function root63SourceRoles(app,sourceCommit,sourceTree){
 const h=await root63Input(),{roles}=await complete(h),p=JSON.parse(await readFile(join(app,'Contents/Resources/native-link/plan.json')));
 if(p.variant!=='ROOT63_RESOURCE8'||p.root63Handoff?.sha256!==accepted.sha256||p.sourceCommit!==sourceCommit||p.SDKSourceCommit!==h.publicSDKSourceCommit||p.nativeOutputs?.sha256!==h.completeNativeOutput.sha256)throw Error('Root63 packaged source role differs');
 const git=a=>execFileSync('/usr/bin/git',a,{cwd:developer,encoding:'utf8'}).trim();if(git(['rev-parse','HEAD'])!==sourceCommit||git(['rev-parse','HEAD^{tree}'])!==sourceTree||git(['status','--porcelain','--untracked-files=no']))throw Error('Root63 current source differs');
 const binding=join(app,'Contents/Resources/code/apps/developer/identity-sdk-projection-binding.json');await verifyPhysicalPin({...h.binding,path:binding});
 return {schema:'YNX_IDE_CURRENT_PACKAGE_SOURCE_ROLES/v1',applicationSourceCommit:sourceCommit,assembledSourceCommit:sourceCommit,compiledNativeSourceCommit:roles.nativeCompilation,gatePostProducerSourceCommit:roles.gatePostProducer,normalFinishProducerSourceCommit:roles.normalFinishProducer,SDKResourceSourceCommit:h.publicSDKSourceCommit,consumerVariantSourceCommit:roles.P03Native,sourceVariant:h.sourceVariant,originalNativeReceiptsPreserved:true,originalColdFailurePreserved:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
}

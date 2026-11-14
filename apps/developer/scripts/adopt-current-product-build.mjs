import {readFile,writeFile,mkdir,copyFile,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname,relative,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {currentProductQAInput,currentProductContinuationInput} from './current-product-supplier-qa.mjs';
import {ownedUndefinedSymbols} from './native-macos-link-plan.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function pin(path){const stat=await lstat(path),b=await readFile(path);if(!stat.isFile()||stat.isSymbolicLink()||await realpath(path)!==path)throw Error('Regular canonical cold output required');return {path,bytes:b.length,sha256:sha(b)};}
async function clone(row,to){const p=await pin(row.path);if(p.bytes!==row.bytes||p.sha256!==row.sha256)throw Error('Cold output changed');await mkdir(dirname(to),{recursive:true});await copyFile(row.path,to,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);const after=await pin(to);if(after.bytes!==p.bytes||after.sha256!==p.sha256)throw Error('Cold output copy differs');return after;}
export function assertCurrentColdCompletion(result,expectedSource){
 if(result?.complete!==true||result.source?.commit!==expectedSource||!Array.isArray(result.results)||!result.results.length||result.results.some(r=>r.status!==0||r.signal!==null))throw Error('Same current cold build must complete before normal packaging; reconcile existing failure, do not rerun');
 const names=result.results.map(r=>r.name);
 if(new Set(names).size!==names.length||names[0]!=='original-cold-Node53-strict55-and-canonical-completion'||!names.some(n=>['strict-current-Cocoa-link','strict-current-Cocoa-link-pay-closure'].includes(n))||names.at(-1)!=='original-fresh-helper13-owned-U0')throw Error('Complete Node, Cocoa and helper stages required');
}
export async function adoptCurrentProductBuild({handoff,workRoot,binary,minimumOS,sourceCommit,sourceRoot,execute}){
 const h=await currentProductQAInput(handoff),m=JSON.parse(await readFile(h.normalQAExecutionData.path));
 let result=JSON.parse(await readFile(join(h.execution.qaOutputRoot,'EXECUTION.json'))),continuation=null,cold;
 if(result.complete!==true){
  continuation=await currentProductContinuationInput();
  const journal=JSON.parse(await readFile(continuation.expectedFutureCompletionJournal));
  if(journal.kind!=='SAME_SOURCE_CONTINUATION_EXECUTION/v1'||journal.complete!==true||journal.source.commit!==h.source.commit||journal.originalExecution.sha256!==continuation.oldExecution.sha256||result.results.length!==4||result.results[3].status!==1||journal.results.length!==2||journal.results[0].name!=='strict-current-Cocoa-link-pay-closure')throw Error('Exact successful continuation and retained original failure required');
  result={complete:true,source:result.source,results:[...result.results.slice(0,3),...journal.results]};
  cold=JSON.parse(await readFile(continuation.expectedFutureOutputReceipt));
  if(cold.kind!=='SAME_SOURCE674_COLD_BUILD_CONTINUATION_OUTPUTS/v1'||cold.noOldExecutionRewrite!==true||cold.originalFailedStageRetained!==true||cold.CocoaExecutable!==continuation.expectedFutureCocoa||cold.helper!==continuation.expectedFutureHelper)throw Error('Current continuation outputs differ');
 }else cold=JSON.parse(await readFile(join(h.execution.qaOutputRoot,'COLD_BUILD_OUTPUTS.json')));
 assertCurrentColdCompletion(result,h.source.commit);
 const expectedNames=['original-auth-identity.node',...['libcrypto.3.dylib','libssl.3.dylib','libuv.1.dylib','LIBUV-LICENSE-docs.txt','LIBUV-LICENSE-extra.txt','LIBUV-LICENSE.txt','OPENSSL-AUTHORS.md','OPENSSL-LICENSE.txt'].map(n=>'original-auth-runtime-libs/'+n)].sort();
 if(cold.source?.commit!==h.source.commit||!Array.isArray(cold.NativeRuntime)||JSON.stringify(cold.NativeRuntime.map(r=>relative(dirname(m.normalNodePlan.output),r.path)).sort())!==JSON.stringify(expectedNames)||cold.CocoaExecutable!==(continuation?.expectedFutureCocoa??m.CocoaBinary)||cold.helper!==m.helperBinary||(!continuation&&cold.supplierImageHashNotInherited!==true))throw Error('Exact same-attempt complete native runtime, Cocoa and helper outputs required');
 async function jsonPin(row){const actual=await pin(row.path);if(actual.bytes!==row.bytes||actual.sha256!==row.sha256)throw Error('Current resource metadata differs');return JSON.parse(await readFile(row.path));}
 const resource=await jsonPin(h.currentResourceH),prefix=await jsonPin(resource.completePrefix),profile=await jsonPin(resource.currentResourceSDKProfile),abi=await jsonPin(profile.consumerABI);
 if(abi.currentConsumer.length!==27)throw Error('Exact current native and caller ABI required');
 for(const row of abi.currentConsumer){if(!row.relativePath.startsWith('apps/developer/')||row.relativePath.split('/').includes('..'))throw Error('Consumer ABI path escaped');const actual=await pin(join(sourceRoot,row.relativePath));if(actual.bytes!==row.bytes||actual.sha256!==row.sha256)throw Error('Current producer consumer ABI differs from compiled current source: '+row.relativePath);}
 const cocoa=await pin(cold.CocoaExecutable),helper=await pin(cold.helper);
 const undefinedText=execFileSync('/usr/bin/nm',['-u',cocoa.path],{encoding:'utf8',maxBuffer:4*1024*1024}),owned=ownedUndefinedSymbols(undefinedText);if(owned.length)throw Error('Cold Cocoa owned symbols remain undefined');
 const plan={schema:'YNX_IDE_CURRENT_PRODUCT_QA_LINK_PLAN/v1',sourceCommit,compiledSource:h.source,SDKSourceCommit:prefix.sourceCommit,SDKHandoff:h.currentResourceH,supplierWholeHandoff:{path:resolve(handoff),bytes:5812,sha256:'4b04aa6cc1154e7a487407406a2d17e4890f01c0c2aa75f5bdf166cf018971bf'},minimumOS,workRoot,binary,commands:[...m.normalNodePlan.commands,...m.CocoaCommands],inputs:m.normalNodePlan.matchingInputs.map(row=>({...row,relativePath:relative(m.buildRoot,row.path)})),coldOutputs:cold,compilerExecutedByAdapter:false,consumerABILeavesVerified:27,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
 await mkdir(workRoot,{mode:0o700});await writeFile(join(workRoot,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
 if(!execute)return {validated:true,plan:join(workRoot,'plan.json'),compilerExecuted:false};
 if(!binary.endsWith('/Contents/MacOS/YNXDeveloper'))throw Error('Exact normal App binary path required');
 const app=binary.slice(0,-'/Contents/MacOS/YNXDeveloper'.length),developer=join(app,'Contents/Resources/code/apps/developer'),native=join(developer,'apps/wallet-desktop/native');
 await clone(cocoa,binary);await clone(helper,join(developer,'helper/YNXIdentityReceiver'));
 for(const row of cold.NativeRuntime){const rel=relative(dirname(m.normalNodePlan.output),row.path);if(rel.startsWith('../')||rel.includes('\\'))throw Error('Cold native output escaped');await clone(row,join(native,rel));}
 await writeFile(join(workRoot,'undefined.txt'),undefinedText,{flag:'wx'});
 await writeFile(join(workRoot,'execution.json'),JSON.stringify({sourceCommit,compiledSourceCommit:h.source.commit,complete:true,coldBuildReusedFromSameCurrentAttempt:true,compilerRepeated:false,ownedUndefined:owned,binarySHA256:cocoa.sha256,NativeRuntime:cold.NativeRuntime,helper,RootAdmission:false,SourceAdmission:false,NativeAdmission:false},null,2)+'\n',{flag:'wx'});
 return {staged:true,sourceCommit,compiledSourceCommit:h.source.commit,binary,compilerRepeated:false};
}

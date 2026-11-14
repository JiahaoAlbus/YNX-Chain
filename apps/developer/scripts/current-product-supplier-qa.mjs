import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const accepted={bytes:5812,sha256:'4b04aa6cc1154e7a487407406a2d17e4890f01c0c2aa75f5bdf166cf018971bf'};
async function pinned(row){
 const stat=await lstat(row.path),bytes=await readFile(row.path);
 if(!stat.isFile()||stat.isSymbolicLink()||await realpath(row.path)!==row.path||bytes.length!==row.bytes||createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('Current-product supplier input changed: '+row.path);
 return bytes;
}
// An explicit ordinary QA profile, separate from the retained A-only recipe.
// Artifact identity never grants a Source, Root, account or signing approval.
export async function currentProductQAInput(path){
 const handoff=JSON.parse(await pinned({path:resolve(path),...accepted}));
 if(handoff.kind!=='SDK49_IDE_CURRENT_P03_R2_NORMAL_ORDINARY_QA_EXECUTABLE_HANDOFF/v1'||handoff.source.commit!=='674daf87e25f5048dbd95c78631ab0784190c1ab'||handoff.P03Producer.commit!=='1208842d14e5596d4a117432314af63d6f2b1185')throw Error('Exact current ordinary product profile required');
 for(const name of ['functionResult','sourceFiles','sourceBundle','normalQAExecutionData','runner','controlledChildExecutor','actualPlan','AuthWholeH','currentResourceH','postNestedFinalizer','postNestedSignContract'])await pinned(handoff[name]);
 await pinned(handoff.P03Producer.handoff);
 const argv=handoff.execution.ordinaryColdBuild;
 if(argv.length!==3||argv[0]!=='/opt/homebrew/Cellar/node/26.7.0/bin/node'||argv[1]!==handoff.runner.path||argv[2]!=='--execute')throw Error('Original fixed ordinary execution argv required');
 return handoff;
}
export async function currentProductContinuationInput(){
 const path='/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-current-r2-product-normal-qa-successor-20261101/relink-successor/HANDOFF.json';
 const h=JSON.parse(await pinned({path,bytes:34115,sha256:'e9dcf41f23c4c785472bcacf78ecfe0e05f1253c3fd0068290f659316a8f93d4'}));
 if(h.kind!=='SDK49_CURRENT_P03_R2_COCOA_RELINK_HELPER_CONTINUATION_HANDOFF/v1'||h.source.commit!=='674daf87e25f5048dbd95c78631ab0784190c1ab')throw Error('Exact same-source continuation required');
 for(const key of ['oldH','oldExecution','manifest','runner','SOURCEFILES','FUNCTION_RESULT','plan','readback','objectClosure'])await pinned(h[key]);
 return h;
}
export async function runCurrentProductQA(path,mode){
 if(!['--plan','--execute'].includes(mode))throw Error('Use --plan or --execute');
 const handoff=await currentProductQAInput(path);
 if(mode==='--plan')return {validated:true,source:handoff.source,qaRoot:handoff.execution.qaOutputRoot,compilerExecuted:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
 const [tool,...argv]=handoff.execution.ordinaryColdBuild;
 execFileSync(tool,argv,{stdio:'inherit',env:process.env});
 return {executed:true,qaRoot:handoff.execution.qaOutputRoot,formalBuild:false,AppPackage:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
}

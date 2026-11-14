import {readFile,writeFile,lstat,realpath} from'node:fs/promises';import{execFileSync}from'node:child_process';import{join,resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';
import{currentSourceProjectionInput,readProjectionPin}from'./current-source-projection-input.mjs';import{claimBuildOutput}from'./build-output-root.mjs';
const developer=fileURLToPath(new URL('../',import.meta.url)),owner=resolve(developer,'../../..');
const old=join(owner,'qa-builds/app-current-r2-normal-20261101'),next=join(owner,'qa-builds/app-current-r2-projected-20261101');
export async function prepareCurrentProjectionCandidate(){
 const supply=await currentSourceProjectionInput(),h=supply.handoff;
 const partial=JSON.parse(await readFile(join(owner,'current-product-source-projection-intake-20261101/HANDOFF.json')));
 for(const row of partial.records)await readProjectionPin(row);
 const git=a=>execFileSync('/usr/bin/git',a,{cwd:developer,encoding:'utf8'}).trim();if(git(['status','--porcelain','--untracked-files=no']))throw Error('Committed projection producer required');
 await claimBuildOutput(next);
 const oldApp=join(old,'YNX Developer Testnet Preview.app');if(await realpath(oldApp)!==oldApp||!(await lstat(oldApp)).isDirectory())throw Error('Exact retained partial App required');
 for(const name of ['YNX Developer Testnet Preview.app','branding','native-build'])execFileSync('/bin/cp',['-cR',join(old,name),next+'/'],{env:{...process.env,COPYFILE_DISABLE:'1'},stdio:'pipe'});
 const app=join(next,'YNX Developer Testnet Preview.app');
 // The supplier entry is pinned independently by its immutable handoff. Its
 // fixed dependency and projection/archive inputs were checked above.
 const result=execFileSync(process.execPath,[h.normalResume.entry.path,'--apply-projection',app],{cwd:developer,env:process.env,encoding:'utf8',maxBuffer:4*1024*1024});
 const receipt={schema:'YNX_P03_FRESH_PROJECTION_CANDIDATE_PREPARE/v1',at:new Date().toISOString(),producerCommit:git(['rev-parse','HEAD']),sourceVariant:h.sourceVariant,oldPartialApp:oldApp,oldPartialAppModified:false,newApp:app,preparedOnly:true,fullAppScan:false,provenance:false,NativeSigned:false,DMG:false,compileRepeated:false,frontendRepeated:false,formatterRepeated:false,coreArchiveRepeated:false,projectionResult:JSON.parse(result),RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
 await writeFile(join(next,'PROJECTION_PREPARE.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length!==2)throw Error('Use fixed current projection prepare');await prepareCurrentProjectionCandidate();}

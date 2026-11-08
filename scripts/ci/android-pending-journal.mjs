// Exact existing Auth role plus six supplier CAS. This runs only its NEW nine
// PUBLIC groups and normal API24 objects, never the retained old producer main.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyJournalInputs,assertStrongJournalExport,role,fixture} from './android-pending-journal-inputs.mjs';
const kind=process.argv[2],out=process.argv[3];
if(process.env.GITHUB_ACTIONS!=='true'||!['host','android'].includes(kind)||!out||!process.env.RUNNER_TEMP||!path.resolve(out).startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep)||fs.existsSync(out))throw Error('FRESH_ISOLATED_CI_OUTPUT_REQUIRED');
fs.mkdirSync(out,{mode:0o700});const inputs=verifyJournalInputs(),steps=[];
const flags=['-std=c++17','-Wall','-Wextra','-Werror','-I'+path.join(role,'include'),'-I'+path.join(role,'root-capture/after/source')];
const source=path.join(role,'source/PendingProducer.cpp'),rootSource=path.join(role,'root-capture/after/source/RootCapture.cpp');
let passed=false,newPublicGroups=0;
function run(name,tool,args){
 const r=spawnSync(tool,args,{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,env:{...process.env,ASAN_OPTIONS:'detect_leaks=0'}});
 fs.writeFileSync(path.join(out,name+'.stdout'),r.stdout??'');fs.writeFileSync(path.join(out,name+'.stderr'),r.stderr??'');steps.push({name,tool,args,status:r.status,signal:r.signal,error:r.error?.message??null});
 if(r.status!==0||r.error){process.stderr.write(r.stderr??'');throw Error('JOURNAL_CI_STEP:'+name);}return r.stdout;
}
try{
 if(kind==='host'){
  if(process.platform!=='darwin')throw Error('MACOS_PUBLIC_DELTA_ONLY');
  run('c11-layout','/usr/bin/clang',['-std=c11','-Wall','-Wextra','-Werror','-I'+path.join(role,'include'),'-c',path.join(fixture,'layout.c'),'-o',path.join(out,'layout.o')]);
  const sodiumPrefix=run('sodium-prefix','brew',['--prefix','libsodium']).trim();
  const probe=path.join(out,'journal-probe');
  run('actual-source-new-public','/usr/bin/clang++',[...flags,'-fsanitize=address,undefined','-fno-omit-frame-pointer',source,path.join(fixture,'journal_constraints_controls.cpp'),path.join(sodiumPrefix,'lib/libsodium.dylib'),'-o',probe]);
  const result=run('new-nine-only',probe,[]);newPublicGroups=result.trim().split('\n').filter(Boolean).length;
  if(newPublicGroups!==9)throw Error('NINE_NEW_PUBLIC_GROUPS_REQUIRED');
 }else{
  if(!process.env.ANDROID_HOME)throw Error('ANDROID_HOME_REQUIRED');
  const bin=path.join(process.env.ANDROID_HOME,'ndk/27.1.12297006/toolchains/llvm/prebuilt/linux-x86_64/bin');
  for(const [name,file,exported]of [['pending',source,'ynx_auth_android_pending_source_copy_journal_constraints_v1'],['root',rootSource,'ynx_original_android_pending_root_copy_journal_constraints_v1']]){
   const object=path.join(out,name+'.o');
   run(name+'-api24-object',path.join(bin,'aarch64-linux-android24-clang++'),[...flags,'-DYNX_AUTH_ANDROID_PENDING_REGISTRATION_SOURCE_STAGE=1','-I'+path.join(role,'root-capture/after/include'),'-c',file,'-o',object]);
   assertStrongJournalExport(run(name+'-nm',path.join(bin,'llvm-nm'),['--defined-only','--extern-only',object]),exported);
  }
 }
 passed=true;
}finally{
 fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({passed,kind,newPublicGroups,steps,supplierH:inputs.supplierH,supplierCAS:{MOD:4,ADD:2},retained:31,RootRows:0,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,wholeJNI:false,actualAndroidRuntime:false,old17Rerun:false},null,2)+'\n');
}

import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyF24Inputs,role,fixture,f24Fixture} from './android-pending-f24-inputs.mjs';
import {assertStrongJournalExport} from './android-pending-journal-inputs.mjs';
const kind=process.argv[2],out=process.argv[3];
if(process.env.GITHUB_ACTIONS!=='true'||!['host','android'].includes(kind)||!out||!process.env.RUNNER_TEMP||!path.resolve(out).startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep)||fs.existsSync(out))throw Error('F24_FRESH_CI_ONLY');
fs.mkdirSync(out,{mode:0o700});const inputs=verifyF24Inputs(),steps=[];
const source=path.join(role,'source/PendingProducer.cpp'),flags=['-std=c++17','-Wall','-Wextra','-Werror','-I'+path.join(role,'include'),'-I'+path.join(role,'root-capture/after/source'),'-I'+fixture];
let passed=false,newGroups=0;
function run(name,tool,args){const r=spawnSync(tool,args,{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,env:{...process.env,ASAN_OPTIONS:'detect_leaks=0'}});fs.writeFileSync(path.join(out,name+'.stdout'),r.stdout??'');fs.writeFileSync(path.join(out,name+'.stderr'),r.stderr??'');steps.push({name,tool,args,status:r.status,signal:r.signal,error:r.error?.message??null});if(r.status!==0||r.error){process.stderr.write(r.stderr??'');throw Error('F24_STEP:'+name);}return r.stdout;}
try{
 if(kind==='host'){
  if(process.platform!=='darwin')throw Error('MACOS_F24_PUBLIC_ONLY');
  const prefix=run('sodium-prefix','brew',['--prefix','libsodium']).trim(),probe=path.join(out,'f24-probe');
  run('new-f24-public','/usr/bin/clang++',[...flags,'-fsanitize=address,undefined','-fno-omit-frame-pointer',source,path.join(f24Fixture,'journal_constraints_controls.cpp'),path.join(prefix,'lib/libsodium.dylib'),'-o',probe]);
  const result=run('f24-only',probe,['f24']);newGroups=result.trim().split('\n').filter(Boolean).length;if(newGroups!==2)throw Error('ONLY_TWO_NEW_F24_GROUPS');
 }else{
  if(!process.env.ANDROID_HOME)throw Error('ANDROID_HOME_REQUIRED');
  const bin=path.join(process.env.ANDROID_HOME,'ndk/27.1.12297006/toolchains/llvm/prebuilt/linux-x86_64/bin'),object=path.join(out,'PendingProducer.o');
  run('affected-api24-object',path.join(bin,'aarch64-linux-android24-clang++'),[...flags,'-c',source,'-o',object]);
  assertStrongJournalExport(run('strong-source-getter',path.join(bin,'llvm-nm'),['--defined-only','--extern-only',object]),'ynx_auth_android_pending_source_copy_journal_constraints_v1');
 }
 passed=true;
}finally{fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({passed,kind,newGroups,newCases:kind==='host'?4:0,steps,supplierH:inputs.successor.supplierH,productionMOD:1,RootRows:0,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,old9And17Rerun:false,wholeJNI:false,actualAndroidRuntime:false},null,2)+'\n');}

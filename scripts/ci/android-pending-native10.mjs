import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyNative10Inputs,verifySymbols,verifyMainImports,native,test,role,fixture} from './android-pending-native10-inputs.mjs';
const kind=process.argv[2],out=process.argv[3],normalOnly=process.argv[4]==='--normal-only';
if(process.argv.length>4&&!normalOnly)throw Error('UNKNOWN_MODE');
if(process.env.GITHUB_ACTIONS!=='true'||!['host','android'].includes(kind)||!out||!process.env.RUNNER_TEMP||!path.resolve(out).startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep)||fs.existsSync(out))throw Error('NATIVE10_FRESH_CI_ONLY');
fs.mkdirSync(out,{mode:0o700});const inputs=verifyNative10Inputs(),steps=[];let passed=false,cases=0;
function run(name,tool,args){const r=spawnSync(tool,args,{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,cwd:out,env:{...process.env,TMPDIR:out,ASAN_OPTIONS:'detect_leaks=0:quarantine_size_mb=32'}});fs.writeFileSync(path.join(out,name+'.stdout'),r.stdout??'');fs.writeFileSync(path.join(out,name+'.stderr'),r.stderr??'');steps.push({name,tool,args,status:r.status,signal:r.signal,error:r.error?.message??null});if(r.status!==0||r.error){process.stderr.write(r.stderr??'');throw Error('NATIVE10_STEP:'+name);}return r.stdout;}
try{
 const bin=kind==='android'?path.join(process.env.ANDROID_HOME,'ndk/27.1.12297006/toolchains/llvm/prebuilt/linux-x86_64/bin'):null;
 if(kind==='host'&&process.platform!=='darwin')throw Error('MACOS_ONLY');
 const cc=bin?path.join(bin,'aarch64-linux-android24-clang++'):'/usr/bin/clang++',nm=bin?path.join(bin,'llvm-nm'):'/usr/bin/nm';
 const flags=['-std=c++17','-Wall','-Wextra','-Werror','-fPIC','-I'+path.join(role,'include'),'-I'+fixture,...(kind==='host'?['-mmacosx-version-min=13.0']:[])],objects=[];
 for(const leaf of ['PendingReviewOwner','PendingDirectory','PendingDevicePair','PendingAbort']){const object=path.join(out,leaf+'.o');run('normal-'+leaf,cc,[...flags,'-c',path.join(native,leaf+'.cpp'),'-o',object]);objects.push(object);}
 const symbols=run('normal-strong10',nm,['-g',...objects]);verifySymbols(symbols);
 verifyMainImports(symbols,[...['capture','borrow','current','close'].map(x=>'ynx_main_android_pending_appdir_hold_'+x+'_v1'),...['capture','current','borrow_once','retire','close'].map(x=>'ynx_main_android_pending_pair_hold_'+x+'_v1'),'ynx_main_android_pending_original_abort_current_v1']);
 if(kind==='host'&&!normalOnly)for(const [family,macro,tus]of [['directory','YNX_ANDROID_PENDING_DIRECTORY_PUBLIC_CONTROLS',['PendingDirectory','PendingReviewOwner']],['pair-abort','YNX_ANDROID_PENDING_PAIR_ABORT_PUBLIC_CONTROLS',['PendingDevicePair','PendingAbort','PendingReviewOwner']]]){
  const binary=path.join(out,'PUBLIC-'+family);run('public-link-'+family,cc,[...flags,'-fsanitize=address,undefined','-fno-omit-frame-pointer','-D'+macro,...tus.map(x=>path.join(native,x+'.cpp')),path.join(test,'android-pending-'+family+'.PUBLIC.cpp'),'-o',binary]);
  for(const c of inputs.cases[family]){const args=[c];let dir;if(family==='directory'){dir=path.join(out,'fixture-'+c);fs.mkdirSync(dir,{mode:0o700});fs.mkdirSync(path.join(dir,'ynx-product-device-v4'),{mode:0o700});args.push(dir);}run('case-'+family+'-'+c,binary,args);cases++;if(dir)fs.rmSync(dir,{recursive:true});}
 }
 passed=true;
}finally{fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({passed,kind,cases,normalOnly,steps,nativeSource:inputs.nativeSource,normalStrongPorts:10,requiredMainImports:10,currentAuthF24Base:inputs.base,RootRows:0,RootAdmission:false,SourceAdmission:false,actualMainRustLinked:false,CoreCalled:false,realProtectedDER:false,wholeImage:false,installed:false},null,2)+'\n');}

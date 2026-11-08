// CI-only portable driver. Original Native source, PUBLIC fixture and parser are
// pinned; no JNI image, reviewed Root row, signing or product activation is made.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifyInputs,assertStrongNine,root,fixture,native} from './android-code-image-root-inputs.mjs';
const kind=process.argv[2],out=process.argv[3];
if(process.env.GITHUB_ACTIONS!=='true'||!['host','android'].includes(kind)||!out||!path.isAbsolute(out))throw Error('ISOLATED_CI_ONLY');
if(!process.env.RUNNER_TEMP||!path.resolve(out).startsWith(path.resolve(process.env.RUNNER_TEMP)+path.sep))throw Error('RUNNER_TEMP_REQUIRED');
if(fs.existsSync(out))throw Error('FRESH_OUTPUT_REQUIRED');
fs.mkdirSync(out,{mode:0o700});
const inputs=verifyInputs(),jobs=[],header=fs.readFileSync(path.join(native,'AndroidCodeImageRootPrivate.h'),'utf8');
const body=path.join(native,'AndroidCodeImageRoot.cpp'),parser=path.join(fixture,'MobileCanonicalDATA.cpp');
const publicFixture=path.join(root,'apps/wallet/modules/ynx-pq-custody/test/android-code-image-root.PUBLIC.cpp');
const common=['-std=c++17','-Wall','-Wextra','-Werror','-I'+fixture];
let registration=null,passed=false,publicCases=0;
function run(name,tool,args){
 const start=Date.now(),result=spawnSync(tool,args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,env:{...process.env,ASAN_OPTIONS:'detect_leaks=0'}});
 fs.writeFileSync(path.join(out,name+'.stdout'),result.stdout??'');fs.writeFileSync(path.join(out,name+'.stderr'),result.stderr??'');
 jobs.push({name,tool,args,status:result.status,signal:result.signal,error:result.error?.message??null,elapsedMs:Date.now()-start});
 if(result.status!==0||result.error)throw Error('CI_COMMAND_FAILED:'+name);
 return result.stdout;
}
try{
 if(kind==='android'){
  const sdk=process.env.ANDROID_HOME;if(!sdk)throw Error('ANDROID_HOME_REQUIRED');
  const bin=path.join(sdk,'ndk/27.1.12297006/toolchains/llvm/prebuilt/linux-x86_64/bin');
  const object=path.join(out,'android-arm64-api24.o');
  run('android-object',path.join(bin,'aarch64-linux-android24-clang++'),[...common,'-fPIC','-c',body,'-o',object]);
  assertStrongNine(run('android-nm',path.join(bin,'llvm-nm'),['--defined-only','--extern-only',object]),header);
 }else{
  if(process.platform!=='darwin')throw Error('MACOS_PUBLIC_HOST_REQUIRED');
  const object=path.join(out,'normal.o');
  run('normal-object','/usr/bin/clang++',[...common,'-mmacosx-version-min=13.0','-c',body,'-o',object]);
  assertStrongNine(run('normal-nm','/usr/bin/nm',['-g',object]),header,true);
  const sodiumPrefix=run('sodium-prefix','brew',['--prefix','libsodium']).trim();
  const sodium=fs.realpathSync(path.join(sodiumPrefix,'lib/libsodium.dylib'));
  const sodiumBytes=fs.readFileSync(sodium);fs.writeFileSync(path.join(out,'HOST_PUBLIC_PRIMITIVE.json'),JSON.stringify({path:sodium,bytes:sodiumBytes.length,sha256:createHash('sha256').update(sodiumBytes).digest('hex'),productionPrimitiveQualification:false}));
  // Original reviewed locator checks HOME ancestry. Only the tiny PUBLIC JSON
  // registration is under HOME; all executable bytes and logs stay RUNNER_TEMP.
  registration=fs.mkdtempSync(path.join(os.homedir(),'.ynx-code-profile-PUBLIC-'));fs.chmodSync(registration,0o700);
  const runtime=path.join(out,'runtime');fs.mkdirSync(runtime,{mode:0o700});
  const image=path.join(runtime,'image.dylib'),defaultImage=path.join(runtime,'default.dylib'),record=path.join(runtime,'build-record.json'),profile=path.join(registration,'selected-profile.json'),driver=path.join(out,'android-code-image-root.PUBLIC');
  const sanitize=['-fsanitize=address,undefined','-fno-omit-frame-pointer'];
  const reviewed='-DYNX_REVIEWED_ANDROID_CODE_IMAGE_LOCATORS={"'+registration+'","selected-profile.json","android-code-image-root.PUBLIC"}';
  const flags=[...common,...sanitize,'-mmacosx-version-min=13.0','-DYNX_ANDROID_CODE_IMAGE_PUBLIC_CONTROLS'];
  const lib=[...flags,'-DYNX_CODE_IMAGE_TEST_LIBRARY','-dynamiclib','-Wl,-undefined,error'];
  run('public-image','/usr/bin/clang++',[...lib,reviewed,body,parser,publicFixture,sodium,'-o',image]);
  run('default-image','/usr/bin/clang++',[...lib,body,parser,publicFixture,sodium,'-o',defaultImage]);
  run('public-driver','/usr/bin/clang++',[...flags,publicFixture,'-o',driver]);
  const original=fs.readFileSync(image),defaultOriginal=fs.readFileSync(defaultImage);
  const sha=b=>createHash('sha256').update(b).digest('hex');
  const canonical=v=>JSON.stringify(v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
  function facts(p){const b=fs.readFileSync(p),s=fs.statSync(p);return{path:p,bytes:b.length,sha256:sha(b),uid:s.uid,gid:s.gid,mode:s.mode&0o7777};}
  function prepare(mutate){
   fs.chmodSync(runtime,0o700);fs.chmodSync(registration,0o700);
   for(const p of [image,record,profile,profile+'.old'])if(fs.existsSync(p))fs.unlinkSync(p);
   fs.writeFileSync(image,original,{mode:0o700});fs.writeFileSync(record,'PUBLIC postbuild provenance only\n',{mode:0o600});
   const p={version:1,kind:'YNX_ANDROID_AUTH_JNI_CODE_IMAGE_PROFILE/v1',service:'YNX_AUTH_ANDROID_DEVICE_V4',processName:'android-code-image-root.PUBLIC',applicationUID:process.getuid(),applicationGID:process.getgid(),image:facts(image),buildRecord:facts(record),sourceCommit:'1'.repeat(40),sourceTree:'2'.repeat(40)};
   mutate?.(p);fs.writeFileSync(profile,canonical(p),{mode:0o600});
  }
  fs.writeFileSync(path.join(out,'POSTLINK_IMAGE_PIN.json'),JSON.stringify({bytes:original.length,sha256:sha(original),externalRecordCreatedAfterLink:true,actualRoot:false}));
  for(const mode of ['positive','actor','foreign-token','capacity','retire','malformed-read','directory-change','profile-change','profile-replace','record-change','image-change','unknown-close','image-unknown-all-fds','reentrant-close','lookup-race']){prepare();run('case-'+mode,driver,[mode,image,profile,record]);publicCases++;}
  const negative=[['wrong-sha',p=>p.image.sha256='0'.repeat(64)],['wrong-size',p=>++p.image.bytes],['wrong-uid',p=>++p.applicationUID],['wrong-service',p=>p.service='FOREIGN'],['wrong-process',p=>p.processName='FOREIGN'],['unknown-field',p=>p.extra=0],['nonlower-source',p=>p.sourceTree='A'.repeat(40)],['alias-record',p=>p.buildRecord={...p.image}],['wrong-mode',p=>p.image.mode=0o600]];
  for(const [name,mutate]of negative){prepare(mutate);run('refusal-'+name,driver,['refusal',image,profile,record]);publicCases++;}
  prepare();fs.chmodSync(profile,0o620);run('root-writable',driver,['refusal',image,profile,record]);publicCases++;
  prepare();const hard=path.join(runtime,'hardlink');fs.linkSync(image,hard);run('image-hardlink',driver,['refusal',image,profile,record]);fs.unlinkSync(hard);publicCases++;
  prepare(p=>{const alias=path.join(runtime,'image-alias');fs.symlinkSync(image,alias);p.image.path=alias;});run('image-symlink',driver,['refusal',image,profile,record]);publicCases++;
  fs.writeFileSync(defaultImage,defaultOriginal,{mode:0o700});run('default-rows-empty',driver,['default-empty',defaultImage,profile,record]);publicCases++;
  if(publicCases!==28)throw Error('PUBLIC_CASES_REQUIRED_28');
 }
 passed=true;
}finally{
 fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({passed,kind,nativeSource:inputs.nativeSource,jobs,publicCases,RootRows:0,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,actualJNIOrAPK:false,oldSuitesRerun:false},null,2));
 if(registration)fs.rmSync(registration,{recursive:true,force:true});
}

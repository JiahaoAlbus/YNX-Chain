import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{'output-dir':{type:'string'}}});
if(!values['output-dir'])throw Error('Use --output-dir <fresh evidence directory>');
const out=resolve(values['output-dir']);if(existsSync(out))throw Error('FRESH_DIRECTORY_REQUIRED');mkdirSync(out,{recursive:true});
const include=join(app,'contracts/mobile-protected-review'),sdk=join(app,'contracts/sdk-mobile-application-v6');
for(const r of JSON.parse(readFileSync(join(include,'PROVENANCE.json'),'utf8')).files){const b=readFileSync(join(include,r.file));if(b.length!==r.bytes||createHash('sha256').update(b).digest('hex')!==r.sha256)throw Error('PRIVATE_INTERFACE_DRIFT');}
const steps=[];
function run(name,exe,args){const r=spawnSync(exe,args,{cwd:app,encoding:'utf8',env:{...process.env,ASAN_OPTIONS:'halt_on_error=1',UBSAN_OPTIONS:'halt_on_error=1'},maxBuffer:8<<20});writeFileSync(join(out,name+'.stdout'),r.stdout||'');writeFileSync(join(out,name+'.stderr'),r.stderr||'');steps.push({name,command:[exe,...args],exitCode:r.status,signal:r.signal});if(r.error)throw r.error;if(r.status!==0)throw Error(name+' failed; original output retained');return r.stdout.trim();}
const common=['clang++','-std=c++20','-fobjc-arc','-Wall','-Wextra','-Werror','-I',include,'-I',sdk];
try{
 for(const [platform,target] of [['iphoneos','arm64-apple-ios16.4'],['iphonesimulator','arm64-apple-ios16.4-simulator']]){
  const root=run(platform+'-sysroot','xcrun',['--sdk',platform,'--show-sdk-path']);
  run(platform+'-actual-UIKit','xcrun',['--sdk',platform,...common,'-target',target,'-isysroot',root,'-c','native/protected-review/OriginalProtectedReview.ios.mm','-o',join(out,platform+'.o')]);
 }
 const binary=join(out,'PUBLIC-owning-UI7');
 run('PUBLIC-ASAN-UBSAN-compile','xcrun',[...common,'-fsanitize=address,undefined','-fno-omit-frame-pointer','native/protected-review/OriginalProtectedReview.PUBLIC.mm','-framework','Foundation','-o',binary]);
 run('PUBLIC-ASAN-UBSAN-controls',binary,[]);
}finally{writeFileSync(join(out,'RESULT.json'),JSON.stringify({steps,scope:'actual UIKit device/simulator objects; PUBLIC Source/account/App/UI boundary state controls only',actualUIKitRun:false,realNativeAccount:false,actualApproval:false,RootAdmission:false,SourceAdmission:false,realSigning:false,installed:false},null,2)+'\n');}

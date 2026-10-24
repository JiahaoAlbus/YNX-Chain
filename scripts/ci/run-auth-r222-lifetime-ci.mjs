// CI-only PUBLIC Foundation/ownership fixture. Never an addon build or Root.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||!path.isAbsolute(process.env.RUNNER_TEMP??''))throw Error('R222_MACOS_CI_ONLY');
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(process.env.RUNNER_TEMP,'auth-r222-native-lifetime');
fs.mkdirSync(out,{mode:0o700});const native=path.join(root,'packages/wallet-auth/native'),binary=path.join(out,'PUBLIC-lifetime'),exitBinary=path.join(out,'PUBLIC-task-exit');
const rows=[];let firstCause=null;
for(const [name,tool,argv,expectedExit=0]of [['compile','/usr/bin/clang++',['-fobjc-arc','-fno-modules','-std=c++17','-framework','Foundation','-I',native,path.join(native,'test-pq-catalog-source-lifetime.mm'),'-o',binary]],['actual-lifetime',binary,[]],['compile-task-exit','/usr/bin/clang++',['-fobjc-arc','-fno-modules','-std=c++17','-framework','Foundation','-I',native,path.join(native,'test-pq-catalog-task-exit.mm'),'-o',exitBinary]],['old-unbounded-control',exitBinary,['--PUBLIC-old-unbounded'],65],['actual-bounded-exit',exitBinary,[]]]){
 const began=Date.now(),r=spawnSync(tool,argv,{cwd:out,env:{...process.env,TMPDIR:process.env.RUNNER_TEMP,CLANG_MODULE_CACHE_PATH:path.join(out,'module-cache')},encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:4<<20});
 for(const kind of ['stdout','stderr'])fs.writeFileSync(path.join(out,name+'.'+kind),r[kind]??'',{flag:'wx',mode:0o600});
 const row={name,tool,argv,exit:r.status,expectedExit,signal:r.signal,error:r.error?.code??null,elapsedMS:Date.now()-began};rows.push(row);
 if(r.status!==expectedExit||r.signal||r.error){firstCause??=r.error?.code??'R222_'+name+'_FAILED';break;}
 if(name==='old-unbounded-control'&&!/^RED original waitUntilExit blocked [0-9]+ms beyond 40ms observation budget\n$/.test(r.stdout)){firstCause='R224_OLD_CONTROL_RECEIPT_DIFFERS';break;}
 if(name==='actual-bounded-exit'&&r.stdout!=='PASS actual ignored-TERM bounded observation, original custody retained until exit\n'){firstCause='R224_BOUNDED_RECEIPT_DIFFERS';break;}
 if(name==='actual-lifetime'&&r.stdout!=='PASS actual lifetime first-close/UNKNOWN and Foundation bounded IO\n'){firstCause='R222_ACTUAL_FIXTURE_RECEIPT_DIFFERS';break;}
}
fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({success:firstCause===null,firstCause,rows,publicOnly:true,actualFoundationIO:rows.some(r=>r.name==='actual-lifetime'&&r.exit===0&&r.signal===null&&r.error===null),fixtureOnly:true,addonLinked:false,Root:false,registered:false,nativeAdmission:false,realUserFlow:false,actualBoundedExitHelperVerified:firstCause===null,fullProductionAddonRuntimeVerified:false,noAutomaticRetry:true},null,2)+'\n',{flag:'wx',mode:0o600});
if(firstCause)throw Error(firstCause);console.log(out);

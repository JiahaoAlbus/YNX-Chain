import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const native=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-commerce-order-actions-'));
const mode=process.argv[2];
if(!['--android','--apple'].includes(mode))throw new Error('Choose --android or --apple');
console.log('Preserved isolated verification stage: '+stage);
function run(name,command,args,options={}){
 const result=spawnSync(command,args,{encoding:'utf8',...options});
 fs.writeFileSync(path.join(stage,name+'.log'),(result.stdout??'')+(result.stderr??''));
 if(result.error||result.status!==0)throw new Error(name+' failed ('+result.status+'); inspect '+stage+'/'+name+'.log');
 console.log('PASS '+name);
}
run('native-contract-locales',process.execPath,[path.join(native,'scripts/verify.mjs')]);
if(mode==='--android'){
 if(!process.env.JAVA_HOME||!process.env.ANDROID_HOME)throw new Error('Use existing Java 17 JAVA_HOME and Android 36 ANDROID_HOME; this script installs nothing');
 const project=path.join(stage,'android');fs.cpSync(path.join(native,'android'),project,{recursive:true,filter:p=>!['.gradle','build'].includes(path.basename(p))});
 run('android-build-and-order-checks',path.join(project,'gradlew'),['-p',project,'--offline','--no-daemon',':app:assembleDebug',':app:testDebugUnitTest','--tests','com.ynxweb4.shop.BuyerOrderActionInputTest','--tests','com.ynxweb4.shop.OfflineMutationQueueTest','--tests','com.ynxweb4.shop.PrivacyLifecycleTest','--tests','com.ynxweb4.shop.BuyerJourneyTest','--tests','com.ynxweb4.shop.BuyerTransitionRecoveryTest','--tests','com.ynxweb4.shop.OfflineDraftRetryTest']);
}else{
 const developer=process.env.DEVELOPER_DIR;
 if(!developer||!fs.existsSync(path.join(developer,'usr/bin/xcodebuild')))throw new Error('Set process-local DEVELOPER_DIR to the installed, user-initialized Xcode Developer directory');
 const env={...process.env,DEVELOPER_DIR:developer};
 run('xcode-first-launch',path.join(developer,'usr/bin/xcodebuild'),['-checkFirstLaunchStatus'],{env});
 const ios=path.join(stage,'ios');fs.cpSync(path.join(native,'ios'),ios,{recursive:true,filter:p=>!['build','DerivedData','xcuserdata'].includes(path.basename(p))});
 const source=path.join(ios,'YNXShop'),swift=fs.readdirSync(source).filter(p=>p.endsWith('.swift')).map(p=>path.join(source,p));
 run('apple-source-parse','/usr/bin/xcrun',['swiftc','-frontend','-parse',...swift],{env});
 const core=swift.filter(p=>!['ContentView.swift','YNXShopApp.swift'].includes(path.basename(p)));
 const binary=path.join(stage,'buyer-action-checks');run('apple-model-checks-build','/usr/bin/xcrun',['swiftc',...core,path.join(ios,'tests/BuyerJourneyChecks.swift'),'-o',binary],{env});run('apple-model-checks',binary,[],{env});
 for(const [scheme,destination]of [['YNXShopMac','generic/platform=macOS'],['YNXShop','generic/platform=iOS Simulator']])run(scheme+'-debug-build',path.join(developer,'usr/bin/xcodebuild'),['-project',path.join(ios,'YNXShop.xcodeproj'),'-scheme',scheme,'-configuration','Debug','-destination',destination,'-derivedDataPath',path.join(stage,'derived-'+scheme),'CODE_SIGNING_ALLOWED=NO','build'],{env});
}
console.log('Source verification only; installed app, real Wallet approval, public operation, signing and TestFlight are separate gates.');

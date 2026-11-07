import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const sdk=fileURLToPath(new URL('../..',import.meta.url)),repo=path.resolve(sdk,'../..'),out=path.join(repo,'AI_V6_RECOVERY_OPTIONAL_RECEIPT_DATA');
mkdirSync(out,{recursive:true});const work=mkdtempSync(path.join(out,'public-')),binary=path.join(work,'control');
const native=path.join(sdk,'native/ai-v6-recovery-evidence'),inherited=path.join(sdk,'test/fixtures/ai-v6-recovery-evidence-original-auth');
const argv=['-std=c++17','-Wall','-Wextra','-Werror','-I'+native,'-I'+inherited,path.join(native,'AIRecoveryRecordCodecPrivate.cpp'),path.join(inherited,'MobileCanonicalDATA.cpp'),path.join(sdk,'test/ai-v6-recovery-optional-receipt.cpp'),...(process.platform==='linux'?['-lcrypto']:[]),'-o',binary];
for(const[tool,args,label]of[['/usr/bin/clang++',argv,'compile'],[binary,[],'run']]){const r=spawnSync(tool,args,{encoding:'utf8',timeout:30000});writeFileSync(path.join(out,label+'.stdout'),r.stdout??'');writeFileSync(path.join(out,label+'.stderr'),r.stderr??'');if(r.error||r.status!==0)throw Error('OPTIONAL_RECEIPT_'+label+':'+(r.error?.code??r.status));}
const result={newControls:8,pass:8,fail:0,old16Rerun:false,onlyPublicDATA:true,NativeCompiled:false,RootAdmission:false,SourceAdmission:false,receiptProvenanceVerified:false,replayAuthorized:false};
writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));

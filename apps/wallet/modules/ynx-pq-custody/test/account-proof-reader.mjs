import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const large='/Volumes/西部数据/YNX-large-work';
const q=large+'/auth-owned-r258/mobile-registered-custody-source-successor/qualified-original-successor';
const cohort=JSON.parse(fs.readFileSync(here+'/../native/account-proof/PRIVATE_HEADER_PINS.json'));
const includes=[process.env.YNX_AUTH_ACCOUNT_PROOF_HOST_HEADERS||q+'/account-host-source-binding-successor/final-stable-host-pFN1aa/source',
 process.env.YNX_AUTH_ACCOUNT_PROOF_HEADERS||q+'/registered-receipt-successor/final-r1/source',
 process.env.YNX_P09_ACCOUNT_PROOF_HEADERS||cohort.defaultP09SourceRoot,
 process.env.YNX_SDK_ACCOUNT_PROOF_HEADERS||large+'/wallet-auth-owned-ci-20261026/sdk49-mobile-genuine-ledger-receipt-contract-20261107/core-paired-host-contract-successor/source'];
const pin=p=>{const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}};
for(const x of cohort.headers){const actual=pin(path.join(includes[x.root],x.name));if(actual.bytes!==x.bytes||actual.sha256!==x.sha256)throw Error('Matching private header drift: '+x.name);}
const evidence=fs.mkdtempSync((process.env.YNX_ACCOUNT_PROOF_EVIDENCE_ROOT||large+'/wallet-pq-native-v01-20261025/evidence')+'/native-account-proof-reader-');
const rows=[];
function run(name,exe,args){const r=spawnSync(exe,args,{encoding:'utf8',timeout:60000,env:{...process.env,ASAN_OPTIONS:'detect_leaks=0'},maxBuffer:2<<20});
 const stdout=evidence+'/'+name+'.stdout',stderr=evidence+'/'+name+'.stderr';fs.writeFileSync(stdout,r.stdout??'');fs.writeFileSync(stderr,r.stderr??'');
 rows.push({name,exe,args,status:r.status,signal:r.signal,error:r.error?.message,stdout,stderr});fs.writeFileSync(evidence+'/RUNS.json',JSON.stringify(rows,null,2)+'\n');
 if(r.status!==0)throw Error(name+' FAILED: '+(r.stderr??r.error));}
const inputs=[here+'/../native/account-proof/NativeAccountProofReader.cpp',here+'/account-proof-reader.PUBLIC.cpp'];
const binary=evidence+'/reader-public';
run('compile','clang++',['-std=c++17','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-fno-omit-frame-pointer',...includes.flatMap(x=>['-I',x]),...inputs,'-o',binary]);
const cases=['ready','not-ready','late-zero','closed-zero','changed-h','wrong-sequence','unknown-open','unknown-close','wrong-thread','invalid-host','wrong-source','intrinsic-reader','concurrent-release'];
for(const name of cases)run(name,binary,[name]);
fs.writeFileSync(evidence+'/RESULT.json',JSON.stringify({passed:true,groups:cases.length,actualNativeReaderTU:true,protectedChildBoundary:'PUBLIC_ONLY',ASAN_UBSAN:true,LSan:false,SourceAdmission:false,RootAdmission:false,actualCoreProof:false,actualP09Socket:false,installed:false,inputs:inputs.map(pin),runs:pin(evidence+'/RUNS.json')},null,2)+'\n');
console.log(JSON.stringify({evidence,passed:true,groups:cases.length}));

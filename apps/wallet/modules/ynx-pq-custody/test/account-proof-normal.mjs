// Targeted macOS process/socket composition; no real Source/Root or proof.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
if(process.platform!=='darwin')throw Error('Original normal process integration requires the matching macOS cohort');
const here=path.dirname(fileURLToPath(import.meta.url)),module=path.resolve(here,'..');
const large='/Volumes/西部数据/YNX-large-work',q=large+'/auth-owned-r258/mobile-registered-custody-source-successor/qualified-original-successor';
const network=process.env.YNX_NETWORK_SOURCE_ROOT||'/Users/huangjiahao/.codex/worktrees/v5-p09-network-core09/YNX Chain';
const cohort=JSON.parse(fs.readFileSync(module+'/native/account-proof/PRIVATE_HEADER_PINS.json'));
const roots=[process.env.YNX_AUTH_ACCOUNT_PROOF_HOST_HEADERS||q+'/account-host-source-binding-successor/final-stable-host-pFN1aa/source',
process.env.YNX_AUTH_ACCOUNT_PROOF_HEADERS||q+'/registered-receipt-successor/final-r1/source',process.env.YNX_P09_ACCOUNT_PROOF_HEADERS||cohort.defaultP09SourceRoot,
process.env.YNX_SDK_ACCOUNT_PROOF_HEADERS||large+'/wallet-auth-owned-ci-20261026/sdk49-mobile-genuine-ledger-receipt-contract-20261107/core-paired-host-contract-successor/source'];
const pin=p=>{const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}};
for(const x of cohort.headers){const p=pin(roots[x.root]+'/'+x.name);if(p.bytes!==x.bytes||p.sha256!==x.sha256)throw Error('Matching private header drift: '+x.name);}
const d=fs.mkdtempSync((process.env.YNX_ACCOUNT_PROOF_EVIDENCE_ROOT||large+'/wallet-pq-native-v01-20261025/evidence')+'/native-account-normal-');
const files=[module+'/native/account-proof/NativeAccountPurposeChild.cpp',module+'/native/account-proof/NativeAccountProofReader.cpp',here+'/account-proof-normal.PUBLIC.cpp',roots[0]+'/MobileAccountProofHostBinding.cpp',...['current4_launch_private.cpp','account_proof_channel_private.cpp','account_source_acquisition_private.cpp','normal_native_backend_private.cpp'].map(n=>roots[2]+'/'+n)];
const before=files.map(pin),runs=[];
function run(name,exe,args,cwd,env={}){
 const r=spawnSync(exe,args,{cwd,env:{...process.env,...env},encoding:'utf8',timeout:120000,maxBuffer:4<<20});
 fs.writeFileSync(d+'/'+name+'.stdout',r.stdout??'');fs.writeFileSync(d+'/'+name+'.stderr',r.stderr??'');
 runs.push({name,exe,args,cwd,environment:env,status:r.status,signal:r.signal,error:r.error?.message});fs.writeFileSync(d+'/RUNS.json',JSON.stringify(runs,null,2)+'\n');
 if(r.status!==0)throw Error(name+' failed; preserved '+d);return r.stdout;
}
const binary=d+'/normal-public';
run('compile','clang++',['-std=c++17','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-fsanitize=address,undefined','-fno-omit-frame-pointer','-pthread','-DYNX_NETWORK_QUALIFIED_NORMAL_NATIVE_HOST',...roots.flatMap(p=>['-I',p]),...files,'-lproc','-o',binary],module);
const go=process.env.YNX_GO_126||'/Users/huangjiahao/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.10.darwin-arm64/bin/go';
const overlay=d+'/OVERLAY.json';
fs.writeFileSync(overlay,JSON.stringify({Replace:{[network+'/apps/network/internal/current4transport/native_account_purpose_owning_test.go']:here+'/account-proof-normal-interop.PUBLIC.go'}},null,2)+'\n');
const stdout=run('interop',go,['test','-overlay',overlay,'-mod=readonly','-p','1','-race','-count=1','-json','./apps/network/internal/current4transport','-run','^TestNativeAccountPurposeOwningInterop$'],network,{GOTOOLCHAIN:'local',GOMAXPROCS:'2',GOPROXY:'off',GOSUMDB:'off',YNX_NORMAL_NATIVE_FIXTURE:binary,YNX_NORMAL_NATIVE_PIN:pin(binary).sha256});
if(!stdout.includes('ACTUAL_NORMAL_PROFILE_RETIRE_BEFORE_CAPTURE_NOT_ROOT')||!stdout.includes('ACTUAL_NATIVE_HOST_REJECTS_FOREIGN_READER_AND_DRAINS_ORIGINAL_SOURCE_NOT_ROOT')||!stdout.includes('ACTUAL_NATIVE_PURPOSE8_AUTH_HOST_P09_NORMAL_PARTIAL0_DRAIN_NOT_ROOT')||stdout.includes('"Action":"skip"'))throw Error('Missing actual new composition evidence: '+d);
if(before.some(p=>pin(p.path).sha256!==p.sha256))throw Error('Composition inputs changed during execution: '+d);
fs.writeFileSync(d+'/RESULT.json',JSON.stringify({passed:true,newModes:4,actualNativePurpose8:true,actualNativeReader8Linked:true,actualAuthHostBody:true,actualP09ProcessAndSocket:true,SourceBoundary:'PUBLIC',profileBoundary:'PUBLIC',RootAdmission:false,actualCoreProof:false,installed:false,inputs:before,overlay:pin(overlay),driver:pin(here+'/account-proof-normal-interop.PUBLIC.go'),runs:pin(d+'/RUNS.json')},null,2)+'\n');
console.log(JSON.stringify({evidence:d,passed:true,newModes:4}));

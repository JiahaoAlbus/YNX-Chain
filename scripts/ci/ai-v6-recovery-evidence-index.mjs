import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const layout=process.argv.length===3&&process.argv[2]==='--check-layout';
if(process.argv.length!==2&&!layout)throw new Error('RECOVERY_INDEX_CI_ARGUMENTS');
const pins={"packages/wallet-auth/native/ai-v6-recovery-evidence/AIRecoveryRecordCodecPrivate.cpp": "f0dd1f49db74aa0c34e41890bf6eaf0556aa710192466a5e2c191e035695afe4", "packages/wallet-auth/native/ai-v6-recovery-evidence/AIRecoveryRecordCodecPrivate.hpp": "eddee840d0c1531c1971d103c52d34f76c3a9e56c22a1bed96b005177ed8e337", "packages/wallet-auth/test/fixtures/ai-v6-recovery-evidence-original-auth/MobileCanonicalDATA.hpp": "6658eafc777a860d1ce20f8a97617d82e816dab6b88b8b15c043a0f16d8d26a7", "packages/wallet-auth/test/fixtures/ai-v6-recovery-evidence-original-auth/MobileCanonicalDATA.cpp": "82c56181bcf16b1c00e4193f358fa428875c0eea9fe4a2917cc165e199e6df1e"};
for(const[rel,sha]of Object.entries(pins)){const f=path.join(root,rel);if(!lstatSync(f).isFile()||createHash('sha256').update(readFileSync(f)).digest('hex')!==sha)throw new Error('RECOVERY_INDEX_SOURCE_OR_ORIGINAL_AUTH_FIXTURE_DIFFERS');}
const temporary=mkdtempSync(path.join(tmpdir(),'ynx-recovery-evidence-public-data-'));
try{
 const compiler=process.platform==='darwin'?'/usr/bin/clang++':'clang++';
 const native=path.join(root,'packages/wallet-auth/native/ai-v6-recovery-evidence');
 const fixture=path.join(root,'packages/wallet-auth/test/fixtures/ai-v6-recovery-evidence-original-auth');
 const files=[path.join(root,'packages/wallet-auth/test/ai-v6-recovery-evidence-index.cpp'),path.join(native,'AIRecoveryRecordCodecPrivate.cpp'),path.join(fixture,'MobileCanonicalDATA.cpp')];
 const output=path.join(temporary,'recovery-index-data');
 const args=['-std=c++17','-Wall','-Wextra','-Werror','-I'+native,'-I'+fixture,...(layout?['-fsyntax-only']:[]),...files,...(layout?[]:[...(process.platform==='linux'?['-lcrypto']:[]),'-o',output])];
 const c=spawnSync(compiler,args,{stdio:'inherit'});if(c.status!==0)throw new Error('RECOVERY_INDEX_DATA_COMPILE_FAILED '+String(c.status));
 if(!layout){const r=spawnSync(output,[],{stdio:'inherit'});if(r.status!==0)throw new Error('RECOVERY_INDEX_DATA_CONTROLS_FAILED '+String(r.status));}
 console.log(JSON.stringify({layoutOnly:layout,controlsExecuted:layout?0:16,hostSHAAdapter:process.platform==='darwin'?'PUBLIC CommonCrypto':'PUBLIC OpenSSL',RootAdmission:false,SourceAdmission:false,NativeAdmission:false,mobileOSLinked:false}));
}finally{rmSync(temporary,{recursive:true,force:true});}

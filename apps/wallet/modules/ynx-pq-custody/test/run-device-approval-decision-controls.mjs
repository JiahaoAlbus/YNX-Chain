import {mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const javaHome=process.env.JAVA_HOME || (process.platform==='darwin'
  ? execFileSync('/usr/libexec/java_home',[],{encoding:'utf8'}).trim() : '');
if(!javaHome || !['darwin','linux'].includes(process.platform))throw Error('A matching JAVA_HOME and supported JNI platform are required');
const out=mkdtempSync(join(tmpdir(),'ynx-device-decision-public-'));
try {
  execFileSync('clang++',['-std=c++17','-Wall','-Wextra','-Werror',
    '-fsanitize=address,undefined','-fno-omit-frame-pointer','-pthread',
    '-I',join(javaHome,'include'),'-I',join(javaHome,'include',process.platform),
    '-I',join(root,'android/src/main/cpp'),
    join(root,'test/device-approval-decision-bridge.PUBLIC.cpp'),'-o',join(out,'controls')],{stdio:'inherit'});
  execFileSync(join(out,'controls'),[],{stdio:'inherit',
    env:{...process.env,ASAN_OPTIONS:`detect_leaks=${process.platform==='darwin'?0:1}`}});
} finally { rmSync(out,{recursive:true,force:true}); }

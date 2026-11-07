// Parent CI can invoke this closed module without changing Hermes dependencies.
// No install/network/build or external key material. Supply the actual normal
// React Native dependency root, never a test stub header collection.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const rn=process.argv[2];
if(!rn||JSON.parse(readFileSync(join(rn,'package.json'),'utf8')).version!=='0.86.0')throw Error('Matching normal RN0.86 dependency root required');
const require=createRequire(join(rn,'package.json')),ts=require.resolve('typescript');
const tsRoot=dirname(dirname(ts)),tsc=join(tsRoot,'bin/tsc');
const call=(exe,args,extra={})=>execFileSync(exe,args,{stdio:'inherit',...extra});
call(process.execPath,[join(root,'test/run-native-controls.mjs')]);
call(process.execPath,[join(root,'test/run-os-controls.mjs')]);
call(process.execPath,[join(root,'test/run-directory-controls.mjs')]);
call(process.execPath,[join(root,'test/run-app-directory-controls.mjs')]);
call(process.execPath,[join(root,'test/run-account-picker-controls.mjs')]);
call(process.execPath,[join(root,'test/run-registered-receipt-controls.mjs')]);
call(process.execPath,[join(root,'test/run-registered-phase-controls.mjs')]);
call(process.execPath,['--test',join(root,'test/hermes-client.PUBLIC.test.mjs')],{env:{...process.env,YNX_TYPESCRIPT_MODULE:tsRoot}});
call('clang++',['-std=c++17','-Wall','-Wextra','-Werror','-fsyntax-only','-I',join(rn,'ReactCommon/jsi'),'-I',join(rn,'ReactCommon/callinvoker'),join(root,'native/CustodyJSI.cpp')]);
const stage=mkdtempSync(join(tmpdir(),'ynx-mobile-pq-types-'));
try{
 mkdirSync(join(stage,'test'));writeFileSync(join(stage,'index.ts'),readFileSync(join(root,'index.ts')));
 writeFileSync(join(stage,'test/contract.typecheck.ts'),readFileSync(join(root,'test/contract.typecheck.ts')));
 symlinkSync(dirname(rn),join(stage,'node_modules'),'dir');
 call(process.execPath,[tsc,'--noEmit','--strict','--noUncheckedIndexedAccess','--skipLibCheck','--target','ES2022','--module','preserve','--moduleResolution','bundler',join(stage,'index.ts'),join(stage,'test/contract.typecheck.ts')],{cwd:stage});
}finally{rmSync(stage,{recursive:true,force:true});}
console.log('Module host/native+Hermes/typed+actual JSI syntax checks complete. No platform link, real Source or signing is claimed.');

import {mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),stage=mkdtempSync(join(tmpdir(),'ynx-mobile-dir-public-'));
try{
 execFileSync('clang++',['-std=c++17','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-fno-omit-frame-pointer','-pthread','-I',join(root,'native'),join(root,'native/SelectedDirectoryInventory.cpp'),join(root,'test/selected-directory.PUBLIC.cpp'),'-o',join(stage,'controls')],{stdio:'inherit'});
 execFileSync(join(stage,'controls'),[],{stdio:'inherit',env:{...process.env,ASAN_OPTIONS:`detect_leaks=${process.platform==='darwin'?0:1}`}});
}finally{rmSync(stage,{recursive:true,force:true});}

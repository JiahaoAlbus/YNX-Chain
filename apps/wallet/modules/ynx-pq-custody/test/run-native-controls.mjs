import {mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=mkdtempSync(join(tmpdir(),'ynx-mobile-pq-public-'));
try{
 execFileSync('clang++',['-std=c++17','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-fno-omit-frame-pointer','-pthread','-I',join(root,'native'),join(root,'native/CustodySession.cpp'),join(root,'native/SerialCustodyWorker.cpp'),join(root,'test/custody-session.PUBLIC.cpp'),'-o',join(out,'controls')],{stdio:'inherit'});
 // Apple's ASAN lacks LeakSanitizer. Keep ASAN+UBSAN active; this is not a
 // claim of leak coverage. Explicit PUBLIC owner/loan counts cover custody.
 execFileSync(join(out,'controls'),[],{stdio:'inherit',env:{...process.env,ASAN_OPTIONS:`detect_leaks=${process.platform==='darwin'?0:1}`}});
}finally{rmSync(out,{recursive:true,force:true});}

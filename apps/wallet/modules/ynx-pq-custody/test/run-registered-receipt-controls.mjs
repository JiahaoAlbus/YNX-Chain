import {mkdtempSync,rmSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),stage=mkdtempSync(join(tmpdir(),'ynx-receipt-public-'));
try{
 for(const normal of [true,false]){
  const executable=join(stage,normal?'policy-normal':'policy-public');
  execFileSync('clang++',['-std=c++17','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',...(normal?[]:['-DYNX_NATIVE_RECEIPT_DIRECTORY_PUBLIC_CONTROLS']),'-I',join(root,'native'),join(root,'native/NativeReceiptDirectoryPolicy.cpp'),join(root,'test/receipt-directory-policy.PUBLIC.cpp'),'-o',executable],{stdio:'inherit'});
  execFileSync(executable,[],{stdio:'inherit',env:{...process.env,ASAN_OPTIONS:`detect_leaks=${process.platform==='darwin'?0:1}`}});
 }
 execFileSync('clang++',['-std=c++17','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-fno-omit-frame-pointer','-pthread','-DYNX_NATIVE_RECEIPT_DIRECTORY_PUBLIC_CONTROLS','-I',join(root,'native'),join(root,'native/NativeAccountPicker.cpp'),join(root,'native/NativeReceiptDirectoryPolicy.cpp'),join(root,'native/NativeRegisteredReceiptOwner.cpp'),join(root,'test/registered-receipt.PUBLIC.cpp'),'-o',join(stage,'controls')],{stdio:'inherit'});
 execFileSync(join(stage,'controls'),[],{stdio:'inherit',env:{...process.env,ASAN_OPTIONS:`detect_leaks=${process.platform==='darwin'?0:1}`}});
}finally{rmSync(stage,{recursive:true,force:true});}

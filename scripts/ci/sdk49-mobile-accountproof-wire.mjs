import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,lstatSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const pkg=path.join(root,'packages/wallet-auth');
const layout=process.argv.length===3&&process.argv[2]==='--check-layout';
if(process.argv.length!==2&&!layout)throw new Error('SDK_ACCOUNT_PROOF_CI_ARGUMENTS');
const headerPins={"native/mobile-accountproof-host-v1/MobileAccountProofHostPortPrivate.hpp": "8aa0a0bf28ecfc139fc6a6c637abe4e6e38730cc97c1a9f1dfc70cc2ca9823a4", "native/mobile-accountproof-host-v1/MobileAccountProofWireDATA.hpp": "786c9b56aa445e82d0ffbc64e949272cb99692a674341e036199bccbe2b564fe"};
for(const [rel,expected]of Object.entries(headerPins)){
 const f=path.join(pkg,rel);if(!lstatSync(f).isFile()||createHash('sha256').update(readFileSync(f)).digest('hex')!==expected)throw new Error('SDK_ACCOUNT_PROOF_HEADER_DIFFERS');
}
const manifest=JSON.parse(readFileSync(path.join(pkg,'package.json'),'utf8'));
for(const rel of Object.keys(headerPins))if(!manifest.files.includes(rel))throw new Error('SDK_ACCOUNT_PROOF_NOT_PACKAGED');
const directory=mkdtempSync(path.join(tmpdir(),'ynx-sdk-accountproof-data-'));
try{
 const compiler=process.platform==='darwin'?'/usr/bin/clang++':'c++';
 for(const name of ['wire-data-controls','wire-firstcause-delta']){
  const source=path.join(pkg,'test/mobile-accountproof-host-v1',name+'.cpp');
  if(!lstatSync(source).isFile())throw new Error('SDK_ACCOUNT_PROOF_TEST_SOURCE_MISSING');
  const output=path.join(directory,name);
  const args=['-std=c++17','-Wall','-Wextra','-Werror',...(layout?['-fsyntax-only'] : []),source,...(layout?[]:['-o',output])];
  const c=spawnSync(compiler,args,{stdio:'inherit'});if(c.status!==0)throw new Error('SDK_ACCOUNT_PROOF_DATA_COMPILE_FAILED '+String(c.status));
  if(!layout){const r=spawnSync(output,[],{stdio:'inherit'});if(r.status!==0)throw new Error('SDK_ACCOUNT_PROOF_DATA_CONTROL_FAILED '+String(r.status));}
 }
 console.log(JSON.stringify({normalLayout:true,layoutOnly:layout,controlsExecuted:layout?0:12,headerFilesPackaged:2,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,genuineReceiptVerified:false}));
}finally{rmSync(directory,{recursive:true,force:true});}

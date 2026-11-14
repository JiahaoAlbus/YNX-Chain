import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const nativeRelative='Contents/Resources/code/apps/developer/apps/wallet-desktop/native';
const names=['original-auth-identity.node',...['libcrypto.3.dylib','libssl.3.dylib','libuv.1.dylib','LIBUV-LICENSE-docs.txt','LIBUV-LICENSE-extra.txt','LIBUV-LICENSE.txt','OPENSSL-AUTHORS.md','OPENSSL-LICENSE.txt'].map(n=>'original-auth-runtime-libs/'+n)];
const recordRelative='Contents/Resources/native-link/packaged-native-runtime.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>Object.assign(Error('Final packaged native runtime differs from its sealed component bytes.'),{code:'YNX_PACKAGED_NATIVE_RUNTIME_CHANGED'});
async function regular(path){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||await realpath(path)!==path)throw fail();return s;}
async function snapshot(app){
 if(resolve(app)!==app||await realpath(app)!==app)throw fail();
 const files=[];
 for(const name of names){
  const relativePath=nativeRelative+'/'+name,path=join(app,relativePath),s=await regular(path),bytes=await readFile(path);
  if(s.size!==bytes.length||!bytes.length)throw fail();
  // Metadata-only signature verification. This never loads Native, executes a
  // supplier, opens a Root Source, or gives an integrity record authority.
  const code=/\.(node|dylib)$/.test(name);
  if(code)execFileSync('/usr/bin/codesign',['--verify','--strict',path],{stdio:'pipe'});
  files.push({relativePath,bytes:bytes.length,sha256:sha(bytes),codeSignatureVerified:code});
 }
 return files;
}
export async function capturePackagedNativeRuntime(app){
 const files=await snapshot(app),record={schema:'YNX_PACKAGED_NATIVE_RUNTIME_SEAL/v1',files,phase:'after-nested-signing-before-outer-signature',metadataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
 // Fresh output only. A failed or mutated package is retained for diagnosis;
 // capturing again cannot relabel it as the same successful artifact.
 const output=join(app,recordRelative);await writeFile(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
 return {path:recordRelative,bytes:(await readFile(output)).length,sha256:sha(await readFile(output)),files:files.length};
}
export async function verifyPackagedNativeRuntime(app){
 const path=join(app,recordRelative);await regular(path);const record=JSON.parse(await readFile(path));
 if(record.schema!=='YNX_PACKAGED_NATIVE_RUNTIME_SEAL/v1'||record.phase!=='after-nested-signing-before-outer-signature'||record.metadataOnly!==true||record.RootAdmission!==false||record.SourceAdmission!==false||record.NativeAdmission!==false)throw fail();
 const files=await snapshot(app);
 if(JSON.stringify(files)!==JSON.stringify(record.files))throw fail();
 return {verified:true,files:files.length,metadataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,app]=process.argv.slice(2);if(process.argv.length!==4||!['capture','verify'].includes(mode))throw Error('Use capture|verify exact canonical App');
 console.log(JSON.stringify(await (mode==='capture'?capturePackagedNativeRuntime(app):verifyPackagedNativeRuntime(app))));
}

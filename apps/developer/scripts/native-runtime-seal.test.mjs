import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,copyFile,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {capturePackagedNativeRuntime,verifyPackagedNativeRuntime} from './native-runtime-seal.mjs';
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-component-seal-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const app=join(root,'QA.app'),native=join(app,'Contents/Resources/code/apps/developer/apps/wallet-desktop/native');
 await mkdir(join(native,'original-auth-runtime-libs'),{recursive:true});await mkdir(join(app,'Contents/Resources/native-link'),{recursive:true});
 // PUBLIC OS-signed metadata controls only. Never execute these copies; they
 // do not implement Native, NAPI, Source or any protected SDK operation.
 for(const name of ['original-auth-identity.node',...['libcrypto.3.dylib','libssl.3.dylib','libuv.1.dylib'].map(n=>'original-auth-runtime-libs/'+n)])await copyFile('/usr/bin/true',join(native,name),1);
 for(const name of ['LIBUV-LICENSE-docs.txt','LIBUV-LICENSE-extra.txt','LIBUV-LICENSE.txt','OPENSSL-AUTHORS.md','OPENSSL-LICENSE.txt'])await writeFile(join(native,'original-auth-runtime-libs',name),'PUBLIC license control\n');
 return {app,native};
}
test('complete signed metadata snapshot seals all nine assets without executing component code',async t=>{
 const {app}=await fixture(t),record=await capturePackagedNativeRuntime(app);assert.equal(record.files,9);
 const result=await verifyPackagedNativeRuntime(app);assert.equal(result.verified,true);assert.equal(result.NativeAdmission,false);assert.equal(result.metadataOnly,true);
 await assert.rejects(capturePackagedNativeRuntime(app),{code:'EEXIST'});
});
test('post-capture library signature or license mutation cannot reuse the sealed record',async t=>{
 const {app,native}=await fixture(t);await capturePackagedNativeRuntime(app);
 const license=join(native,'original-auth-runtime-libs/OPENSSL-LICENSE.txt'),before=await readFile(license);await writeFile(license,'changed');
 await assert.rejects(verifyPackagedNativeRuntime(app),{code:'YNX_PACKAGED_NATIVE_RUNTIME_CHANGED'});await writeFile(license,before);
 const image=join(native,'original-auth-identity.node');await writeFile(image,Buffer.concat([await readFile(image),Buffer.from('unsigned mutation')]));
 await assert.rejects(verifyPackagedNativeRuntime(app));
});
test('missing or symbolic runtime sibling refuses rather than sealing a partial component',async t=>{
 const {app,native}=await fixture(t),path=join(native,'original-auth-runtime-libs/libuv.1.dylib');await rm(path);await assert.rejects(capturePackagedNativeRuntime(app));await symlink('/usr/bin/true',path);
 await assert.rejects(capturePackagedNativeRuntime(app),{code:'YNX_PACKAGED_NATIVE_RUNTIME_CHANGED'});
});
test('actual normal outer signing preserves all captured nested component bytes',async t=>{
 const {app}=await fixture(t);await mkdir(join(app,'Contents/MacOS'));
 await copyFile('/usr/bin/true',join(app,'Contents/MacOS/YNXDeveloper'),1);
 await writeFile(join(app,'Contents/Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.ynx.public-seal-control</string><key>CFBundleExecutable</key><string>YNXDeveloper</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
 await capturePackagedNativeRuntime(app);
 const script=await readFile(new URL('./package-local-macos.sh',import.meta.url),'utf8'),command=script.split('\n').find(l=>l.startsWith('/usr/bin/codesign --force ')&&l.endsWith('"$app"'));
 assert.ok(command);execFileSync('/bin/bash',['-e','-c',command],{env:{...process.env,app},stdio:'pipe'});
 assert.equal((await verifyPackagedNativeRuntime(app)).verified,true);
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
});

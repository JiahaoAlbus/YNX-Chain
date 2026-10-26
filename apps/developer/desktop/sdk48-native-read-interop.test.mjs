import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,readFile,lstat} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {join} from 'node:path';import os from 'node:os';
const sdk=process.env.YNX_IDE_PUBLIC_READ_INTEROP_SDK_ROOT;
test('actual packaged SDK48 and Native P256 read port interoperate without login or actual network (PUBLIC fixture)',{
 skip:process.platform!=='darwin'?'macOS Native controls required':!sdk?'Actual packaged SDK48 input not supplied; no interop acceptance claimed':false,timeout:30000
},async()=>{
 const st=await lstat(sdk);assert.ok(st.isDirectory()&&!st.isSymbolicLink());assert.equal(await realpath(sdk),sdk);
 const pkg=JSON.parse(await readFile(join(sdk,'package.json'),'utf8'));assert.equal(pkg.name,'@ynx-chain/wallet-auth');assert.equal(pkg.version,'1.3.0-pq.3.32-auth.48');
 const root=await mkdtemp(join(await realpath(os.tmpdir()),'ynx-public-native-sdk48-'));
 try{
  const binary=join(root,'control'),source=fileURLToPath(new URL('./macos/native-sdk48-public-interop.mm',import.meta.url));
  execFileSync('/usr/bin/clang++',['-fobjc-arc','-std=c++17','-mmacosx-version-min=15.0','-framework','Foundation','-framework','Security',source,'-o',binary],{timeout:20000,stdio:'pipe'});
  const output=execFileSync(process.execPath,[fileURLToPath(new URL('./sdk48-native-read-interop-control.mjs',import.meta.url))],{
   timeout:10000,encoding:'utf8',env:{...process.env,YNX_IDE_PUBLIC_READ_INTEROP_BINARY:binary}
  });
  const result=JSON.parse(output);assert.equal(result.actualNativeP256SignatureVerified,true);assert.equal(result.storageWrites,0);
  assert.equal(result.openingNetworkCalls,0);assert.equal(result.openingSignCalls,0);assert.equal(result.controlledTimeResponses,2);assert.equal(result.nativeSignCalls,1);
  assert.equal(result.POSTRejected,true);assert.equal(result.closedReadRejected,true);assert.equal(result.publicFakeSource,true);assert.equal(result.authorityTimeMocked,true);assert.equal(result.actualNetworkCalls,0);
  assert.equal(result.SourceAdmitted,false);assert.equal(result.installedApp,false);
 }finally{await rm(root,{recursive:true,force:true});}
});

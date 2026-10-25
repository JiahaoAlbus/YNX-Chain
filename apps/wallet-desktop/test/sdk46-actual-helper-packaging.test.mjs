import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
const root=process.env.WALLET_SDK46_HELPER_SOURCE_ROOT;
const hash=b=>createHash('sha256').update(b).digest('hex');
test('SDK46 afterPack branch uses actual original helper105 stager and exact Library pair without execution or registration',{skip:!root?'requires original A actually generated SDK46 Native100/helper105 and runtime':false},async t=>{
 const projectDir=path.join(root,'apps/wallet-desktop'),module=await import(pathToFileURL(path.join(projectDir,'scripts/sdk13-native-component.mjs')));
 const recordPath=path.join(projectDir,'native/original-auth-identity-build.json'),recordBytes=fs.readFileSync(recordPath),record=JSON.parse(recordBytes);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'packages/wallet-auth/package.json'))).version,'1.3.0-pq.3.32-auth.46');
 assert.equal(record.helperBuild.inputFiles.length,105);assert.deepEqual(record.architectures,['arm64']);
 const helper=fs.readFileSync(path.join(root,module.SDK13_HELPER_ASSET)),plist=fs.readFileSync(path.join(root,module.SDK13_HELPER_PLIST));
 assert.equal(hash(helper),record.helperBuild.output.sha256);assert.equal(helper.length,record.helperBuild.output.bytes);
 const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wallet-sdk46-helper-pack-')));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 const contents=path.join(temporary,'YNX Wallet.app/Contents');fs.mkdirSync(contents,{recursive:true});
 // Controlled afterPack boundary: real production helper stager and original
 // generated files; unrelated ASAR/plist/signing phases are not re-executed.
 const stopped=Error('CONTROLLED proof-assets boundary after original helper staging'),calls=[];
 const context={path,process:{env:{}},desktopReleaseIdentity:()=>({controlled:true}),writeFile:async()=>{},assembleCanonicalDesktopPackage:()=>{},WALLETCONNECT_PUBLIC_CONFIG_FILE:'PUBLIC.json',buildPublicWalletConnectConfig:()=>({}),readFile:fs.promises.readFile,stageSDK13HelperBundle:args=>{calls.push(args);return module.stageSDK13HelperBundle(args);},installPackagedPQVerifierAssets:async()=>{throw stopped;},originalPQVerifierReceipt:{},execFileSync:()=>{throw Error('unexpected plist/signing execution');}};
 const raw=fs.readFileSync(new URL('../scripts/after-pack.mjs',import.meta.url),'utf8'),code=raw.replace(/^import .*;\n/gm,'').replaceAll('export default ','').replace(/^export /gm,'');runInNewContext(code+'\nthis.run=afterPack;',context);
 await assert.rejects(context.run({packager:{projectDir,appInfo:{version:'0.6.10',productFilename:'YNX Wallet'}},appOutDir:temporary,electronPlatformName:'darwin',arch:3}),e=>e===stopped);
 assert.equal(calls.length,1);assert.equal(calls[0].contents,contents);
 assert.equal(module.verifySDK13HelperBundle(contents,helper,plist).bytesVerified,true);
 const helperTarget=path.join(contents,module.SDK13_BUNDLE_HELPER),plistTarget=path.join(contents,module.SDK13_BUNDLE_PLIST);
 for(const [file,bytes,mode]of [[helperTarget,helper,0o755],[plistTarget,plist,0o644]]){
  assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.lstatSync(file).mode&0o777,mode);if(process.getuid)assert.equal(fs.lstatSync(file).uid,process.getuid());
  const changed=Buffer.from(bytes);changed[0]^=1;fs.writeFileSync(file,changed);
  assert.throws(()=>module.verifySDK13HelperBundle(contents,helper,plist));assert.throws(()=>module.stageSDK13HelperBundle({contents,projectDir}));assert.deepEqual(fs.readFileSync(file),changed);fs.writeFileSync(file,bytes);
  fs.chmodSync(file,0o600);assert.throws(()=>module.verifySDK13HelperBundle(contents,helper,plist));fs.chmodSync(file,mode);
  fs.unlinkSync(file);const outside=path.join(temporary,path.basename(file)+'.outside');fs.writeFileSync(outside,bytes);fs.symlinkSync(outside,file);assert.throws(()=>module.verifySDK13HelperBundle(contents,helper,plist));fs.unlinkSync(file);fs.writeFileSync(file,bytes,{mode});
 }
 assert.equal(module.verifySDK13HelperBundle(contents,helper,plist).bytesVerified,true);
 const restaged=module.stageSDK13HelperBundle({contents,projectDir});assert.equal(restaged.executed,false);assert.equal(restaged.serviceRegistered,false);assert.equal(restaged.installed,false);
 assert.deepEqual(fs.readFileSync(recordPath),recordBytes);assert.deepEqual(fs.readFileSync(path.join(root,module.SDK13_HELPER_ASSET)),helper);assert.deepEqual(fs.readFileSync(path.join(root,module.SDK13_HELPER_PLIST)),plist);
});

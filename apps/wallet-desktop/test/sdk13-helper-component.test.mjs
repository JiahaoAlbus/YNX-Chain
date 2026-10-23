import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {SDK13_HELPER_TRANSLATION_UNITS,SDK13_HELPER_SOURCE_OUTPUT,SDK13_HELPER_ASSET,SDK13_HELPER_PLIST,SDK13_INVENTORY_PIN,sdk13HelperBuildCommands,verifySDK13NativeComponent,stageSDK13HelperBundle,verifySDK13HelperBundle} from '../scripts/sdk13-native-component.mjs';
import {SDK13_NODE_TRANSLATION_UNITS,WALLET_PUBLISHER_NATIVE_INPUTS,composeWalletPublisherNativeBuildPlan,walletNativeSourceProfile} from '../scripts/wallet-publisher-native-build.mjs';
import {PINNED_NODE_HEADER_PINS} from '../scripts/canonical-package.mjs';
import {SDK_RUNTIME_UNIONS,sdkRuntimeUnionProfile,SDK14_RUNTIME_UNION_SOURCE} from '../scripts/sdk14-runtime-union.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),pin=(relative,b)=>({relative,bytes:b.length,sha256:sha(b)});
const originalRoot=process.env.WALLET_SDK13_SOURCE_ROOT??fileURLToPath(new URL('../../..',import.meta.url));
let available=false;try{available=['1.3.0-pq.3.32-auth.13','1.3.0-pq.3.32-auth.14','1.3.0-pq.3.32-auth.18','1.3.0-pq.3.32-auth.19'].includes(JSON.parse(fs.readFileSync(path.join(originalRoot,'packages/wallet-auth/package.json'))).version);}catch{}
const needSource={skip:!available&&'requires matching original SDK13 native source, not a substituted source fixture'};
test('original helper recipe is11 exact TUs, never Wallet store or LocalAuthentication',()=>{
 assert.equal(SDK13_HELPER_TRANSLATION_UNITS.length,11);
 for(const arches of [['arm64'],['x86_64'],['arm64','x86_64']]){
  const commands=sdk13HelperBuildCommands('/PUBLIC/source',arches);
  for(const command of commands){assert.equal(command.argv.some(x=>x.includes('artifact-publisher-store')),false);assert.equal(command.argv.includes('LocalAuthentication'),false);}
 }
 assert.throws(()=>sdk13HelperBuildCommands('/PUBLIC/source',['x86_64','arm64']));
});
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ynx-sdk13-component-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const inventoryName='packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',inventoryBytes=fs.readFileSync(path.join(originalRoot,inventoryName)),inventory=JSON.parse(inventoryBytes),supplier=[...inventory.NativeInputs,...inventory.HelperInputs],profile=walletNativeSourceProfile(inventory.version);
 const put=(relative,bytes,mode=0o644)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{mode});};
 for(const p of supplier)put(p.path,fs.readFileSync(path.join(originalRoot,p.path)));
 // Original supplier inputs stay bound to selected supplier version. The
 // independently pinned Main store is from THIS Main source, not an older
 // assembled candidate whose private store may intentionally differ.
 const mainRoot=fileURLToPath(new URL('../../..',import.meta.url));
 for(const p of WALLET_PUBLISHER_NATIVE_INPUTS)put(p.path,fs.readFileSync(path.join(mainRoot,p.path)));
 put(inventoryName,inventoryBytes);
 if(Object.hasOwn(SDK_RUNTIME_UNIONS,profile.version))put(SDK14_RUNTIME_UNION_SOURCE,fs.readFileSync(path.join(originalRoot,SDK14_RUNTIME_UNION_SOURCE)));
 // Deliberate PUBLIC non-executable output stand-ins. This tests record,
 // exact source/byte binding and candidate assembly, NEVER compiler execution
 // or Native qualification. No binary is loaded, signed or run by this test.
 const moduleBytes=Buffer.from('PUBLIC not a compiled module'),helperBytes=Buffer.from('PUBLIC not a compiled helper'),sourceRoot='/PUBLIC/original-producer',headerRoot='/PUBLIC/pinned-headers',output='apps/wallet-desktop/native/original-auth-identity.node';
 const sources=SDK13_NODE_TRANSLATION_UNITS.map(n=>path.join(sourceRoot,n));
 const plan=composeWalletPublisherNativeBuildPlan({minimumSystemVersion:'13.0',sources,output:path.join(sourceRoot,output),outputs:[path.join(sourceRoot,output)],commands:[{tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min=13.0','-I'+headerRoot,'-I'+path.join(sourceRoot,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security','-framework','AppKit','-framework','ServiceManagement','-lbsm','-arch','arm64',...sources,'-o',path.join(sourceRoot,output)]}]},sourceRoot,profile.supplierNodeInputs);
 const scan=relative=>({tool:'/usr/bin/nm',argv:['-u',path.join(sourceRoot,relative)],exit:0,stdoutSHA256:sha(Buffer.from('PUBLIC controlled nm DATA')),ownedUndefined:[]});
 const record={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0',readbackOnly:false,commandsKind:'executed-normal-build',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot,headerRoot,sourceInventory:{relative:inventoryName,...profile.inventory},inputFiles:[...inventory.NativeInputs,...WALLET_PUBLISHER_NATIVE_INPUTS].map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})),headers:PINNED_NODE_HEADER_PINS,architectures:['arm64'],commands:plan.commands,exitCodes:[0],ownedUndefinedScan:scan(output),output:pin(output,moduleBytes),helperBuild:{kind:'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1',sourceRoot,architectures:['arm64'],readbackOnly:false,commandsKind:'executed-normal-build',executed:true,serviceRegistered:false,installed:false,nativeQualified:false,appSigned:false,inputFiles:supplier.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en')),commands:sdk13HelperBuildCommands(sourceRoot,['arm64']),exitCodes:[0],ownedUndefinedScan:scan(SDK13_HELPER_SOURCE_OUTPUT),output:pin(SDK13_HELPER_SOURCE_OUTPUT,helperBytes),packagedOutput:SDK13_HELPER_ASSET,plist:pin(SDK13_HELPER_PLIST,fs.readFileSync(path.join(root,SDK13_HELPER_PLIST)))}};
 if(Object.hasOwn(SDK_RUNTIME_UNIONS,profile.version))record.runtimeUnion={...sdkRuntimeUnionProfile(profile.version),filesVerified:9335,sourceRoot:path.join(sourceRoot,'packages/wallet-auth'),NativeAdmission:false,installedImageQualified:false,platformQualified:false,networkActivated:false};
 put(output,moduleBytes);put(SDK13_HELPER_ASSET,helperBytes,0o755);
 const recordName='apps/wallet-desktop/native/original-auth-identity-build.json',save=()=>put(recordName,Buffer.from(JSON.stringify(record)));
 save();const contents=path.join(root,'PUBLIC.app/Contents');fs.mkdirSync(contents,{recursive:true});
 return {root,contents,record,put,save,helperBytes,run:()=>verifySDK13NativeComponent({record,inventoryBytes,moduleBytes,helperBytes},name=>fs.readFileSync(path.join(root,name))),stage:()=>stageSDK13HelperBundle({contents,projectDir:path.join(root,'apps/wallet-desktop')})};
}
test('PUBLIC record/output seam binds actual original supplier sources without claiming compiler execution',needSource,t=>{
 const f=fixture(t),checked=f.run();assert.equal(checked.sourceBytesVerified,true);assert.equal(checked.nativeQualified,false);assert.equal(checked.helper.translationUnits,11);assert.equal(checked.installed,false);
 if(f.record.runtimeUnion){const runtime=process.env.WALLET_MATCHED_RUNTIME_ROOT??process.env.WALLET_SDK14_RUNTIME_ROOT;if(!runtime){t.skip('requires actual matching normal SDK runtime for physical candidate staging');return;}fs.cpSync(runtime,path.join(f.root,'packages/wallet-auth'),{recursive:true,force:false});}
 const staged=f.stage();assert.equal(staged.serviceRegistered,false);assert.equal(staged.executed,false);
 assert.equal(verifySDK13HelperBundle(f.contents,f.helperBytes,fs.readFileSync(path.join(f.root,SDK13_HELPER_PLIST))).bytesVerified,true);
});
test('old/plan-only/failed/helper-store/missing-source records refuse candidate staging',needSource,t=>{
 for(const mode of ['plan','exit','store','missing','source','output']){
  const f=fixture(t);
  if(mode==='plan')f.record.readbackOnly=true;
  if(mode==='exit')f.record.helperBuild.exitCodes[0]=1;
  if(mode==='store')f.record.helperBuild.commands[0].argv.splice(-2,0,path.join(f.record.sourceRoot,WALLET_PUBLISHER_NATIVE_INPUTS[1].path));
  if(mode==='missing')f.record.helperBuild.inputFiles.pop();
  if(mode==='source')f.put(WALLET_PUBLISHER_NATIVE_INPUTS[0].path,Buffer.from('changed PUBLIC source'));
  if(mode==='output')f.put(SDK13_HELPER_ASSET,Buffer.from('changed PUBLIC output'));
  f.save();assert.throws(f.stage,/component differs|receipt or input pins differ/);
  assert.equal(fs.existsSync(path.join(f.contents,'Library')),false);
 }
});
test('PUBLIC normal builder compiler refusal never emits an executed success record or helper alias',needSource,t=>{
 const f=fixture(t),app='apps/wallet-desktop/',headers=process.env.WALLET_NODE_HEADER_ROOT??path.join(os.homedir(),'Library/Caches/node-gyp/22.13.1/include/node');
 if(!PINNED_NODE_HEADER_PINS.every(p=>fs.existsSync(path.join(headers,p.relative)))){t.skip('requires pinned original public Node headers');return;}
 for(const relative of ['packages/wallet-auth/package.json',app+'package.json',app+'scripts/build-original-auth-identity-native.mjs'])f.put(relative,fs.readFileSync(path.join(originalRoot,relative)));
 for(const relative of [app+'native/original-auth-identity.node',SDK13_HELPER_ASSET,app+'native/original-auth-identity-build.json'])fs.unlinkSync(path.join(f.root,relative));
 const filesystem={...fs},shared={...filesystem,path,fileURLToPath,createHash,process:{argv:[]}};
 const evaluate=(source,url,bindings,names)=>{
  const code=source.replace(/^import .*;$/mg,'').replace(/^export /mg,'').replaceAll('import.meta.url',JSON.stringify(url));
  const context={...shared,...bindings};runInNewContext(code+'\nthis.PUBLICexports={'+names.join(',')+'};',context);return context.PUBLICexports;
 };
 let calls=0;
 const compilerRefusal=Object.assign(Error('PUBLIC compiler boundary refusal; no compiler executed'),{code:'PUBLIC_COMPILER_REFUSAL'});
 const execFileSync=()=>{calls++;throw compilerRefusal;};
 const originalBuild=evaluate(fs.readFileSync(path.join(originalRoot,app+'scripts/build-original-auth-identity-native.mjs'),'utf8'),pathToFileURL(path.join(f.root,app+'scripts/build-original-auth-identity-native.mjs')).href,{execFileSync},['originalAuthNativeBuildPlan','originalIDEHelperBuildPlan','originalAuthSourceCurrentIOBuildPlan','assertOriginalAuthOwnedSymbols']);
 const bindings={execFileSync,originalBuild,composeWalletPublisherNativeBuildPlan,WALLET_PUBLISHER_NATIVE_INPUTS,walletNativeSourceProfile,PINNED_NODE_HEADER_PINS,SDK13_INVENTORY_PIN,SDK13_HELPER_SOURCE_OUTPUT,SDK13_HELPER_ASSET,SDK13_HELPER_PLIST,sdk13HelperBuildCommands,verifySDK13NativeComponent,SDK14_RUNTIME_UNION_SOURCE,SDK_RUNTIME_UNIONS,verifySDKRuntimeUnion:version=>({...sdkRuntimeUnionProfile(version),filesVerified:9335,NativeAdmission:false})};
 const builder=evaluate(fs.readFileSync(new URL('../scripts/build-wallet-native-component.mjs',import.meta.url),'utf8'),pathToFileURL(path.join(f.root,app+'scripts/build-wallet-native-component.mjs')).href,bindings,['buildWalletNativeComponent']);
 assert.throws(()=>builder.buildWalletNativeComponent('arm64',headers),e=>e===compilerRefusal);assert.equal(calls,1);
 assert.equal(fs.existsSync(path.join(f.root,app+'native/original-auth-identity-build.json')),false);
 assert.equal(fs.existsSync(path.join(f.root,SDK13_HELPER_ASSET)),false);
});

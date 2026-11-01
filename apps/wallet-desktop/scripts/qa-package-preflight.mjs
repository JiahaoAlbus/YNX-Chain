// Read-only non-GUI QA of the actual packaged runtime. No private owner open,
// account access, Source installation, signing, HTTP or transaction is selected.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const here=fileURLToPath(import.meta.url),fail=code=>{throw Error(code);};
export function inspectPhysicalQAApp(appPath,outputDirectory){
 for(const p of [appPath,outputDirectory])if(typeof p!=='string'||!path.isAbsolute(p)||path.normalize(p)!==p||fs.realpathSync(p)!==p)fail('QA_PREFLIGHT_CANONICAL_PATH_REQUIRED');
 const contents=appPath+'/Contents',resources=contents+'/Resources',layout=JSON.parse(fs.readFileSync(resources+'/ynx-wallet-physical-code-layout.json')),identity=JSON.parse(fs.readFileSync(resources+'/ynx-wallet-build-identity.json'));
 if(layout.kind!=='YNX_WALLET_PHYSICAL_QA_CODE_LAYOUT/v1'||layout.physicalRoot!=='app.code'||layout.officialRelease!==false||layout.SourceAdmission!==false||layout.RootAdmission!==false)fail('QA_PREFLIGHT_PHYSICAL_LAYOUT_REQUIRED');
 const name=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',contents+'/Info.plist'],{encoding:'utf8'}).trim(),bundle=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',contents+'/Info.plist'],{encoding:'utf8'}).trim();
 if(bundle!=='com.ynxweb4.wallet.qa.'+identity.sourceCommit.slice(0,12)||!name||path.basename(name)!==name)fail('QA_PREFLIGHT_DISTINCT_BUNDLE_REQUIRED');
 const code=resources+'/app.code',native=code+'/code/apps/wallet-desktop/native/original-auth-identity.node',script=outputDirectory+'/actual-package-preflight.mjs';if(fs.existsSync(script))fail('QA_PREFLIGHT_OUTPUT_EXISTS');
 const child=`import fs from 'node:fs';import {pathToFileURL}from'node:url';import{createRequire}from'node:module';
const root=${JSON.stringify(code)},require=createRequire(pathToFileURL(root+'/code/apps/wallet-desktop/package.json')),native=${JSON.stringify(native)},sdk=root+'/code/packages/wallet-auth';
if(require.cache[native])throw Error('UNEXPECTED_NATIVE_PRELOAD');
const {createOriginalRuntimeImagePreloadController}=await import(pathToFileURL(root+'/code/apps/wallet-desktop/src/original-runtime-image-preload.mjs'));
const admission=createOriginalRuntimeImagePreloadController();let refusal;try{await admission.ensureCurrent();throw Error('UNEXPECTED_ROOT_AUTHORITY');}catch(e){refusal=e.code;if(refusal!=='AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED')throw e;}await admission.close();if(require.cache[native])throw Error('ROOT0_LOADED_PROTECTED_IMAGE');
const a=await import(pathToFileURL(sdk+'/src/original-http-binary-v5-client-private.js')),b=await import(pathToFileURL(root+'/node_modules/@ynx-chain/wallet-auth/src/original-http-binary-v5-client-private.js'));if(a!==b)throw Error('DUPLICATE_SDK_NAMESPACE');
const {createOriginalNativePQCustody}=await import(pathToFileURL(root+'/code/apps/wallet-desktop/src/wallet-pq-native-custody.mjs'));const custody=createOriginalNativePQCustody();custody.assertAvailable();custody.assertInitialAvailable();if(custody.cleanupUnresolved())throw Error('UNEXPECTED_PRIVATE_OWNER');
const image=require(native),host=['acquireOriginalPQHostCatalogSource','isOriginalPQHostCatalogSource','readOriginalPQHostCatalogHandoff','assertOriginalPQHostCatalogSourceCurrent','observeOriginalPQHostCatalogSourceRevocation','retireOriginalPQHostCatalogSource','joinOriginalPQHostCatalogSource','closeOriginalPQHostCatalogSource','readOriginalPQHostCatalogSourceStatus'];for(const key of host)if(typeof Object.getOwnPropertyDescriptor(image,key)?.value!=='function')throw Error('MISSING_HOST_ABI '+key);
console.log(JSON.stringify({node:process.versions.node,electron:process.versions.electron,exports:Object.getOwnPropertyNames(image).length,hostCatalogExports:host,ordinaryCapability:image.originalPQCapabilities(),protectedPreloadRefusal:refusal,protectedRefusalDidNotLoadNative:true,sameCanonicalSDKNamespace:true,ordinaryOriginalEntryLoadedIndependently:true,privateOwnerOpened:false,SourceAdmission:false,RootAdmission:false,signing:false,HTTP:false,transactions:false}));`;
 fs.writeFileSync(script,child,{flag:'wx',mode:0o600});
 const r=spawnSync(contents+'/MacOS/'+name,[script],{encoding:'utf8',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,maxBuffer:1<<20});
 fs.writeFileSync(outputDirectory+'/actual-package-preflight.stdout',r.stdout??'');fs.writeFileSync(outputDirectory+'/actual-package-preflight.stderr',r.stderr??'');
 const result={appPath,sourceCommit:identity.sourceCommit,bundle,exit:r.status,signal:r.signal,actualPackagedRuntime:true,GUI:false,installed:false,officialRelease:false,...(r.status===0?{observed:JSON.parse(r.stdout)}:{firstFailure:r.stderr})};
 const bytes=fs.readFileSync(native);result.native={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};fs.writeFileSync(outputDirectory+'/ACTUAL_PACKAGE_PREFLIGHT.json',JSON.stringify(result,null,2)+'\n');if(r.status!==0)fail('QA_PACKAGE_PREFLIGHT_FAILED');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){if(process.argv.length!==4)fail('QA_PREFLIGHT_EXACT_INPUTS_REQUIRED');console.log(JSON.stringify(inspectPhysicalQAApp(process.argv[2],process.argv[3])));}

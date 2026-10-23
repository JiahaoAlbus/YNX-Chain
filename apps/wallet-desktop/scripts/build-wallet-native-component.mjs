import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as originalBuild from './build-original-auth-identity-native.mjs';
import {composeWalletPublisherNativeBuildPlan,WALLET_PUBLISHER_NATIVE_INPUTS,walletNativeSourceProfile} from './wallet-publisher-native-build.mjs';
import {PINNED_NODE_HEADER_PINS} from './canonical-package.mjs';
import {SDK13_HELPER_SOURCE_OUTPUT,SDK13_HELPER_ASSET,SDK13_HELPER_PLIST,sdk13HelperBuildCommands,verifySDK13NativeComponent} from './sdk13-native-component.mjs';
import {verifySDK14RuntimeUnion,SDK14_RUNTIME_UNION_SOURCE} from './sdk14-runtime-union.mjs';
const here=fileURLToPath(import.meta.url),app=path.resolve(path.dirname(here),'..'),repo=path.resolve(app,'../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
function assertMatchedOriginalBuild(){
 const sdk=JSON.parse(readFileSync(path.join(repo,'packages/wallet-auth/package.json')));
 const profile=walletNativeSourceProfile(sdk.version);
 const tool=path.join(app,'scripts/build-original-auth-identity-native.mjs'),toolStat=lstatSync(tool),toolBytes=readFileSync(tool);
 if(!toolStat.isFile()||toolStat.isSymbolicLink()||toolBytes.length!==profile.tool.bytes||hash(toolBytes)!==profile.tool.sha256)throw Error('WALLET_NATIVE_ORIGINAL_BUILD_TOOL_DIFFERS');
 return profile;
}
export function walletNativeComponentBuildPlan(arch,headers){
 const profile=assertMatchedOriginalBuild();
 for(const pin of WALLET_PUBLISHER_NATIVE_INPUTS){const file=path.join(repo,pin.path),stat=lstatSync(file),bytes=readFileSync(file);if(!stat.isFile()||stat.isSymbolicLink()||bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('WALLET_NATIVE_PUBLISHER_SOURCE_DIFFERS');}
 return composeWalletPublisherNativeBuildPlan(originalBuild.originalAuthNativeBuildPlan(arch,headers),repo,profile.supplierNodeInputs);
}
const regular=file=>{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('WALLET_NATIVE_BUILD_FILE_NOT_REGULAR');return readFileSync(file);};
const pin=(relative,bytes)=>({relative,bytes:bytes.length,sha256:hash(bytes)});
function createExclusive(file,bytes,mode){let fd;try{fd=openSync(file,'wx',mode);writeFileSync(fd,bytes);fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}const parent=openSync(path.dirname(file),'r');try{fsyncSync(parent);}finally{closeSync(parent);}}
/** Sole original builder entry. Executes the exact original supplier plans
 * plus the separately pinned Wallet user-addon TU, then records real exits.
 * Never installs a service, accesses custody or claims Native admission.
 */
export function buildWalletNativeComponent(arch,headers){
 const node=walletNativeComponentBuildPlan(arch,headers),helper=originalBuild.originalIDEHelperBuildPlan(arch),architectures=arch==='universal'?['arm64','x86_64']:[arch==='x64'?'x86_64':arch];
 const profile=assertMatchedOriginalBuild(),inventoryPin=profile.inventory;
 if(JSON.stringify(helper.commands)!==JSON.stringify(sdk13HelperBuildCommands(repo,architectures)))throw Error('WALLET_NATIVE_HELPER_PLAN_DIFFERS');
 const inventoryRelative='packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',inventoryBytes=regular(path.join(repo,inventoryRelative));
 if(inventoryBytes.length!==inventoryPin.bytes||hash(inventoryBytes)!==inventoryPin.sha256)throw Error('WALLET_NATIVE_SOURCE_INVENTORY_DIFFERS');
 const inventory=JSON.parse(inventoryBytes),supplier=[...inventory.NativeInputs,...inventory.HelperInputs];
 const runtimeUnion=profile.version==='1.3.0-pq.3.32-auth.14'?verifySDK14RuntimeUnion(path.join(repo,'packages/wallet-auth'),regular(path.join(repo,SDK14_RUNTIME_UNION_SOURCE))):null;
 for(const p of supplier){const bytes=regular(path.join(repo,p.path));if(bytes.length!==p.bytes||hash(bytes)!==p.sha256)throw Error('WALLET_NATIVE_SUPPLIER_SOURCE_DIFFERS');}
 const headerPins=PINNED_NODE_HEADER_PINS.map(p=>{const bytes=regular(path.join(headers,p.relative));if(bytes.length!==p.bytes||hash(bytes)!==p.sha256)throw Error('WALLET_NATIVE_PINNED_HEADERS_DIFFER');return {...p};});
 const recordPath=path.join(app,'native/original-auth-identity-build.json'),helperAlias=path.join(repo,SDK13_HELPER_ASSET);
 // A uses an isolated matching source tree. Existing outputs are preserved;
 // a repeated build must not replace a previously uncertain component.
 const outputs=[...node.commands.filter(c=>c.tool==='/usr/bin/clang++').map(c=>c.argv.at(-1)),node.output,...helper.commands.filter(c=>c.tool==='/usr/bin/clang++').map(c=>c.argv.at(-1)),helper.output,recordPath,helperAlias];
 for(const file of new Set(outputs)){try{lstatSync(file);throw Error('WALLET_NATIVE_COMPONENT_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const command of [...node.commands,...helper.commands])execFileSync(command.tool,command.argv,{stdio:'inherit'});
 const scan=plan=>{const stdout=execFileSync(plan.ownedUndefinedScan.tool,plan.ownedUndefinedScan.argv,{encoding:'utf8'});originalBuild.assertOriginalAuthOwnedSymbols(stdout);return {...plan.ownedUndefinedScan,exit:0,stdoutSHA256:hash(Buffer.from(stdout)),ownedUndefined:[]};};
 const nodeScan=scan(node),helperScan=scan(helper),moduleBytes=regular(node.output),helperBytes=regular(helper.output);
 const record={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0',readbackOnly:false,commandsKind:'executed-normal-build',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot:repo,headerRoot:headers,sourceInventory:{relative:inventoryRelative,...inventoryPin},inputFiles:[...inventory.NativeInputs,...WALLET_PUBLISHER_NATIVE_INPUTS].map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})),headers:headerPins,architectures,commands:node.commands,exitCodes:node.commands.map(()=>0),ownedUndefinedScan:nodeScan,output:pin('apps/wallet-desktop/native/original-auth-identity.node',moduleBytes),helperBuild:{kind:'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1',sourceRoot:repo,architectures,readbackOnly:false,commandsKind:'executed-normal-build',executed:true,serviceRegistered:false,installed:false,nativeQualified:false,appSigned:false,inputFiles:supplier.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en')),commands:helper.commands,exitCodes:helper.commands.map(()=>0),ownedUndefinedScan:helperScan,output:pin(SDK13_HELPER_SOURCE_OUTPUT,helperBytes),packagedOutput:SDK13_HELPER_ASSET,plist:pin(SDK13_HELPER_PLIST,regular(path.join(repo,SDK13_HELPER_PLIST)))}};
 if(runtimeUnion)record.runtimeUnion=runtimeUnion;
 verifySDK13NativeComponent({record,inventoryBytes,moduleBytes,helperBytes},name=>regular(path.join(repo,name)));
 createExclusive(helperAlias,helperBytes,0o755);
 createExclusive(recordPath,Buffer.from(JSON.stringify(record,null,2)+'\n'),0o600);
 return {recordPath,sourceInputs:supplier.length+WALLET_PUBLISHER_NATIVE_INPUTS.length,nodeTranslationUnits:14,helperTranslationUnits:11,appSigned:false,nativeQualified:false,installed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){
 if(process.platform!=='darwin')throw Error('AUTH_NATIVE_MAC_ONLY');
 assertMatchedOriginalBuild();
 const mode=process.argv[2];
 if(mode==='component'){if(process.argv.length!==5)throw Error('WALLET_NATIVE_BUILD_ARGUMENTS_INVALID');buildWalletNativeComponent(process.argv[3],process.argv[4]);}
 else {
 const helper=mode==='helper',io=mode==='source-current-io';
 if(helper&&process.argv.length!==4||io&&process.argv.length!==5||!helper&&!io&&process.argv.length!==4)throw Error('WALLET_NATIVE_BUILD_ARGUMENTS_INVALID');
 // Helper and separately explicit server IO retain the original supplier plan;
 // the Wallet Keychain class must NEVER be compiled into the privileged helper.
 const plan=helper?originalBuild.originalIDEHelperBuildPlan(process.argv[3]):io?originalBuild.originalAuthSourceCurrentIOBuildPlan(process.platform,process.argv[3],process.argv[4]):walletNativeComponentBuildPlan(mode??'arm64',process.argv[3]);
 for(const {tool,argv} of plan.commands)execFileSync(tool,argv,{stdio:'inherit'});
 if(!io)originalBuild.assertOriginalAuthOwnedSymbols(execFileSync(plan.ownedUndefinedScan.tool,plan.ownedUndefinedScan.argv,{encoding:'utf8'}));
 }
}

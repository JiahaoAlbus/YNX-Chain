// Source preparation only. Original A executes the existing Native build tool.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const here=fileURLToPath(import.meta.url);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=raw=>createHash('sha256').update(raw).digest('hex');
export function verifySDK332R140Source(sourceRoot){
  if(typeof sourceRoot!=='string'||!isAbsolute(sourceRoot)||resolve(sourceRoot)!==sourceRoot)fail('SDK332_R140_ROOT_INVALID');
  const root=realpathSync(sourceRoot);
  const contract=JSON.parse(readFileSync(join(root,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json')));
  const pkg=JSON.parse(readFileSync(join(root,'packages/wallet-auth/package.json')));
  if(contract.version!=='1.3.0-pq.3.32-auth.49'||pkg.version!==contract.version||!isDeepStrictEqual(pkg.exports,contract.publicExports))fail('SDK332_R140_PACKAGE_SELECTION_INVALID');
  // Pure deployment codecs join this canonical Auth line; independent file pins
  // bind the supplier bytes while Native selection requires matching100 user/105 paired inputs.
  const pure=['pq-contract-deployment-transport.js','pq-contract-deployment-transport.d.ts','pq-contract-deployment-transport-node.js','pq-contract-deployment-transport-node.d.ts'].map(n=>'packages/wallet-auth/src/'+n);
  if(!Array.isArray(contract.pureDeploymentInputs)||JSON.stringify(contract.pureDeploymentInputs.map(p=>p.path))!==JSON.stringify(pure))fail('SDK332_R140_DEPLOYMENT_INVENTORY_INVALID');
  if(!Array.isArray(contract.NativeInputs)||contract.NativeInputs.length!==117||!Array.isArray(contract.HelperInputs)||contract.HelperInputs.length!==5)fail('SDK332_R140_NATIVE_INVENTORY_INVALID');
  if(!contract.NativeInputs.some(p=>p.path==='packages/wallet-auth/native/original-ide-service-registration-data.h'))fail('SDK45_SERVICE_DATA_HEADER_REQUIRED');
  if(!contract.NativeInputs.some(p=>p.path==='packages/wallet-auth/native/original-ide-service-registration-data.h'))fail('SDK46_SERVICE_DATA_HEADER_REQUIRED');
  if(!['original-ide-project-app-observer.h','original-ide-project-app-observer-data.h'].every(n=>contract.NativeInputs.some(p=>p.path==='packages/wallet-auth/native/'+n)))fail('SDK47_APP_OBSERVER_HEADERS_REQUIRED');
  const control=["original-ide-project-control-source.inc.mm","original-ide-project-control-capture.mjs","original-ide-project-control-contract.mjs","original-developer-principal-data.mjs","original-ide-publication-approval-contract.mjs","original-ide-project-control-dispatch.mjs","original-ide-publication-approval-dispatch.mjs","original-ide-approval-state-head-data.mjs","original-ide-protected-publisher-contract.mjs","original-ide-protected-publisher-dispatch.mjs"].map(n=>'packages/wallet-auth/native/'+n);
  if(!control.every(p=>contract.NativeInputs.some(pin=>pin.path===p)))fail('SDK332_R140_CONTROL_INVENTORY_INVALID');
  const pqCatalog=['apps/wallet-desktop/native/original-pq-host-catalog-source-owner.inc.mm',...['original-pq-host-catalog-source.h','original-pq-host-catalog-source.mm','original-pq-host-catalog-source-state.h','original-pq-host-catalog-receipt.h','original-pq-host-catalog-source-contract.mjs','original-pq-host-catalog-task-exit.h'].map(n=>'packages/wallet-auth/native/'+n)];
  if(!pqCatalog.every(p=>contract.NativeInputs.some(pin=>pin.path===p)))fail('SDK332_R140_PQ_CATALOG_INVENTORY_INVALID');
  const custody=['original-ide-project-control-custody.h','original-ide-project-control-custody.mm','original-ide-project-control-key-record.h','original-ide-project-control-custody-source.inc.mm','original-ide-project-control-custody-data.mjs'].map(n=>'packages/wallet-auth/native/'+n);
  if(!custody.every(p=>contract.NativeInputs.some(pin=>pin.path===p)))fail('SDK332_R140_CONTROL_CUSTODY_INVENTORY_INVALID');
  const ioPath='packages/wallet-auth/native/original-source-current-dirfd-node.cpp';
  if(!Array.isArray(contract.sourceCurrentIOInputs)||contract.sourceCurrentIOInputs.length!==1||contract.sourceCurrentIOInputs[0].path!==ioPath)fail('SDK332_R140_SOURCE_CURRENT_IO_INVENTORY_INVALID');
  if(contract.require?.translationUnits!==15||contract.require?.helperTranslationUnits!==11||contract.require?.NAPI!==8||contract.require?.minMacOS!=='13.0'||contract.require?.sameSourceBuild!==true||contract.require?.pairedHelperRequired!==true||contract.require?.prebuiltSDK330ModuleAllowed!==false||contract.require?.prebuiltR140ModuleAllowed!==false||!isDeepStrictEqual(contract.require?.frameworks,['Foundation','Security','AppKit','ServiceManagement','LocalAuthentication'])||!isDeepStrictEqual(contract.require?.helperFrameworks,['Foundation','Security','ServiceManagement']))fail('SDK332_R140_NORMAL_REQUIREMENTS_INVALID');
  if(contract.deviceSourceNativeStage?.sourceVariant!=='SDK49-NATIVE-READ-LEASE-ISSUER/v1'||contract.deviceReadLeaseBuildProfile?.translationUnits!==18||contract.deviceReadLeaseBuildProfile?.defaultSelected!==false)fail('SDK49_DEVICE_READ_VARIANT_REQUIRED');
  const seen=new Set();
  for(const pin of [...contract.NativeInputs,...contract.HelperInputs,...contract.pureDeploymentInputs,contract.normalBuildTool,...contract.sourceCurrentIOInputs]){
    if(typeof pin.path!=='string'||isAbsolute(pin.path)||pin.path.includes('\\')||pin.path.split('/').some(p=>!p||p==='.'||p==='..')||!resolve(root,pin.path).startsWith(root+'/')||seen.has(pin.path))fail('SDK332_R140_NATIVE_PATH_INVALID');
    seen.add(pin.path);const file=join(root,pin.path),st=lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink())fail('SDK332_R140_NATIVE_NOT_REGULAR');
    const raw=readFileSync(file);
    if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('SDK332_R140_NATIVE_INPUT_DIFFERS');
  }
  return {root,contract};
}
export async function sdk332R140NativePlan(sourceRoot,headersRoot,arch='arm64'){
  const {root,contract}=verifySDK332R140Source(sourceRoot);
  const tool=join(root,contract.normalBuildTool.path);
  const {originalAuthNativeBuildPlan,originalIDEHelperBuildPlan}=await import(pathToFileURL(tool).href);
  const plan=originalAuthNativeBuildPlan(arch,headersRoot),helperPlan=originalIDEHelperBuildPlan(arch);
  if(plan.sources.length!==15||helperPlan.sources.length!==11||plan.minimumSystemVersion!=='13.0')fail('SDK332_R140_NORMAL_RECIPE_DIFFERS');
  const relayOwner=join(root,'packages/wallet-auth/native/original-ide-contract-relay-owner.mm');
  if(plan.sources.filter(p=>p===relayOwner).length!==1||helperPlan.sources.includes(relayOwner))fail('SDK332_R140_NORMAL_RECIPE_DIFFERS');
  const pqCatalogTU=join(root,'packages/wallet-auth/native/original-pq-host-catalog-source.mm');
  if(plan.sources.filter(p=>p===pqCatalogTU).length!==1||helperPlan.sources.includes(pqCatalogTU))fail('SDK332_R140_NORMAL_RECIPE_DIFFERS');
  const custodyTU=join(root,'packages/wallet-auth/native/original-ide-project-control-custody.mm');
  if(plan.sources.filter(p=>p===custodyTU).length!==1||helperPlan.sources.includes(custodyTU))fail('SDK332_R140_NORMAL_RECIPE_DIFFERS');
  for(const selected of [plan,helperPlan])if(!isDeepStrictEqual(selected.ownedUndefinedScan,{tool:'/usr/bin/nm',argv:['-u',selected.output],rejectPattern:'YNX|ynx'}))fail('SDK332_R140_OWNED_SYMBOL_GUARD_MISSING');
  for(const command of plan.commands.filter(c=>c.tool==='/usr/bin/clang++')){
    for(const flag of ['-DNAPI_VERSION=8','-fobjc-arc','-std=c++17','-lbsm','-mmacosx-version-min=13.0'])if(!command.argv.includes(flag))fail('SDK332_R140_NORMAL_RECIPE_DIFFERS');
    for(const framework of ['Foundation','Security','AppKit','ServiceManagement','LocalAuthentication'])if(!command.argv.some((v,i)=>v==='-framework'&&command.argv[i+1]===framework))fail('SDK332_R140_NORMAL_RECIPE_DIFFERS');
  }
  return {version:contract.version,sourceRoot:root,NativeInputs:contract.NativeInputs,
    HelperInputs:contract.HelperInputs,helperPlan,normalHelperBuildCommand:{tool:process.execPath,argv:[tool,'helper',arch]},normalBuildTool:contract.normalBuildTool,normalBuildCommand:{tool:process.execPath,argv:[tool,arch,headersRoot]},
    plan,rebuildRequired:true,prebuiltSDK330ModuleAllowed:false,prebuiltR140ModuleAllowed:false,pairedBuildRequired:true,contractRelayProducerRequired:true,contractRelayProducerQualified:false,artifactNativeEffectQualified:false,NativeBuild:false,grant:false};
}
if(process.argv[1]&&resolve(process.argv[1])===here){
  if(process.argv.length<3||process.argv.length>4)fail('SDK332_R140_PINNED_HEADERS_REQUIRED');
  console.log(JSON.stringify(await sdk332R140NativePlan(resolve(dirname(here),'../../..'),process.argv[2],process.argv[3]??'arm64'),null,2));
}

/** Explicit original Main-owned device lane. Planning does not compile/load,
 * qualify Source/Root, select real storage, sign or activate a user flow. */
export async function sdk332R140DeviceV4Plan(sourceRoot,headersRoot,protocolRoot,arch='arm64'){
 const defaultLane=await sdk332R140NativePlan(sourceRoot,headersRoot,arch);
 const {root,contract}=verifySDK332R140Source(sourceRoot),tool=join(root,contract.normalBuildTool.path),profile=contract.deviceReadLeaseBuildProfile;
 if(arch!=='arm64'||profile.entry!=='originalAuthDeviceV4BuildPlan'||profile.cppTranslationUnits!==17||profile.cTranslationUnits!==1||profile.helperTranslationUnits!==11||profile.NAPI!==8||profile.minMacOS!=='13.0')fail('SDK49_DEVICE_RECIPE_REQUIRED');
 const {originalAuthDeviceV4BuildPlan}=await import(pathToFileURL(tool).href),plan=originalAuthDeviceV4BuildPlan(arch,headersRoot,protocolRoot);
 if(plan.sources.length!==18||plan.commands.length!==2||plan.intermediateOutputs.length!==1||!plan.deviceV4Stage||plan.nativeAdmission!==false||plan.sourceAdmission!==false)fail('SDK49_DEVICE_RECIPE_DIFFERS');
 const expectedCPP=['original-product-device-v4-factory.mm','original-product-device-v4-slot.mm'].map(n=>join(root,'apps/wallet-desktop/native',n)),e5=join(root,'apps/wallet-desktop/native/product-device-v4-e5.c');
 for(const file of [...expectedCPP,e5])if(plan.sources.filter(p=>p===file).length!==1||defaultLane.helperPlan.sources.includes(file))fail('SDK49_DEVICE_USER_ADDON_ONLY');
 const [c,cpp]=plan.commands;
 if(c.tool!=='/usr/bin/clang'||!c.argv.includes('-std=c11')||!c.argv.includes(e5)||!c.argv.includes('-mmacosx-version-min=13.0')||c.argv.filter(x=>x==='-c').length!==1||cpp.tool!=='/usr/bin/clang++')fail('SDK49_DEVICE_C11_RECIPE_DIFFERS');
 for(const f of ['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_SOURCE_STAGE','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE','-DNAPI_VERSION=8','-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-lbsm','-lresolv'])if(!cpp.argv.includes(f))fail('SDK49_DEVICE_FLAG_REQUIRED');
 for(const lane of [defaultLane.plan,defaultLane.helperPlan])if(lane.commands.some(c=>c.argv.some(a=>a.includes('YNX_ORIGINAL_PRODUCT_DEVICE_V4_'))))fail('SDK49_DEVICE_DEFAULT_OR_HELPER_CHANGED');
 if(!isDeepStrictEqual(plan.ownedUndefinedScan,{tool:'/usr/bin/nm',argv:['-u',plan.output],rejectPattern:'YNX|ynx'}))fail('SDK49_DEVICE_SYMBOL_GUARD_REQUIRED');
 if(plan.protocolInputs.length!==3||profile.protocolInputs.length!==3)fail('SDK49_DEVICE_PROTOCOL_REQUIRED');
 for(let i=0;i<3;i++){const p=plan.protocolInputs[i],pin=profile.protocolInputs[i];if(p.name!==pin.path||p.bytes!==pin.bytes||p.sha256!==pin.sha256||p.path!==join(protocolRoot,p.name))fail('SDK49_DEVICE_PROTOCOL_DIFFERS');}
 if(!cpp.argv.includes(plan.protocolInputs[0].path)||!cpp.argv.includes(plan.intermediateOutputs[0]))fail('SDK49_DEVICE_LINK_RECIPE_REQUIRED');
 return {...defaultLane,plan,defaultPlan:defaultLane.plan,sourceVariant:contract.deviceSourceNativeStage.sourceVariant,deviceV4Profile:profile,protocolInputs:plan.protocolInputs,normalBuildCommand:{tool:process.execPath,argv:[tool,'device-v4',arch,headersRoot,protocolRoot]},compiled:false,loaded:false,actualSourceQualified:false,actualCryptoExecuted:false,installed:false};
}

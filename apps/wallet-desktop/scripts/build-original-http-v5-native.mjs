// Explicit successor of the normal user addon. One frozen Core archive; no
// source/Root qualification is inferred from producing a compiler plan.
import {readFileSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {originalAuthNativeBuildPlan,assertOriginalAuthOwnedSymbols} from './build-original-auth-identity-native.mjs';
import {assertHTTPV5CoreInputs,assertHTTPV5CoreExports} from './wallet-http-v5-core.mjs';
const here=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(here),'../../..');
const regular=file=>{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||realpathSync(file)!==file)throw Error('AUTH_HTTP_V5_REGULAR_SOURCE_REQUIRED');return readFileSync(file);};
export function originalAuthHTTPV5BuildPlan(arch,headers){
 if(arch!=='arm64'||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)throw Error('AUTH_HTTP_V5_BUILD_INPUT_INVALID');
 regular(path.join(headers,'node_api.h'));
 const component=assertHTTPV5CoreInputs(root),base=originalAuthNativeBuildPlan(arch,headers),wallet=path.join(root,'apps/wallet-desktop/native'),sdk=path.join(root,'packages/wallet-auth/native');
 const walletSources=['original-artifact-publisher-store.mm','original-project-control-journal.mm','original-project-control-review.mm','original-product-device-v4-factory.mm','original-product-device-v4-slot.mm','original-product-device-v4-pending-custody.mm','original-product-device-v4-typed-producer.mm','product-device-v4-e5.c','original-product-device-v4-provisioning.mm','original-product-device-v4-association-keychain.mm','original-product-device-v4-core-creator.mm','original-product-device-v4-query-reader.mm','original-product-device-v4-registered-finalization.mm','original-product-device-v5-slot.mm','original-product-device-v5-unsigned.mm','original-product-device-v5-factory.mm'];
 const headersAndIncludes=['original-product-device-v4-source.inc.mm','original-product-device-v4-source-read.inc.mm','original-product-device-v4-http-producer.inc.mm','original-product-device-v4-typed-producer.inc.mm','original-product-device-v4-provisioning-source.inc.mm','original-product-device-v4-query-source.inc.mm','original-device-registered-finalization-source.inc.mm','original-product-device-v5-source-stage.inc.mm','original-product-device-v5-transport.h','original-product-device-v5-transport.inc.mm','original-product-device-v5-factory.h','original-product-device-v5-slot.h','original-product-device-v5-unsigned.h','original-product-device-v5-once.h','original-product-device-v5-http-call.h','ProductSessionDeviceV4.h','product_device_keypair_v4.h','product_session_http.h'];
 const sdkRequired=['original-http-v5-registered-private.h','original-http-v5-registered-private.mm','original-http-v5-source.inc.mm','original-http-v5-acquire.inc.mm','original-http-v5-scope-private.h','original-product-device-v4-registered-finalization-source.inc.mm','original-registered-finalization-scope-private.h'];
 const custody=path.join(wallet,'pq-transaction');
 const custodyInputs=['NativeTransactionCABI.h','NativePQCustody.h','PQBackupNativeDecoder.swift','NativePQCustodyExports.swift','native-wipe.c','tx_batch.h','account_initial.h'];
 const closure=[...headersAndIncludes.map(n=>path.join(wallet,n)),...sdkRequired.map(n=>path.join(sdk,n)),...custodyInputs.map(n=>path.join(custody,n))];
 for(const file of closure)regular(file);
 const entry=regular(base.sources[0]).toString();
 if(!entry.includes('#include "original-product-device-v5-source-stage.inc.mm"')||!entry.includes('RegisterOriginalProductDeviceV5SourceStage(env,exports)'))throw Error('AUTH_HTTP_V5_NORMAL_NAPI_ENTRY_REQUIRED');
 const sources=[...base.sources,...walletSources.map(n=>path.join(wallet,n)),path.join(sdk,'original-http-v5-registered-private.mm')];
 if(new Set(sources).size!==sources.length)throw Error('AUTH_HTTP_V5_DUPLICATE_TRANSLATION_UNIT');
 for(const file of sources)regular(file);
 const seed=base.commands[0].argv,at=seed.indexOf(base.sources[0]);
 if(at<0||base.commands.length!==1)throw Error('AUTH_HTTP_V5_BASE_PLAN_INVALID');
 const flags=seed.slice(0,at).filter(v=>!['-dynamiclib','-undefined','dynamic_lookup'].includes(v));
 const macros=['SOURCE','HTTP_PRODUCER','PENDING','PROVISIONING','QUERY','REGISTERED_FINALIZATION'].map(s=>'-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_'+s+'_STAGE');macros.push('-DYNX_ORIGINAL_PRODUCT_DEVICE_V5_SOURCE_STAGE','-DYNX_ORIGINAL_WALLET_NATIVE_PQ_CUSTODY=1','-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=1','-DYNX_ORIGINAL_WALLET_ARTIFACT_CABI=1','-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL=1','-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI=1');
 const intermediateOutputs=sources.map((_,i)=>path.join(wallet,'original-auth-http-v5.arm64.'+i+'.o'));
 const commands=sources.map((file,i)=>({tool:file.endsWith('.c')?'/usr/bin/clang':'/usr/bin/clang++',argv:file.endsWith('.c')?['-std=c11','-mmacosx-version-min='+base.minimumSystemVersion,'-arch','arm64','-I'+wallet,'-c',file,'-o',intermediateOutputs[i]]:[...flags,...macros,'-I'+wallet,'-c',file,'-o',intermediateOutputs[i]]}));
 const archive=path.join(root,component.inputs.find(p=>p.path.endsWith('.a')).path);
 const wipe=path.join(wallet,'original-auth-http-v5.arm64.wipe.o');intermediateOutputs.push(wipe);
 commands.unshift({tool:'/usr/bin/clang',argv:['-arch','arm64','-mmacosx-version-min='+base.minimumSystemVersion,'-c',path.join(custody,'native-wipe.c'),'-o',wipe]});
 const frameworks=[];for(let i=0;i<at;i++)if(seed[i]==='-framework')frameworks.push('-framework',seed[++i]);
 // Preserve the normal Swift custody runtime and original initial-account
 // exports. The new Core replaces the single historical Go archive operand;
 // never concatenate two independent Go runtimes into this addon.
 commands.push({tool:'/usr/bin/xcrun',argv:['swiftc','-target','arm64-apple-macosx'+base.minimumSystemVersion,'-emit-library','-parse-as-library','-DYNX_ACCOUNT_INITIAL_NATIVE_V1','-Xcc','-DYNX_ACCOUNT_INITIAL_NATIVE_V1','-import-objc-header',path.join(custody,'NativeTransactionCABI.h'),'-I',custody,path.join(custody,'PQBackupNativeDecoder.swift'),path.join(custody,'NativePQCustodyExports.swift'),...intermediateOutputs,archive,...frameworks,'-Xlinker','-lbsm','-Xlinker','-lresolv','-Xlinker','-lc++','-Xlinker','-undefined','-Xlinker','dynamic_lookup','-o',base.output]});
 return {...base,commands,sources,closure,intermediateOutputs,protocolInputs:component.inputs,archiveCount:1,coreSource:component.source,deviceHTTPV5Stage:true,compileOnly:false,linkReady:true,compiled:false,NativeAdmission:false,SourceAdmission:false,RootAdmission:false,AppBuilt:false,installed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){
 if(process.platform!=='darwin')throw Error('AUTH_HTTP_V5_MAC_ONLY');
 if(process.argv.length!==4&&!(process.argv.length===5&&process.argv[4]==='--plan'))throw Error('AUTH_HTTP_V5_BUILD_INPUT_INVALID');
 const plan=originalAuthHTTPV5BuildPlan(process.argv[2],process.argv[3]);
 if(process.argv[4]==='--plan')process.stdout.write(JSON.stringify(plan)+'\n');
 else{
  for(const file of [...plan.outputs,...plan.intermediateOutputs])if(existsSync(file))throw Error('AUTH_HTTP_V5_OUTPUT_EXISTS');
  for(const {tool,argv}of plan.commands)execFileSync(tool,argv,{stdio:'inherit'});
  assertOriginalAuthOwnedSymbols(execFileSync('/usr/bin/nm',['-u',plan.output],{encoding:'utf8'}));
  assertHTTPV5CoreExports(execFileSync('/usr/bin/nm',['-gU',plan.output],{encoding:'utf8'}));
 }
}

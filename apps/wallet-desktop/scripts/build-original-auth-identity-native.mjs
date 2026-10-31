import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=fileURLToPath(import.meta.url),app=path.resolve(path.dirname(here),'..'),repo=path.resolve(app,'../..');
export function assertOriginalAuthOwnedSymbols(undefinedSymbols){
 if(typeof undefinedSymbols!=='string')throw Error('AUTH_NATIVE_OWNED_SYMBOL_SCAN_INVALID');
 // nm -u on a universal Mach-O also emits filename/architecture headings.
 // Inspect symbol rows only; a YNX checkout path is not an undefined symbol.
 const symbols=undefinedSymbols.split(/\r?\n/).flatMap(line=>{
  const symbol=line.match(/^\s*(?:U\s+)?([A-Za-z_$][A-Za-z0-9_$.]*)\s*$/);
  return symbol?[symbol[1]]:[];
 });
 if(symbols.some(symbol=>/YNX|ynx/.test(symbol)))throw Error('AUTH_NATIVE_OWNED_SYMBOL_UNRESOLVED');
}
export function validateOriginalMacMinimumSystemVersion(value){
 if(typeof value!=='string'||!/^[1-9][0-9]*\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))?$/.test(value)||value.length>24)throw Error('AUTH_NATIVE_PACKAGE_MINIMUM_INVALID');
 const parts=value.split('.').map(Number);if(parts.some(n=>!Number.isSafeInteger(n))||parts[0]<11||parts[0]>99||parts.slice(1).some(n=>n>99))throw Error('AUTH_NATIVE_PACKAGE_MINIMUM_INVALID');return value;
}
export function originalAuthNativeBuildPlan(arch,headers){
 if(!['arm64','x64','universal'].includes(arch)||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)throw Error('AUTH_NATIVE_BUILD_INPUT_INVALID');
 const arches=arch==='universal'?['arm64','x64']:[arch],native=path.join(repo,'packages/wallet-auth/native');
 // Same original module: the complete R111 baseline is six translation units.
 const sources=[path.join(app,'native/original-auth-identity-node.mm'),...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm'].map(name=>path.join(native,name))];
 const transport=[path.join(app,'native/original-ide-wallet-identity-source-owner.inc.mm'),...['original-ide-wallet-identity-source.h','original-ide-wallet-identity-source.mm','original-ide-wallet-peer-launch.h','original-ide-wallet-peer-launch.mm'].map(name=>path.join(native,name))];
 const regular=file=>{try{const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('AUTH_NATIVE_SOURCE_NOT_REGULAR');return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 const selected=transport.map(regular),withTransport=selected.some(Boolean);
 if(withTransport&&!selected.every(Boolean))throw Error('AUTH_NATIVE_TRANSPORT_SOURCE_SELECTION_INCOMPLETE');
 if(sources.some(file=>!regular(file)))throw Error('AUTH_NATIVE_BASE_SOURCE_SELECTION_INCOMPLETE');
 // R222 dedicated Source owner is part of this SAME user addon, not helper.
 // Requiring the complete fixed closure prevents a syntax-only binding from
 // shipping with an unresolved native factory or a missing verifier import.
 const pqCatalog=[path.join(app,'native/original-pq-host-catalog-source-owner.inc.mm'),...['original-pq-host-catalog-source.h','original-pq-host-catalog-source.mm','original-pq-host-catalog-source-state.h','original-pq-host-catalog-receipt.h','original-pq-host-catalog-task-exit.h','original-pq-host-catalog-source-contract.mjs'].map(name=>path.join(native,name))];
 if(!pqCatalog.every(regular))throw Error('AUTH_NATIVE_PQ_CATALOG_SOURCE_SELECTION_INCOMPLETE');
 sources.push(path.join(native,'original-pq-host-catalog-source.mm'));
 if(withTransport&&!regular(path.join(native,'original-ide-artifact-result-data.h')))throw Error('AUTH_NATIVE_ARTIFACT_RESULT_SOURCE_SELECTION_INCOMPLETE');
 if(withTransport)sources.push(path.join(native,'original-ide-wallet-identity-source.mm'),path.join(native,'original-ide-wallet-peer-launch.mm'));
 const helperFiles=['original-ide-helper-client.h','original-ide-helper-client.mm','original-ide-helper-xpc-peer.h','original-ide-helper-xpc-peer.mm','original-ide-helper-build-release.h','original-ide-helper-service-contract.h','original-ide-helper-service-install.mm'].map(name=>path.join(native,name));
 const helperSelected=helperFiles.map(regular),withHelper=helperSelected.some(Boolean);
 if(withHelper&&!helperSelected.every(Boolean))throw Error('AUTH_NATIVE_HELPER_SOURCE_SELECTION_INCOMPLETE');
 if(withHelper)sources.push(...['original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm'].map(name=>path.join(native,name)));
 const publication=['original-ide-publication-artifact.h','original-ide-publication-artifact.mm'].map(name=>path.join(native,name));
 if(!publication.every(regular))throw Error('AUTH_NATIVE_PUBLICATION_SOURCE_SELECTION_INCOMPLETE');
 sources.push(publication[1]);
 // Typed carrier and protected-publication constructor live only in this
 // user addon entry, never the root helper or a second translation unit.
 if(!regular(path.join(app,'native/original-ide-publication-artifact-binding.inc.mm')))throw Error('AUTH_NATIVE_PUBLICATION_BINDING_SOURCE_SELECTION_INCOMPLETE');
 // R164 joins this SAME original addon. The Source include is compiled once
 // inside SourceAuthority; the NAPI binding is included once by the Node entry.
 const relay=[path.join(app,'native/original-auth-identity-node.mm'),path.join(app,'native/original-ide-contract-relay-binding.inc.mm'),...['original-auth-identity-source-authority.h','original-auth-identity-source-authority.mm','original-auth-identity-source-v2-verifier.mjs','original-ide-contract-relay-owner.h','original-ide-contract-relay-owner.mm','original-ide-contract-relay-peer.h','original-ide-contract-relay-source.inc.mm','original-ide-contract-relay-launch.h','original-ide-contract-relay-runtime.inc.mm'].map(name=>path.join(native,name))];
 if(!relay.every(regular))throw Error('AUTH_NATIVE_CONTRACT_RELAY_SOURCE_SELECTION_INCOMPLETE');
 sources.push(path.join(native,'original-ide-contract-relay-owner.mm'));
 // R171 getters are private methods in the SAME SourceAuthority unit. Both
 // addon and helper require its typed include closure; no extra TU or Node ABI.
 // R174 private project reader NAPI include belongs only to the user addon.
 if(!regular(path.join(app,'native/original-ide-project-authority-binding.inc.mm')))throw Error('AUTH_NATIVE_PROJECT_AUTHORITY_BINDING_SOURCE_SELECTION_INCOMPLETE');
 // R177 workspace selector is an include of this SAME Node entry, never helper.
 if(!regular(path.join(app,'native/original-ide-workspace-project-selection.inc.mm')))throw Error('AUTH_NATIVE_WORKSPACE_PROJECT_SELECTION_SOURCE_INCOMPLETE');
 const projectAuthority=['original-ide-project-authority-data.h','original-ide-project-authority-source.inc.mm','original-ide-service-registration-data.h','original-ide-project-app-observer.h','original-ide-project-app-observer-data.h'].map(name=>path.join(native,name));
 if(!projectAuthority.every(regular))throw Error('AUTH_NATIVE_PROJECT_AUTHORITY_SOURCE_SELECTION_INCOMPLETE');
 // R196 adds private control capture to SAME SourceAuthority TU and its fixed
 // Node verifier relative closure. None is a new TU or a signing grant.
 const projectControl=["original-ide-project-control-source.inc.mm","original-ide-project-control-capture.mjs","original-ide-project-control-contract.mjs","original-developer-principal-data.mjs","original-ide-publication-approval-contract.mjs","original-ide-project-control-dispatch.mjs","original-ide-publication-approval-dispatch.mjs","original-ide-approval-state-head-data.mjs","original-ide-protected-publisher-contract.mjs","original-ide-protected-publisher-dispatch.mjs"].map(name=>path.join(native,name));
 if(!projectControl.every(regular))throw Error('AUTH_NATIVE_PROJECT_CONTROL_SOURCE_SELECTION_INCOMPLETE');
 // R201 private custody serves the normal Wallet user image only. Helper
 // SourceAuthority shares metadata/current methods but never the Keychain reader.
 const custody=['original-ide-project-control-custody.h','original-ide-project-control-custody.mm','original-ide-project-control-key-record.h','original-ide-project-control-custody-source.inc.mm','original-ide-project-control-custody-data.mjs'].map(name=>path.join(native,name));
 if(!custody.every(regular))throw Error('AUTH_NATIVE_CONTROL_CUSTODY_SOURCE_SELECTION_INCOMPLETE');
 sources.push(path.join(native,'original-ide-project-control-custody.mm'));
 const minimumSystemVersion=validateOriginalMacMinimumSystemVersion(JSON.parse(readFileSync(path.join(app,'package.json'),'utf8'))?.build?.mac?.minimumSystemVersion);
 if(withHelper&&Number(minimumSystemVersion.split('.')[0])<13)throw Error('AUTH_NATIVE_HELPER_MINIMUM_INVALID');
 const output=path.join(app,'native/original-auth-identity.node');
 const commands=arches.map(a=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min='+minimumSystemVersion,'-I'+headers,'-I'+native,'-framework','Foundation','-framework','Security',...(withTransport?['-framework','AppKit']:[]),...(withHelper?['-framework','ServiceManagement']:[]),'-framework','LocalAuthentication','-lbsm','-arch',a==='x64'?'x86_64':a,...sources,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});
 // Client journal IO is part of this same original addon. The separate
 // Auth-current SERVER IO module has an explicit command, never an implicit
 // extra desktop dependency or second application artifact.
 return {commands,output,outputs:[output],sources,minimumSystemVersion,ownedUndefinedScan:{tool:'/usr/bin/nm',argv:['-u',output],rejectPattern:'YNX|ynx'}};
}
// Explicit successor lane only. The default addon and root-helper recipes stay
// unchanged. These pins identify the supplied Darwin/arm64 b0 C ABI, not Source
// qualification, permission to sign, or a cross-platform compiler promise.
export const ORIGINAL_DEVICE_V4_PROTOCOL_PINS=Object.freeze([
 Object.freeze({name:'libynx_artifact_release.a',bytes:10989712,sha256:'614d01481d4ed22ccb0ecede7a1afaaf78196ab6232c093b07ba470f8ecabb67'}),
 Object.freeze({name:'product_session_http.h',bytes:5009,sha256:'4123d8eb6f0814c24c5f94761e8dfaf607561c13e243e327635e4e3785beee25'}),
 Object.freeze({name:'SOURCE.json',bytes:23550,sha256:'925ece95d316a90bfcd4f6e3a4d080a5fd293a0c9bf106588236d0fd900ba850'})
]);
export function originalAuthDeviceV4BuildPlan(arch,headers,protocolRoot){
 if(arch!=='arm64')throw Error('AUTH_DEVICE_V4_ARCHITECTURE_NOT_SUPPLIED');
 if(typeof protocolRoot!=='string'||!path.isAbsolute(protocolRoot)||path.normalize(protocolRoot)!==protocolRoot)throw Error('AUTH_DEVICE_V4_PROTOCOL_ROOT_INVALID');
 // Refuse symlinked input ancestry as well as nonregular leaf operands.
 for(let dir=protocolRoot;;dir=path.dirname(dir)){const stat=lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('AUTH_DEVICE_V4_PROTOCOL_ROOT_INVALID');if(path.dirname(dir)===dir)break;}
 const regular=file=>{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('AUTH_DEVICE_V4_SOURCE_NOT_REGULAR');return readFileSync(file);};
 const protocol=ORIGINAL_DEVICE_V4_PROTOCOL_PINS.map(pin=>{const file=path.join(protocolRoot,pin.name),raw=regular(file);if(raw.length!==pin.bytes||createHash('sha256').update(raw).digest('hex')!==pin.sha256)throw Error('AUTH_DEVICE_V4_PROTOCOL_PIN_DIFFERS');return {...pin,path:file};});
 const base=originalAuthNativeBuildPlan(arch,headers),native=path.join(repo,'packages/wallet-auth/native'),wallet=path.join(app,'native');
 const names=['original-product-device-v4-source.inc.mm','original-product-device-v4-source-read.inc.mm','original-product-device-v4-http-producer.inc.mm','original-product-device-v4-factory.h','original-product-device-v4-factory.mm','original-product-device-v4-slot.h','original-product-device-v4-slot.mm','original-product-device-v4-slot-record.h','original-product-device-v4-http-call.h','ProductSessionDeviceV4.h','product-device-v4-e5.c','product_session_http.h'];
 const inputs=[...names.map(name=>path.join(wallet,name)),...['product-session-device-v4-once.h','product-session-device-v4-once-binding.h'].map(name=>path.join(native,name))];
 for(const file of inputs)regular(file);
 const header=regular(path.join(wallet,'product_session_http.h')),pin=ORIGINAL_DEVICE_V4_PROTOCOL_PINS[1];
 if(header.length!==pin.bytes||createHash('sha256').update(header).digest('hex')!==pin.sha256)throw Error('AUTH_DEVICE_V4_CALLER_HEADER_DIFFERS');
 const e5=path.join(wallet,'product-device-v4-e5.c'),object=path.join(wallet,'original-product-device-v4-e5.arm64.o'),extra=['original-product-device-v4-factory.mm','original-product-device-v4-slot.mm'].map(name=>path.join(wallet,name));
 const compile={tool:'/usr/bin/clang',argv:['-std=c11','-mmacosx-version-min='+base.minimumSystemVersion,'-arch','arm64','-I'+wallet,'-c',e5,'-o',object]};
 const commands=base.commands.map(command=>({tool:command.tool,argv:[...command.argv.slice(0,-2),'-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_SOURCE_STAGE','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE','-I'+wallet,...extra,object,protocol[0].path,'-lresolv',...command.argv.slice(-2)]}));
 return {...base,commands:[compile,...commands],sources:[...base.sources,...extra,e5],intermediateOutputs:[object],deviceV4Inputs:inputs,protocolInputs:protocol,deviceV4Stage:true,nativeAdmission:false,sourceAdmission:false};
}
// Separate pending purpose. Never link the GET/HTTP b0 archive above or use
// dynamic_lookup as a replacement for either owned registration/challenge ABI.
export const ORIGINAL_PENDING_DEVICE_V4_HEADER_PINS=Object.freeze([
 Object.freeze({name:'product_device_registration_v4.h',bytes:5814,sha256:'aa630561ec84d70892e06020bb377dd9c603ce3bc3f7a769fd14fff497010c70'}),
 Object.freeze({name:'product_device_challenge_v4.h',bytes:2673,sha256:'fc4e2d792f52fe259744bfd1920713ee69a58f30bd3f0b7ceeecba09d78b4ef9'})
]);
// Original Protocol same-source macos-15 ABI job 41188462021/1, artifact
// 13037194283, source a59f7673f487e50d3a176bf48293e3647092e2cb.
// Release source pins only, not caller/ENV injection or a Source grant.
export const ORIGINAL_PENDING_DEVICE_V4_LINK_PINS=Object.freeze([
 Object.freeze({name:'libynx_artifact_release.a',bytes:11192240,sha256:'dcaca724942436806f564477f8729cce3ba03cdbc5621611c9d704bb12cf8a72'}),
 Object.freeze({name:'SOURCE.json',bytes:23152,sha256:'0b8df0e0fd73b9cff0ad34118a2de097b6b9ab9cc53b1a1e281ab3462186bd7f'})
]);
export function originalAuthPendingDeviceV4CompilePlan(arch,headers){
 if(arch!=='arm64')throw Error('AUTH_PENDING_DEVICE_V4_ARCHITECTURE_NOT_SUPPLIED');
 const base=originalAuthNativeBuildPlan(arch,headers),wallet=path.join(app,'native'),native=path.join(repo,'packages/wallet-auth/native');
 const regular=file=>{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw Error('AUTH_PENDING_DEVICE_V4_SOURCE_NOT_REGULAR');return readFileSync(file);};
 const closure=['original-product-device-v4-source.inc.mm','original-product-device-v4-source-read.inc.mm','original-product-device-v4-http-producer.inc.mm','original-product-device-v4-factory.h','original-product-device-v4-factory.mm','original-product-device-v4-slot.h','original-product-device-v4-slot.mm','original-product-device-v4-http-call.h','ProductSessionDeviceV4.h','product-device-v4-e5.c','product_session_http.h','original-product-device-v4-typed-producer.inc.mm','original-product-device-v4-typed-producer.h','original-product-device-v4-typed-producer.mm','original-product-device-v4-pending-custody.h','original-product-device-v4-pending-custody.mm','original-product-device-v4-pending-once.h','original-product-device-v4-slot-record.h'].map(n=>path.join(wallet,n));
 closure.push(...['original-product-device-v4-pending-journal.h','original-host-dirfd-journal.h','original-product-device-v4-pending-source-contract.mjs'].map(n=>path.join(native,n)));
 for(const file of closure)regular(file);
 for(const pin of ORIGINAL_PENDING_DEVICE_V4_HEADER_PINS){const b=regular(path.join(wallet,pin.name));if(b.length!==pin.bytes||createHash('sha256').update(b).digest('hex')!==pin.sha256)throw Error('AUTH_PENDING_DEVICE_V4_HEADER_DIFFERS');}
 const httpHeader=regular(path.join(wallet,'product_session_http.h')),httpPin=ORIGINAL_DEVICE_V4_PROTOCOL_PINS[1];if(httpHeader.length!==httpPin.bytes||createHash('sha256').update(httpHeader).digest('hex')!==httpPin.sha256)throw Error('AUTH_PENDING_DEVICE_V4_HTTP_HEADER_DIFFERS');
 const extra=['original-product-device-v4-factory.mm','original-product-device-v4-slot.mm','original-product-device-v4-pending-custody.mm','original-product-device-v4-typed-producer.mm','product-device-v4-e5.c'].map(n=>path.join(wallet,n)),sources=[...base.sources,...extra];
 const objectOutputs=sources.map((_,i)=>path.join(wallet,'original-auth-pending-device-v4.arm64.'+i+'.o'));
 const argv=base.commands[0].argv,at=argv.indexOf(base.sources[0]);if(at<0||base.commands.length!==1)throw Error('AUTH_PENDING_DEVICE_V4_BASE_PLAN_INVALID');
 const flags=argv.slice(0,at).filter(x=>!['-dynamiclib','-undefined','dynamic_lookup'].includes(x));
 const commands=sources.map((file,i)=>file.endsWith('.c')?{tool:'/usr/bin/clang',argv:['-std=c11','-mmacosx-version-min='+base.minimumSystemVersion,'-arch','arm64','-I'+wallet,'-c',file,'-o',objectOutputs[i]]}:{tool:'/usr/bin/clang++',argv:[...flags,'-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_SOURCE_STAGE','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_PENDING_STAGE','-I'+wallet,'-c',file,'-o',objectOutputs[i]]});
 return {...base,commands,sources,outputs:objectOutputs,objectOutputs,closure,headerPins:ORIGINAL_PENDING_DEVICE_V4_HEADER_PINS,compileOnly:true,linkReady:false,deviceV4PendingStage:true,deviceV4HTTPStage:true,nativeAdmission:false,sourceAdmission:false,requiredOwnedExports:['YNXProductSessionHTTPProofSignV4','YNXProductSessionDeviceRegistrationSignV4','YNXProductSessionDeviceChallengeSignV4']};
}
export function originalAuthPendingDeviceV4BuildPlan(arch,headers,protocolRoot){
 if(arch!=='arm64'||typeof headers!=='string'||!path.isAbsolute(headers)||typeof protocolRoot!=='string'||!path.isAbsolute(protocolRoot)||path.normalize(protocolRoot)!==protocolRoot)throw Error('AUTH_PENDING_DEVICE_V4_BUILD_INPUT_INVALID');
 // No compilation, output placement or fallback before a concrete official
 // link contract exists. The actual compile recipe above is independently
 // usable by the normal original build owner; it is not a finished addon.
 if(ORIGINAL_PENDING_DEVICE_V4_LINK_PINS===null)throw Error('AUTH_PENDING_DEVICE_V4_PROTOCOL_ARCHIVE_NOT_SUPPLIED');
 for(let dir=protocolRoot;;dir=path.dirname(dir)){const s=lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink())throw Error('AUTH_PENDING_DEVICE_V4_PROTOCOL_ROOT_INVALID');if(path.dirname(dir)===dir)break;}
 const pins=ORIGINAL_PENDING_DEVICE_V4_LINK_PINS;if(!Array.isArray(pins)||pins.length!==2||pins[0].name!=='libynx_artifact_release.a'||pins[1].name!=='SOURCE.json')throw Error('AUTH_PENDING_DEVICE_V4_LINK_CONTRACT_INVALID');
 const protocolInputs=[...pins,...ORIGINAL_PENDING_DEVICE_V4_HEADER_PINS].map(pin=>{if(!Number.isSafeInteger(pin.bytes)||pin.bytes<1||!/^[a-f0-9]{64}$/.test(pin.sha256))throw Error('AUTH_PENDING_DEVICE_V4_LINK_CONTRACT_INVALID');const file=path.join(protocolRoot,pin.name),s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw Error('AUTH_PENDING_DEVICE_V4_PROTOCOL_NOT_REGULAR');const b=readFileSync(file);if(b.length!==pin.bytes||createHash('sha256').update(b).digest('hex')!==pin.sha256)throw Error('AUTH_PENDING_DEVICE_V4_PROTOCOL_PIN_DIFFERS');return{...pin,path:file};});
 const sourceManifest=JSON.parse(readFileSync(path.join(protocolRoot,'SOURCE.json'),'utf8')),httpSource=sourceManifest.sources?.['cmd/ynx-artifact-release-cabi/product_session_http.h'],httpPin=ORIGINAL_DEVICE_V4_PROTOCOL_PINS[1];if(httpSource?.bytes!==httpPin.bytes||httpSource?.sha256!==httpPin.sha256)throw Error('AUTH_PENDING_DEVICE_V4_OFFICIAL_HTTP_SOURCE_DIFFERS');
 const compile=originalAuthPendingDeviceV4CompilePlan(arch,headers),base=originalAuthNativeBuildPlan(arch,headers),argv=base.commands[0].argv,at=argv.indexOf(base.sources[0]);
 const link={tool:'/usr/bin/clang++',argv:[...argv.slice(0,at),...compile.objectOutputs,protocolInputs[0].path,'-lresolv','-o',base.output]};
 return{...compile,commands:[...compile.commands,link],outputs:[base.output],output:base.output,intermediateOutputs:compile.objectOutputs,protocolInputs,compileOnly:false,linkReady:true,ownedUndefinedScan:base.ownedUndefinedScan,ownedRequiredExportsScan:{tool:'/usr/bin/nm',argv:['-gU',base.output]},nativeAdmission:false,sourceAdmission:false};
}
export function assertOriginalPendingDeviceV4Exports(text){if(typeof text!=='string')throw Error('AUTH_PENDING_DEVICE_V4_EXPORT_SCAN_INVALID');for(const symbol of ['YNXProductSessionHTTPProofSignV4','YNXProductSessionDeviceRegistrationSignV4','YNXProductSessionDeviceChallengeSignV4'])if(!text.split(/\r?\n/).some(line=>new RegExp('\\b[Tt]\\s+_'+symbol+'$').test(line.trim())))throw Error('AUTH_PENDING_DEVICE_V4_EXPORT_MISSING');}
// Explicit same-image successor. OLD a59 recipe/pins remain unchanged above.
export function originalAuthProvisioningDeviceV4BuildPlan(arch,headers,typedRoot,creatorRoot){
 if(arch!=='arm64')throw Error('AUTH_PROVISIONING_ARCH_NOT_SUPPLIED');
 const pins={archive:{name:'libynx_artifact_release.a',bytes:11249400,sha256:'7382ac7d45bfcfa3cecde6cd37bec6befc7322ee878c4cf9f2b02537d7da3253'},typed:{name:'SOURCE.json',bytes:24958,sha256:'a3cbbe28597f7d081f6ed8313a2241fe1e35da2f442f267df290c7e154696196'},creator:{name:'SOURCE.json',bytes:28616,sha256:'755d63b5a7a5ddb67fddd26392f934eb88d3b4c00510effc33800fc84d18e108'},header:{name:'product_device_keypair_v4.h',bytes:5650,sha256:'6028679ecd106de7b92824efd48ec2493f622b2e14191029ae1c82742ba7eed2'}};
 const input=(root,pin)=>{if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root)throw Error('AUTH_PROVISIONING_PROTOCOL_PATH');for(let p=root;;p=path.dirname(p)){const st=lstatSync(p);if(!st.isDirectory()||st.isSymbolicLink())throw Error('AUTH_PROVISIONING_PROTOCOL_PATH');if(path.dirname(p)===p)break;}const p=path.join(root,pin.name),s=lstatSync(p),b=readFileSync(p);if(!s.isFile()||s.isSymbolicLink()||b.length!==pin.bytes||createHash('sha256').update(b).digest('hex')!==pin.sha256)throw Error('AUTH_PROVISIONING_PROTOCOL_PIN');return{...pin,path:p};};
 const protocolInputs=[input(typedRoot,pins.archive),input(typedRoot,pins.typed),input(creatorRoot,pins.archive),input(creatorRoot,pins.creator),input(creatorRoot,pins.header),...ORIGINAL_PENDING_DEVICE_V4_HEADER_PINS.map(p=>input(typedRoot,p))];
 for(const p of[protocolInputs[1],protocolInputs[3]])if(JSON.parse(readFileSync(p.path,'utf8')).commit!=='ecdf8073e9f2b03bbb8e8b8d6e9d1bf28673b6a3')throw Error('AUTH_PROVISIONING_PROTOCOL_SOURCE');
 const c=originalAuthPendingDeviceV4CompilePlan(arch,headers),wallet=path.join(app,'native'),native=path.join(repo,'packages/wallet-auth/native'),extra=['original-product-device-v4-provisioning.mm','original-product-device-v4-association-keychain.mm','original-product-device-v4-core-creator.mm'].map(n=>path.join(wallet,n));
 for(const f of[...extra,path.join(wallet,'original-product-device-v4-provisioning-source.inc.mm'),path.join(wallet,'original-product-device-v4-provisioning.h'),path.join(native,'original-product-device-v4-provisioning-journal.h')]){const s=lstatSync(f);if(!s.isFile()||s.isSymbolicLink())throw Error('AUTH_PROVISIONING_SOURCE_INCOMPLETE');}
 const b=readFileSync(path.join(wallet,pins.header.name));if(b.length!==pins.header.bytes||createHash('sha256').update(b).digest('hex')!==pins.header.sha256)throw Error('AUTH_PROVISIONING_CALLER_HEADER_DIFFERS');
 const macro='-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_PROVISIONING_STAGE',commands=c.commands.map(x=>({tool:x.tool,argv:x.tool==='/usr/bin/clang++'?[macro,...x.argv]:x.argv})),flags=[macro,...c.commands.find(x=>x.tool==='/usr/bin/clang++').argv.slice(0,c.commands[0].argv.indexOf('-c'))];
 const objects=extra.map((_,i)=>path.join(wallet,'original-auth-provisioning-device-v4.arm64.'+i+'.o'));for(let i=0;i<extra.length;i++)commands.push({tool:'/usr/bin/clang++',argv:[...flags,'-I'+creatorRoot,'-c',extra[i],'-o',objects[i]]});
 const base=originalAuthNativeBuildPlan(arch,headers),linkArgv=base.commands[0].argv,at=linkArgv.indexOf(base.sources[0]);commands.push({tool:'/usr/bin/clang++',argv:[...linkArgv.slice(0,at),...c.objectOutputs,...objects,protocolInputs[0].path,'-lresolv','-o',base.output]});
 return{...c,commands,output:base.output,outputs:[base.output],sources:[...c.sources,...extra],intermediateOutputs:[...c.objectOutputs,...objects],compileOnly:false,linkReady:true,protocolInputs,archiveCount:1,deviceV4ProvisioningStage:true,ownedUndefinedScan:base.ownedUndefinedScan,ownedRequiredExportsScan:{tool:'/usr/bin/nm',argv:['-gU',base.output]},requiredOwnedExports:[...c.requiredOwnedExports,'YNXProductSessionDeviceKeypairGenerateV4'],sourceAdmission:false,nativeAdmission:false};
}
// Same ecdf single-archive image. Add only read-only query Source/reader TU;
// never replace the original 23-TU provider closure or relax owned exports.
export function originalAuthQueryDeviceV4BuildPlan(arch,headers,typedRoot,creatorRoot){
 const parent=originalAuthProvisioningDeviceV4BuildPlan(arch,headers,typedRoot,creatorRoot),wallet=path.join(app,'native');
 const required=['original-product-device-v4-query-reader.mm','original-product-device-v4-query-reader.h','original-product-device-v4-query-source.inc.mm','original-product-device-v4-query-composition.inc.mm'];
 for(const name of required){const s=lstatSync(path.join(wallet,name));if(!s.isFile()||s.isSymbolicLink())throw Error('AUTH_QUERY_DEVICE_V4_SOURCE_REQUIRED');}
 const compile=parent.commands.slice(0,-1).map(c=>({tool:c.tool,argv:c.tool==='/usr/bin/clang++'?['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_QUERY_STAGE',...c.argv]:c.argv}));
 const seed=compile.find(c=>c.tool==='/usr/bin/clang++'),flags=seed.argv.slice(0,seed.argv.indexOf('-c')),reader=path.join(wallet,required[0]),object=path.join(wallet,'original-auth-query-device-v4.arm64.reader.o');
 compile.push({tool:'/usr/bin/clang++',argv:[...flags,'-c',reader,'-o',object]});
 const link=parent.commands.at(-1),at=link.argv.lastIndexOf('-o');if(at<0)throw Error('AUTH_QUERY_PARENT_LINK');
 compile.push({tool:link.tool,argv:[...link.argv.slice(0,at),object,...link.argv.slice(at)]});
 return{...parent,commands:compile,sources:[...parent.sources,reader],intermediateOutputs:[...parent.intermediateOutputs,object],deviceV4QueryStage:true,nullableIdentityABI:2,archiveCount:1};
}
// Source-only normal helper executable recipe. No install, signing, Root row
// or system approval is performed by constructing or executing this compiler.
export function originalIDEHelperBuildPlan(arch){
 if(!['arm64','x64','universal'].includes(arch))throw Error('AUTH_NATIVE_HELPER_BUILD_INPUT_INVALID');
 const arches=arch==='universal'?['arm64','x64']:[arch],native=path.join(repo,'packages/wallet-auth/native');
 const sources=[path.join(repo,'apps/developer/helper/main.mm'),...['original-ide-helper-listener.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-kernel.mm','original-ide-parent-source-binding.mm'].map(n=>path.join(native,n)),path.join(app,'native/original-ide-auth-request-source.inc.mm'),path.join(native,'original-ide-helper-client.mm'),path.join(native,'original-ide-publication-artifact.mm')];
 const headers=['original-ide-helper-listener.h','original-ide-helper-effect-contract.h','original-ide-helper-client.h','original-ide-helper-xpc-peer.h','original-ide-helper-service-contract.h','original-ide-helper-build-release.h','original-ide-publication-artifact.h','original-auth-identity-source-authority.h','original-auth-identity-source-v2-verifier.mjs','original-ide-contract-relay-source.inc.mm','original-ide-contract-relay-launch.h','original-ide-contract-relay-runtime.inc.mm','original-ide-project-authority-data.h','original-ide-project-authority-source.inc.mm','original-ide-service-registration-data.h','original-ide-project-app-observer.h','original-ide-project-app-observer-data.h',"original-ide-project-control-source.inc.mm","original-ide-project-control-capture.mjs","original-ide-project-control-contract.mjs","original-developer-principal-data.mjs","original-ide-publication-approval-contract.mjs","original-ide-project-control-dispatch.mjs","original-ide-publication-approval-dispatch.mjs","original-ide-approval-state-head-data.mjs","original-ide-protected-publisher-contract.mjs","original-ide-protected-publisher-dispatch.mjs","original-ide-project-control-custody-source.inc.mm","original-ide-project-control-custody-data.mjs"].map(n=>path.join(native,n));
 for(const file of [...sources,...headers]){let st;try{st=lstatSync(file);}catch{throw Error('AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE');}if(!st.isFile()||st.isSymbolicLink())throw Error('AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE');}
 const output=path.join(repo,'apps/developer/helper/YNXIdentityReceiver'),minimumSystemVersion='13.0';
 const commands=arches.map(a=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-I'+native,'-framework','Foundation','-framework','Security','-framework','ServiceManagement','-lbsm','-arch',a==='x64'?'x86_64':a,...sources,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});
 return {commands,output,outputs:[output],sources,minimumSystemVersion,ownedUndefinedScan:{tool:'/usr/bin/nm',argv:['-u',output],rejectPattern:'YNX|ynx'}};
}
export function originalAuthSourceCurrentIOBuildPlan(platform,arch,headers){
 if(!['darwin','linux'].includes(platform)||!['arm64','x64','universal'].includes(arch)||platform==='linux'&&arch==='universal'||typeof headers!=='string'||!path.isAbsolute(headers)||path.normalize(headers)!==headers)throw Error('AUTH_SOURCE_CURRENT_IO_BUILD_INPUT_INVALID');
 const source=path.join(repo,'packages/wallet-auth/native/original-source-current-dirfd-node.cpp'),output=path.join(app,'native/original-source-current-dirfd.node'),arches=arch==='universal'?['arm64','x64']:[arch];
 // R185 explicit server IO is a separate one-TU artifact, never addon/helper.
 if(![source,path.join(repo,'packages/wallet-auth/native/original-host-dirfd-journal.h')].every(file=>{try{const s=lstatSync(file);return s.isFile()&&!s.isSymbolicLink();}catch{return false;}}))throw Error('AUTH_SOURCE_CURRENT_IO_SOURCE_SELECTION_INCOMPLETE');
 const commands=arches.map(a=>({tool:platform==='darwin'?'/usr/bin/clang++':'/usr/bin/c++',argv:['-std=c++17',...(platform==='darwin'?['-dynamiclib','-undefined','dynamic_lookup','-arch',a==='x64'?'x86_64':a]:['-shared','-fPIC']),'-DNAPI_VERSION=8','-I'+headers,source,'-o',arches.length===1?output:output+'.'+a]}));
 if(arches.length===2)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});return {commands,output,source};
}
export function assertOriginalProvisioningDeviceV4Exports(text){
 assertOriginalPendingDeviceV4Exports(text);
 if(!text.split(/\r?\n/).some(line=>/\b[Tt]\s+_YNXProductSessionDeviceKeypairGenerateV4$/.test(line.trim())))throw Error('AUTH_PROVISIONING_DEVICE_V4_EXPORT_MISSING');
}
if(process.argv[1]&&path.resolve(process.argv[1])===here){
 const queryV4=process.argv[2]==='device-v4-query',provisioningV4=process.argv[2]==='device-v4-provisioning',pendingV4=process.argv[2]==='device-v4-pending',deviceV4=process.argv[2]==='device-v4',helperOnly=process.argv[2]==='helper',ioOnly=process.argv[2]==='source-current-io',headers=ioOnly||deviceV4||pendingV4||provisioningV4||queryV4?process.argv[4]:process.argv[3];
 if(!ioOnly&&process.platform!=='darwin')throw Error('AUTH_NATIVE_MAC_ONLY');
 if(ioOnly&&process.platform==='linux'&&process.argv[3]!==process.arch)throw Error('AUTH_SOURCE_CURRENT_IO_CROSS_COMPILER_NOT_SUPPLIED');
 if(helperOnly&&process.argv.length!==4)throw Error('AUTH_NATIVE_HELPER_BUILD_INPUT_INVALID');
 if(deviceV4&&process.argv.length!==6)throw Error('AUTH_DEVICE_V4_BUILD_INPUT_INVALID');
 if(pendingV4&&process.argv.length!==6)throw Error('AUTH_PENDING_DEVICE_V4_BUILD_INPUT_INVALID');
 const planOnly=(provisioningV4||queryV4)&&process.argv.length===8&&process.argv[7]==='--plan';
 if((provisioningV4||queryV4)&&process.argv.length!==7&&!planOnly)throw Error(queryV4?'AUTH_QUERY_DEVICE_V4_BUILD_INPUT_INVALID':'AUTH_PROVISIONING_DEVICE_V4_BUILD_INPUT_INVALID');
 const plan=queryV4?originalAuthQueryDeviceV4BuildPlan(process.argv[3],headers,process.argv[5],process.argv[6]):provisioningV4?originalAuthProvisioningDeviceV4BuildPlan(process.argv[3],headers,process.argv[5],process.argv[6]):pendingV4?originalAuthPendingDeviceV4BuildPlan(process.argv[3],headers,process.argv[5]):deviceV4?originalAuthDeviceV4BuildPlan(process.argv[3],headers,process.argv[5]):helperOnly?originalIDEHelperBuildPlan(process.argv[3]):ioOnly?originalAuthSourceCurrentIOBuildPlan(process.platform,process.argv[3],headers):originalAuthNativeBuildPlan(process.argv[2]??'arm64',headers);
 if(!helperOnly&&!existsSync(path.join(headers,'node_api.h')))throw Error('AUTH_NATIVE_PINNED_HEADERS_REQUIRED');
 if(deviceV4||pendingV4||provisioningV4||queryV4)for(const file of [...plan.outputs,...plan.intermediateOutputs])if(existsSync(file))throw Error('AUTH_DEVICE_V4_OUTPUT_EXISTS');
 // Explicit local headers only; opt-in device-v4 also binds its supplied local
 // official archive. No download, fallback library or hidden build.
 if(planOnly){process.stdout.write(JSON.stringify(plan)+'\n');}else{
 for(const {tool,argv} of plan.commands)execFileSync(tool,argv,{stdio:'inherit'});
 // Node's dynamic_lookup may resolve NAPI at load time, never our own parser,
 // classes or namespace symbols. Check the actual final binary before release.
 if(!ioOnly)assertOriginalAuthOwnedSymbols(execFileSync(plan.ownedUndefinedScan.tool,plan.ownedUndefinedScan.argv,{encoding:'utf8'}));
 if(pendingV4)assertOriginalPendingDeviceV4Exports(execFileSync(plan.ownedRequiredExportsScan.tool,plan.ownedRequiredExportsScan.argv,{encoding:'utf8'}));
 if(provisioningV4||queryV4)assertOriginalProvisioningDeviceV4Exports(execFileSync(plan.ownedRequiredExportsScan.tool,plan.ownedRequiredExportsScan.argv,{encoding:'utf8'}));
 }
}

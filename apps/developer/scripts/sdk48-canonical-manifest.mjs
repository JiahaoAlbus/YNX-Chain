import {readFile,lstat,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=m=>{throw Error('SDK48 canonical manifest '+m);};
async function pinned(pin){const st=await lstat(pin.path),raw=await readFile(pin.path);if(!st.isFile()||st.isSymbolicLink()||raw.length!==pin.bytes||sha(raw)!==pin.sha256)fail('supplier bytes differ');return raw;}
const pin=p=>({path:p.path,bytes:p.bytes,sha256:p.sha256});
const alias=(p,destination)=>({...pin(p),destination});
function rowsMap(rows){const m=new Map();for(const r of rows){if(typeof r.path!=='string'||r.path.startsWith('/')||r.path.includes('\\')||r.path.split('/').some(x=>!x||x==='.'||x==='..')||m.has(r.path)||!Number.isSafeInteger(r.bytes)||r.bytes<0||!/^[a-f0-9]{64}$/.test(r.sha256))fail('unsafe or duplicate row');m.set(r.path,r);}return m;}
export function validateSDK48RuntimeProjection({inventory,selection,policy,receipt,fullAuth,fullUnion,productAuth,productUnion}){
 const all=rowsMap(inventory.files),product=rowsMap(selection.files),excluded=rowsMap(policy.excluded);
 if(all.size!==9590||product.size!==9575||excluded.size!==15||policy.count!==15)fail('projection counts differ');
 const same=(a,b)=>a&&b&&a.bytes===b.bytes&&a.sha256===b.sha256;
 for(const [path,r]of all)if(excluded.has(path)?product.has(path)||!same(r,excluded.get(path)):!same(r,product.get(path)))fail('finite projection differs');
 for(const [path,r]of excluded)if(!same(r,all.get(path)))fail('excluded row differs');
 if(receipt.kind!=='YNX_SDK48_PRODUCT_RUNTIME_METADATA_PROJECTION/v1'||receipt.commit!=='632af166d0b374c618bb226f63aefdcba223247c'||receipt.versionSDK!=='1.3.0-pq.3.32-auth.48'||receipt.fullPrefixFiles!==9590||receipt.excludedFiles!==15||receipt.ASTSources!==204||receipt.literalEdges!==683||receipt.generatedRawCanonicalNoLF!==true||receipt.NativeInputs!==102||receipt.HelperInputs!==5||['SourceQualified','NativeModuleBuilt','installed','published'].some(k=>receipt[k]!==false))fail('projection receipt differs');
 for(const [runtime,expected,allowed]of [[fullAuth,574,all],[fullUnion,9434,all],[productAuth,564,product],[productUnion,9425,product]]){
  if(runtime.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||runtime.files.length!==expected)fail('runtime count differs');
  for(const [path,r]of rowsMap(runtime.files))if(!same(r,allowed.get(path)))fail('runtime escaped exact source selection');
 }
 return {NativeAdmission:false,SourceAdmission:false};
}
export async function createSDK48CanonicalManifest({requestPath,previousInputs,outputPath}){
 const request=JSON.parse(await readFile(requestPath));
 if(request.schema!=='YNX_IDE_CANONICAL_SDK48_SOURCE_REQUEST/v1'||request.sdkCommit!=='632af166d0b374c618bb226f63aefdcba223247c'||request.supplier.bytes!==18068||request.supplier.sha256!=='6253966324bd0f64c68ef6f4f35c26f608ff95ce711f1657683b74845fe98b26'||request.nativeComponent!==null||request.helperComponent!==null||request.requiredBuild.normalPlans!==null||request.requiredBuild.normalPlanSourceRoot!==null)fail('source-only request differs');
 const h=JSON.parse(await pinned(request.supplier)),oldRaw=await readFile(previousInputs);
 if(sha(oldRaw)!=='6c8b33efc832f4deccc2974657f300cb8e26e84167a5d84d0dc11413cfbf6971')fail('predecessor differs');
 const old=JSON.parse(oldRaw),product=h.runtime.product;
 const refs=[h.normalPrefix.inventory,product.selection,product.finitePolicy,product.projectionReceipt,h.runtime.Auth,h.runtime.union,product.Auth,product.union];
 const [inventory,selection,policy,receipt,fullAuth,fullUnion,productAuth,productUnion]=await Promise.all(refs.map(async p=>JSON.parse(await pinned(p))));
 validateSDK48RuntimeProjection({inventory,selection,policy,receipt,fullAuth,fullUnion,productAuth,productUnion});
 const files=inventory.files.filter(p=>!p.path.startsWith('node_modules/'));
 const generated=[alias(product.Auth,'native/original-ide-auth-runtime-manifest.json'),alias(product.union,'native/original-ide-contract-relay-runtime-manifest.json')].map(p=>({...p,source:'runtime-projections/sdk48-product/'+p.destination.slice('native/'.length)}));
 const fullGenerated=[alias(h.runtime.Auth,generated[0].destination),alias(h.runtime.union,generated[1].destination)];
 const fullFiles=[...files,...fullGenerated.map(p=>({path:p.destination,bytes:p.bytes,sha256:p.sha256}))];
 const productFiles=[...selection.files.filter(p=>!p.path.startsWith('node_modules/')),...generated.map(p=>({path:p.destination,bytes:p.bytes,sha256:p.sha256}))];
 if(fullFiles.length!==415||productFiles.length!==400)fail('SDK source alias counts differ');
 const executor=fullUnion.files.find(p=>p.path==='src/walletconnect-contract-initiator-boundary.js');
 if(!executor)fail('original relay executor omitted');
 // Recheck each materialized source against the signed supplier DATA selection.
 for(const row of fullFiles)await pinned({...row,path:join(request.sourceRoot,'packages/wallet-auth',row.path)});
 const compat=JSON.parse(await pinned(h.sourceRoles.canonicalInventory));
 const supplied=[...compat.NativeInputs,...compat.HelperInputs,...compat.pureDeploymentInputs,compat.normalBuildTool];
 const suppliedPaths=new Set(supplied.map(r=>r.path));
 const nativeExpected=[...supplied.map(r=>({...r,sourceOwner:'sdk'})),...old.nativeSources.filter(r=>!suppliedPaths.has(r.path))],nativeMap=rowsMap(nativeExpected);
 const exactRoles=(actual,expected)=>{const m=rowsMap(actual);if(m.size!==expected.length)fail('request source roles differ');for(const r of expected){const a=m.get(r.path);if(!a||a.bytes!==r.bytes||a.sha256!==r.sha256||a.sourceOwner!==r.sourceOwner)fail('request source role bytes differ');}};
 exactRoles(request.nativeSources,nativeExpected);
 const expectedBuild=[...compat.NativeInputs,...old.nativeBuildInputs.filter(r=>!suppliedPaths.has(r.path))];
 exactRoles(request.nativeBuildInputs,expectedBuild);
 exactRoles(request.requiredBuild.helperInputs,[...compat.NativeInputs,...compat.HelperInputs]);
 const expectedDependencies=inventory.files.filter(r=>r.path.startsWith('node_modules/')).map(r=>({...r,path:r.path.slice(13)}));
 exactRoles(request.dependencies,expectedDependencies);
 if(nativeMap.size!==127||request.nativeBuildInputs.length!==115||request.requiredBuild.helperInputs.length!==107)fail('native role cardinality differs');
 for(const row of nativeExpected)await pinned({...row,path:join(request.sourceRoot,row.path)});
 const auth=p=>({files:p===h.runtime.Auth?574:564,manifest:alias(p,generated[0].destination)});
 const relay=(p,count)=>({files:count,totalBytes:(p===h.runtime.union?fullUnion:productUnion).files.reduce((n,r)=>n+r.bytes,0),manifest:alias(p,generated[1].destination),executor,nativeQualified:false,registrationAccepted:false});
 const record={
 schemaVersion:1,status:'SDK48_SOURCE_READY_MATCHING_EXECUTED_COMPONENT_REQUIRED',sourceOnly:true,
 sdkVersion:h.versionSDK,sdkCommit:h.sourceCommit,sdkTree:h.repositoryRootTree,
 predecessorManifestSha256:sha(oldRaw),supplier:request.supplier,roots:{source:request.sourceRoot,sdk:join(request.sourceRoot,'packages/wallet-auth'),native:request.sourceRoot},
 files:fullFiles,dependencies:request.dependencies,nativeSources:nativeExpected,nativeBuildInputs:request.nativeBuildInputs,
 node22HeaderPins:old.node22HeaderPins,requiredBuild:request.requiredBuild,nativeComponent:null,helperComponent:null,
 nativeBuildQualification:null,
 runtimeClosure:{Auth:auth(h.runtime.Auth),WalletConnect:{...old.runtimeClosure.WalletConnect,manifest:h.runtime.WalletConnect},contractRelay:relay(h.runtime.union,9434)},
 buildOnlySDKFiles:policy.excluded,productProjection:{selectionFiles:9575,authFiles:564,unionFiles:9425,files:productFiles,generated,Auth:auth(product.Auth),contractRelay:relay(product.union,9425),NativeAdmission:false,SourceAdmission:false,receipt:product.projectionReceipt,finitePolicy:product.finitePolicy},
 sdk48SupplierContract:h,remaining:['matching SDK48 original executed Native and Helper components','original App build and native user acceptance'],
 canonicalRuntimeSerialization:old.canonicalRuntimeSerialization
 };
 const repository=resolve(dirname(outputPath),'../../..');
 for(const p of generated){
  const raw=await pinned(p),target=join(repository,p.source);
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  try{await lstat(target);await pinned({...p,path:target});}
  catch(error){if(error.code!=='ENOENT')throw error;await writeFile(target,raw,{flag:'wx',mode:0o644});}
 }
 await writeFile(outputPath,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o644});
 return {path:outputPath,sourceFiles:415,productSourceFiles:400,NativeAdmission:false,SourceAdmission:false,packaged:false};
}


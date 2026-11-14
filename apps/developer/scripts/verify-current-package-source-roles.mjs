import {readFile,lstat,realpath} from 'node:fs/promises';import {createHash} from 'node:crypto';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {currentSourceProjectionInput,readProjectionPin} from './current-source-projection-input.mjs';
import {pathToFileURL} from 'node:url';
import {assertPackageSourceRoles} from './package-source-roles.mjs';
import {assertBuildOutputDirectory} from './build-output-root.mjs';
const supplier='/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-runtime-source-projection-successor-20261101/CURRENT_PACKAGE_SOURCE_ROLES.json';
const ownRoot=fileURLToPath(new URL('../../../',import.meta.url));
async function pinned(path,expected){const s=await lstat(path),b=await readFile(path);if(!s.isFile()||s.isSymbolicLink()||await realpath(path)!==path||b.length!==expected.bytes||createHash('sha256').update(b).digest('hex')!==expected.sha256)throw Error('Current package source role pin differs: '+path);return b;}
export async function verifyCurrentPackageSourceRoles(app,applicationCommit,applicationTree){
 if(resolve(app)!==app||await realpath(app)!==app)throw Error('Canonical current candidate required');await assertBuildOutputDirectory(app);
 const candidatePlan=JSON.parse(await readFile(join(app,'Contents/Resources/native-link/plan.json')));
 if(['R21_COCOA_SUCCESSOR_NORMAL_PRODUCT','R22_COCOA_SUCCESSOR_NORMAL_PRODUCT','R23_COCOA_SUCCESSOR_NORMAL_PRODUCT','R579_COCOA_SUCCESSOR_NORMAL_PRODUCT'].includes(candidatePlan.variant)){
  const {r21SourceRoles}=await import('./r21-cocoa-product.mjs');return r21SourceRoles(app,applicationCommit,applicationTree,candidatePlan.variant);
 }
 if(candidatePlan.variant==='C6_DIAGNOSTIC_NORMAL_PRODUCT'){
  const {c6SourceRoles}=await import('./c6-diagnostic-product.mjs');return c6SourceRoles(app,applicationCommit,applicationTree);
 }
 if(candidatePlan.variant==='ROOT63_RESOURCE8'){
  const {root63SourceRoles}=await import('./root63-product.mjs');return root63SourceRoles(app,applicationCommit,applicationTree);
 }
 const supply=await currentSourceProjectionInput();
 const raw=await pinned(supplier,{bytes:2913,sha256:'b81c0bf2c76805750755c117056288a926f6a6f88e86484f88e7d6d1ccac20ff'}),ledger=JSON.parse(raw);
 if(ledger.schema!=='YNX_IDE_CURRENT_PACKAGE_SOURCE_ROLES/v1'||ledger.completeAssemblyReceipt!==false||ledger.rewriteHistoricalDistributionSourceCommit!==false||ledger.RootAdmission!==false||ledger.SourceAdmission!==false||ledger.NativeAdmission!==false)throw Error('Exact finite source role contract required');
 for(const key of ['originalPartialAssemblyH','originalNativePlan','originalNativeExecution','originalNativeDistribution','projection','runtimeInventory','projectionIO'])await pinned(ledger[key].path,ledger[key]);
 const moduleRow=supply.source.rows.find(r=>r.path==='packages/wallet-auth/scripts/ide-current-package-source-roles.mjs');if(!moduleRow)throw Error('Original source-role callee missing');
 const modulePath=join(supply.root,'source',moduleRow.path);await readProjectionPin({path:modulePath,...moduleRow.after});
 const callee=await import(pathToFileURL(modulePath).href),originals={};for(const [key,name]of Object.entries({partialH:'originalPartialAssemblyH',nativePlan:'originalNativePlan',nativeExecution:'originalNativeExecution',nativeDistribution:'originalNativeDistribution',projection:'projection',runtimeInventory:'runtimeInventory',projectionIO:'projectionIO'}))originals[key]=await pinned(ledger[name].path,ledger[name]);
 const data=callee.inspectIDECurrentPackageSourceRolesDATA(raw,{bytes:2913,sha256:'b81c0bf2c76805750755c117056288a926f6a6f88e86484f88e7d6d1ccac20ff'},originals);if(data.historicalMetadataUnchanged!==true||data.completeAssemblyReceipt!==false)throw Error('Original source-role DATA rejected');
 const resources=join(app,'Contents/Resources'),developer=join(resources,'code/apps/developer');
 const plan=JSON.parse(await pinned(join(resources,'native-link/plan.json'),ledger.originalNativePlan));
 await pinned(join(resources,'native-link/execution.json'),ledger.originalNativeExecution);
 const nativeLink=JSON.parse(await pinned(join(resources,'native-link/distribution.json'),ledger.originalNativeDistribution));
 await pinned(join(developer,'identity-sdk-source-projection.json'),ledger.projection);
 await pinned(join(developer,'identity-sdk-projected-runtime-inventory.json'),ledger.runtimeInventory);
 await pinned(join(developer,'vendor/identity-admission/scripts/ide-runtime-source-projection.mjs'),ledger.projectionIO);
 const callerHPath=join(ownRoot,'../current-product-projection-loader-variant-20261101/HANDOFF.json');
 const callerH=JSON.parse(await pinned(callerHPath,{bytes:3203,sha256:'bcd00402fa7014ccdf33deda5325c286d284a057cb2dac0f4bd3a4fb324b9f7a'})),caller=callerH.files.find(r=>r.relativePath==='apps/developer/desktop/identity-sdk-loader.mjs');
 await pinned(caller.path,caller);await pinned(join(developer,'desktop/identity-sdk-loader.mjs'),caller);
 const original=JSON.parse(await readFile(join(ownRoot,'../current-product-consumer-sdk-loader-delta-20261101/ABI_DELTA.json')));
 let verified=0;for(const row of original.currentConsumerRecords){if(row.relativePath===caller.relativePath)continue;await pinned(join(ownRoot,row.relativePath),row);verified++;}
 const git=argv=>execFileSync('/usr/bin/git',argv,{cwd:ownRoot,encoding:'utf8'}).trim();
 if(git(['rev-parse','HEAD'])!==applicationCommit||git(['rev-parse','HEAD^{tree}'])!==applicationTree||git(['status','--porcelain','--untracked-files=no']))throw Error('Clean exact current producer required');
 execFileSync('/usr/bin/git',['merge-base','--is-ancestor',ledger.packOrderProducerSource,applicationCommit],{cwd:ownRoot,stdio:'pipe'});
 const bindingRaw=await readFile(join(developer,'identity-sdk-projection-binding.json')),binding=JSON.parse(bindingRaw);
 if(binding.schema!=='YNX_IDE_SDK_PROJECTION_BINDING/v1'||binding.sourceVariant!==ledger.sourceVariant||binding.projection?.sha256!==ledger.projection.sha256||binding.projection?.bytes!==ledger.projection.bytes||binding.runtimeInventory?.sha256!==ledger.runtimeInventory.sha256||binding.runtimeInventory?.bytes!==ledger.runtimeInventory.bytes)throw Error('Projection is not independently bound to exact supplier inputs');
 const roles={schema:ledger.schema,sourceVariant:ledger.sourceVariant,applicationSourceCommit:applicationCommit,applicationSourceTree:applicationTree,assembledSourceCommit:ledger.baseAssemblyProducer,compiledNativeSourceCommit:ledger.compiledNativeSource,consumerVariantSourceCommit:ledger.runtimeCallerSource,SDKResourceSourceCommit:ledger.SDKResourceSource,originalPlanSHA256:ledger.originalNativePlan.sha256,originalExecutionSHA256:ledger.originalNativeExecution.sha256,consumerVariantSHA256:caller.sha256,projectionSHA256:ledger.projection.sha256};
 return {...assertPackageSourceRoles({roles,expected:{...roles,consumerVariantVerified:true,otherConsumerLeavesVerified:verified,projectionBindingVerified:true},nativeLink,nativePlan:plan,applicationCommit,applicationTree}),supplierRoleContract:{bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')},packOrderProducerSource:ledger.packOrderProducerSource,artifactOnly:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length!==5)throw Error('Exact current App, producer commit and tree required');console.log(JSON.stringify(await verifyCurrentPackageSourceRoles(...process.argv.slice(2))));}

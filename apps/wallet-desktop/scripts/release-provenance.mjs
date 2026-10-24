import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, lstatSync, mkdtempSync, renameSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { Readable } from "node:stream";
import {canonicalArchivePlan,canonicalPackedPath,canonicalSourcePath,CANONICAL_MAIN,CANONICAL_APP_METADATA,NATIVE_CANONICAL,NATIVE_RECEIPT,SDK_ALIAS,verifyCanonicalNativeReceipt,canonicalNativeInputSelection,SDK332_NATIVE_INVENTORY,CANONICAL_NATIVE_EVIDENCE_TESTS,isCanonicalNativeSourceAsset} from './canonical-package.mjs';
import {walletAuthDependencyPlan,verifyPackagedWalletAuthDependencies} from './wallet-auth-dependencies.mjs';
import {verifyOriginalR155Component,verifyOriginalR155HelperBundle,R155_INTAKE_ASSET,R155_HELPER_ASSET} from './r155-native-component.mjs';
import {verifySDK13NativeComponent,verifySDK13HelperBundle,SDK13_HELPER_ASSET,SDK13_HELPER_PLIST} from './sdk13-native-component.mjs';
import {SDK_RUNTIME_UNIONS,sdkRuntimeUnionProfile,SDK14_RUNTIME_UNION_SOURCE} from './sdk14-runtime-union.mjs';
import {canonicalNativeEvidencePlan} from './canonical-native-evidence.mjs';
import {readSDK35ProductRuntime,assertSDK35ProductArchive} from './sdk35-product-runtime.mjs';
import {readSDK36ProductRuntime,assertSDK36ProductArchive} from './sdk36-product-runtime.mjs';
import {readSDK37ProductRuntime,assertSDK37ProductArchive} from './sdk37-product-runtime.mjs';
import {readSDK38ProductRuntime,assertSDK38ProductArchive} from './sdk38-product-runtime.mjs';
import {readSDK39ProductRuntime,assertSDK39ProductArchive} from './sdk39-product-runtime.mjs';
const readSDKProductRuntime=(root,commit)=>readSDK35ProductRuntime(root,commit)??readSDK36ProductRuntime(root,commit)??readSDK37ProductRuntime(root,commit)??readSDK38ProductRuntime(root,commit)??readSDK39ProductRuntime(root,commit);
const assertSDKProductArchive=(product,inventory)=>product?.public.kind==='YNX-WALLET-SDK39-PRODUCT-PACK/v1'?assertSDK39ProductArchive(product,inventory):product?.public.kind==='YNX-WALLET-SDK38-PRODUCT-PACK/v1'?assertSDK38ProductArchive(product,inventory):product?.public.kind==='YNX-WALLET-SDK37-PRODUCT-PACK/v1'?assertSDK37ProductArchive(product,inventory):product?.public.kind==='YNX-WALLET-SDK36-PRODUCT-PACK/v1'?assertSDK36ProductArchive(product,inventory):assertSDK35ProductArchive(product,inventory);

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const RUNTIME_PACKAGE_FIELDS=Object.freeze(["name","main","type","imports","exports","dependencies","optionalDependencies","engines","os","cpu"]);
export const PACKAGED_RELOCATION_RECEIPT = "ynx-wallet-packaged-relocation.json";
const RELOCATION_VERSION = "wallet-canonical-normal-paths-v2";
const sdkPrefix = "../../../packages/wallet-auth/src/";
const sdkPackedPrefix = sdkPrefix;
const joint = "original-auth-identity-private-joint-registration.js";
// Closed source-owned recipe. These are operands, not arbitrary source text,
// entrypoint overrides, runtime providers or alternate copies of the SDK.
const desktopRules = [
  ["main.mjs", [joint]],
  ["original-auth-identity-startup.mjs", [joint]],
  ["password-wallet-vault.mjs", ["canonical.js", "original-operation-recovery-state.js", "original-wallet-service-role-enrollment-state.js", "original-wallet-service-admission.js", "original-wallet-service-runtime-observer.js", "original-wallet-service-runtime-publication.js", "original-wallet-service-admission-publication-state.js", "original-wallet-service-admission-installer.js"]],
  ["password-vault-crypto.mjs", ["original-wallet-service-role-enrollment-state.js", "original-wallet-service-admission-publication-state.js", "original-wallet-service-runtime-publication.js"]],
  ["original-admission-custodian.mjs", [joint,"original-ide-parent-host.js"]]
];
export const PACKAGED_RELOCATION_RULES = Object.freeze([
  ...desktopRules.map(([file, suffixes]) => ({sourcePath:`apps/wallet-desktop/src/${file}`, packedPath:`code/apps/wallet-desktop/src/${file}`, operands:suffixes.map(suffix=>({kind:"from",from:sdkPrefix+suffix,to:sdkPackedPrefix+suffix,count:1}))})),
  {sourcePath:`packages/wallet-auth/src/${joint}`,packedPath:`code/packages/wallet-auth/src/${joint}`,operands:[
    {kind:"from",from:"../../../apps/wallet-desktop/src/password-wallet-vault.mjs",to:"../../../apps/wallet-desktop/src/password-wallet-vault.mjs",count:1},
    {kind:"url",from:"../../../apps/wallet-desktop/native/original-auth-identity.node",to:"../../../apps/wallet-desktop/native/original-auth-identity.node",count:1}]},
  {sourcePath:"packages/wallet-auth/src/original-wallet-service-private-dispatch.js",packedPath:"code/packages/wallet-auth/src/original-wallet-service-private-dispatch.js",operands:[
    {kind:"url",from:"../../../apps/wallet-desktop/native/original-auth-identity.node",to:"../../../apps/wallet-desktop/native/original-auth-identity.node",count:1}]},
  {sourcePath:"packages/wallet-auth/scripts/original-wallet-private-service-launcher.mjs",packedPath:"code/packages/wallet-auth/scripts/original-wallet-private-service-launcher.mjs",operands:[
    {kind:"url",from:"../../../apps/wallet-desktop/native/original-auth-identity.node",to:"../../../apps/wallet-desktop/native/original-auth-identity.node",count:1}]},
  ...['original-host-terminal-journal.js','original-ide-admission-parent-delivery.js'].map(file=>({sourcePath:`packages/wallet-auth/src/${file}`,packedPath:`code/packages/wallet-auth/src/${file}`,operands:[
    // SDK318 has distinct parent and cold delivery loads; both must survive.
    {kind:'url',from:'../../../apps/wallet-desktop/native/original-auth-identity.node',to:'../../../apps/wallet-desktop/native/original-auth-identity.node',count:file==='original-ide-admission-parent-delivery.js'?2:1}]})),
  // This existing SDK daemon is explicitly unconfigured. Its separate optional
  // IO module is NOT the Wallet authority module; preserve its URL unchanged,
  // do not synthesize a substitute or claim that the service is supplied.
  {sourcePath:'packages/wallet-auth/src/original-auth-identity-source-current.js',packedPath:'code/packages/wallet-auth/src/original-auth-identity-source-current.js',unavailableNativeAsset:'code/apps/wallet-desktop/native/original-source-current-dirfd.node',operands:[
    {kind:'url',from:'../../../apps/wallet-desktop/native/original-source-current-dirfd.node',to:'../../../apps/wallet-desktop/native/original-source-current-dirfd.node',count:1}]}
].map(rule=>Object.freeze({...rule,operands:Object.freeze(rule.operands.map(Object.freeze))})));
const escapeRE = text => text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const repositoryOperand = /(?:from\s*|new\s+URL\s*\(\s*)["']\.\.\/\.\.\/\.\.\/(?:packages\/wallet-auth|apps\/wallet-desktop)\//;
const packedRuntimePath = canonicalSourcePath;
const SDK330_VERSION='1.3.0-pq.3.30-auth.1';
const SDK332_VERSION='1.3.0-pq.3.32-auth.1';
const SDK332_R140_VERSION='1.3.0-pq.3.32-auth.2';
const SDK332_CLEANUP_VERSION='1.3.0-pq.3.32-auth.3';
const SDK332_DEPLOYMENT_VERSION='1.3.0-pq.3.32-auth.4';
const SDK_R154_VERSION='1.3.0-pq.3.32-auth.5';
const SDK_CONTRACT_CLIENT_VERSION='1.3.0-pq.3.32-auth.6';
const SDK_CONTRACT_CURRENT_VERSION='1.3.0-pq.3.32-auth.13';
const SDK_AUTONOMOUS_SCOPE_VERSION='1.3.0-pq.3.32-auth.14';
const SDK_PROJECT_READER_VERSION='1.3.0-pq.3.32-auth.18';
const SDK_WORKSPACE_SELECTION_VERSION='1.3.0-pq.3.32-auth.19';
const SDK_PUBLICATION_RESULT_VERSION='1.3.0-pq.3.32-auth.20';
const SDK_CONTROL_CUSTODY_VERSION='1.3.0-pq.3.32-auth.26';
const SDK_PRINCIPAL_CURRENT_VERSION='1.3.0-pq.3.32-auth.28';
const SDK31_VERSION='1.3.0-pq.3.32-auth.31';
const SDK32_VERSION='1.3.0-pq.3.32-auth.32';
const SDK33_VERSION='1.3.0-pq.3.32-auth.33';
const SDK34_VERSION='1.3.0-pq.3.32-auth.34';
const SDK35_VERSION='1.3.0-pq.3.32-auth.35';
const SDK36_VERSION='1.3.0-pq.3.32-auth.36';
const SDK37_VERSION='1.3.0-pq.3.32-auth.37';
const SDK38_VERSION='1.3.0-pq.3.32-auth.38';
const SDK39_VERSION='1.3.0-pq.3.32-auth.39';
// Auth28 adds this runtime module, but not its optional Source IO component.
// Keep the exact URL bytes/path; do not turn packaging into Source activation.
const SDK28_SOURCE_CURRENT_RULE=Object.freeze({sourcePath:'packages/wallet-auth/src/original-auth-source-current-v2.js',packedPath:'code/packages/wallet-auth/src/original-auth-source-current-v2.js',unavailableNativeAsset:'code/apps/wallet-desktop/native/original-source-current-dirfd.node',operands:Object.freeze([Object.freeze({kind:'url',from:'../../../apps/wallet-desktop/native/original-source-current-dirfd.node',to:'../../../apps/wallet-desktop/native/original-source-current-dirfd.node',count:1})])});
export const FIXED_SDK_RUNTIME_IDENTITIES=Object.freeze({
 [SDK330_VERSION]:Object.freeze({bytes:64574,sha256:'3fb78277a0e2b842d86bccb499275809040206c26d3358d270ef8f1ff2a02693'}),
 [SDK332_VERSION]:Object.freeze({bytes:65346,sha256:'0abdc434eb6e7aacc4708127e413c686e10963f4744b730c74f3d4300f522d07'}),
 [SDK332_R140_VERSION]:Object.freeze({bytes:65346,sha256:'2f7475868d459b918c612064e111322b937759b78779c16adef948a56e7c0220'}),
 [SDK332_CLEANUP_VERSION]:Object.freeze({bytes:65346,sha256:'eeea144302168f53c51be55e2403cde30ee4f9c6b6b04eb5e65f2c11d621cd3c'}),
 [SDK332_DEPLOYMENT_VERSION]:Object.freeze({bytes:65919,sha256:'d104b6f1670a60014fcae0470d8bc6e108cdbb2cb86deba30db8e7b9d067ae30'}),
 [SDK_R154_VERSION]:Object.freeze({bytes:65919,sha256:'53446225376a55c36dca8fdcd3963c92bc69bf8ea39ab1df609a8c07525b34d3'}),
 [SDK_CONTRACT_CLIENT_VERSION]:Object.freeze({bytes:65919,sha256:'c501bb7184460131b796850e2ad5f4ac1aa9b63e11fc89431e0ad375f6721c22'}),
 [SDK_CONTRACT_CURRENT_VERSION]:Object.freeze({bytes:67464,sha256:'0984d592faf25df7cf63fcc5188bd4eee4796db62c73d7040e9494edda71fb2c'}),
 [SDK_AUTONOMOUS_SCOPE_VERSION]:Object.freeze({bytes:67464,sha256:'82d3ad0b1d8538d5f75fe62b21a8589344c2e3c3e88f0de1988c173159e050b7'}),
 [SDK_PROJECT_READER_VERSION]:Object.freeze({bytes:67464,sha256:'2294be8c02b5470ce6d4ac0bcf1e71f29790043ed266d5dc3e4cdac08353678b'}),
 [SDK_WORKSPACE_SELECTION_VERSION]:Object.freeze({bytes:67464,sha256:'b968e5fee531b65449234d833a2aec91dd38b701257f167c7c7a7dfb544f934f'}),
 [SDK_PUBLICATION_RESULT_VERSION]:Object.freeze({bytes:67466,sha256:'efb2f8ad2c05eec712ebe262a23033b3fff79529a25d13579f36ccc5ab777c2a'}),
 [SDK_CONTROL_CUSTODY_VERSION]:Object.freeze({bytes:69712,sha256:'d48382919256d7087a13c0472c2737b71e1049bdbc56545c09cff7e0c4dac8ae'}),
 [SDK_PRINCIPAL_CURRENT_VERSION]:Object.freeze({bytes:69856,sha256:'2b3b4e6581248664776e3c3340882de2b6c28059700dc6b6b9ac2c8c5b22804f'}),
 [SDK31_VERSION]:Object.freeze({bytes:78713,sha256:'68e7497e7444cbbdc344ec7721c5ddb4c762299cc18f737a78c24943bbb6629e'}),
 [SDK32_VERSION]:Object.freeze({bytes:80280,sha256:'58b5bbfd4fd93b4ea18f27292cd7a82751583147858163e4ebd899d1eb16a986'}),
 [SDK33_VERSION]:Object.freeze({bytes:80280,sha256:'19f2e15913232f1dd84a1152799f89201e60300879feb75e0f36cf2742830d84'}),
 [SDK34_VERSION]:Object.freeze({bytes:80280,sha256:'9dfcc99af154e826db909ad65ed57760cfbca53192fb405276f6da91bf9f2489'}),
 [SDK35_VERSION]:Object.freeze({bytes:80552,sha256:'d033551404b49ced72bf8ff2abe0df054889bc08287112ebefca940add11fd25'}),
 [SDK36_VERSION]:Object.freeze({bytes:80552,sha256:'9ff6d289420a4593e36de4105b8fa287ee91abde81c01a551615377fa14e9ae8'}),
 [SDK37_VERSION]:Object.freeze({bytes:80552,sha256:'fbda1cf6569b31d9014c1124818cd3f1adc8dc15e2f8dbbaeb68ad9fdf91c7ab'}),
 [SDK38_VERSION]:Object.freeze({bytes:80693,sha256:'a4ec4f1664efe0f85857244a40494e6dd111355441d1792c10fdecb5d9c012b5'}),
 [SDK39_VERSION]:Object.freeze({bytes:80693,sha256:'14127f676839db9b070bc3c56ff4bd05e82b3df8998ecbe203616df005d92ce0'})
});
const FIXED_SDK_RUNTIME_MANIFEST='packages/wallet-auth/native/original-ide-auth-runtime-manifest.json';
export function fixedSDKRuntimeManifestSources(root,sourceCommit){
 const sdk=JSON.parse(git(root,'show',`${sourceCommit}:packages/wallet-auth/package.json`));
 const present=git(root,'ls-tree','-r','--name-only',sourceCommit,'--',FIXED_SDK_RUNTIME_MANIFEST)===FIXED_SDK_RUNTIME_MANIFEST;
 const identity=Object.hasOwn(FIXED_SDK_RUNTIME_IDENTITIES,sdk.version)?FIXED_SDK_RUNTIME_IDENTITIES[sdk.version]:null;
 if(!identity){
  // Only the explicit historical318 layout predates this independent file.
  // Unknown successors must not turn a missing manifest into an exemption.
  if(sdk.version!=='1.3.0-pq.3.18'||present)throw Error('Unsupported SDK runtime manifest selection');
  return [];
 }
 if(!present)throw Error('Required SDK runtime manifest is missing');
 // This independent supplier manifest is not part of package.files and must
 // not authorize itself or arbitrary adjacent JSON. Pin its reviewed identity
 // as well as requiring byte equality with the immutable composed source.
 const bytes=execFileSync('git',['show',`${sourceCommit}:${FIXED_SDK_RUNTIME_MANIFEST}`],{cwd:root,maxBuffer:1024*1024});
 if(bytes.length!==identity.bytes||digest(bytes)!==identity.sha256)throw Error('Fixed SDK runtime manifest identity differs');
 if(Object.hasOwn(SDK_RUNTIME_UNIONS,sdk.version)){
  const pin=sdkRuntimeUnionProfile(sdk.version);
  const union=execFileSync('git',['show',`${sourceCommit}:${SDK14_RUNTIME_UNION_SOURCE}`],{cwd:root,maxBuffer:2*1024*1024});
  if(union.length!==pin.bytes||digest(union)!==pin.sha256)throw Error('Fixed matched SDK runtime union identity differs');
  return [FIXED_SDK_RUNTIME_MANIFEST,SDK14_RUNTIME_UNION_SOURCE];
 }
 return [FIXED_SDK_RUNTIME_MANIFEST];
}
function selectedRelocationRules(sdkVersion){
  // The frozen SDK330 adds the third, distinct IDE peer delivery load. This is
  // a selected-source-version contract, never a count inferred from the input.
  if(sdkVersion!==SDK330_VERSION&&sdkVersion!==SDK332_VERSION&&sdkVersion!==SDK332_R140_VERSION&&sdkVersion!==SDK332_CLEANUP_VERSION&&sdkVersion!==SDK332_DEPLOYMENT_VERSION&&sdkVersion!==SDK_R154_VERSION&&sdkVersion!==SDK_CONTRACT_CLIENT_VERSION&&sdkVersion!==SDK_CONTRACT_CURRENT_VERSION&&sdkVersion!==SDK_AUTONOMOUS_SCOPE_VERSION&&sdkVersion!==SDK_PROJECT_READER_VERSION&&sdkVersion!==SDK_WORKSPACE_SELECTION_VERSION&&sdkVersion!==SDK_PUBLICATION_RESULT_VERSION&&sdkVersion!==SDK_CONTROL_CUSTODY_VERSION&&sdkVersion!==SDK_PRINCIPAL_CURRENT_VERSION&&sdkVersion!==SDK31_VERSION&&sdkVersion!==SDK32_VERSION&&sdkVersion!==SDK33_VERSION&&sdkVersion!==SDK34_VERSION&&sdkVersion!==SDK35_VERSION&&sdkVersion!==SDK36_VERSION&&sdkVersion!==SDK37_VERSION&&sdkVersion!==SDK38_VERSION&&sdkVersion!==SDK39_VERSION)return PACKAGED_RELOCATION_RULES;
  const selected=PACKAGED_RELOCATION_RULES.map(rule=>rule.sourcePath==='packages/wallet-auth/src/original-ide-admission-parent-delivery.js'
    ?{...rule,operands:rule.operands.map(operand=>({...operand,count:3}))}:rule);
  return [SDK_PRINCIPAL_CURRENT_VERSION,SDK31_VERSION,SDK32_VERSION,SDK33_VERSION,SDK34_VERSION,SDK35_VERSION,SDK36_VERSION,SDK37_VERSION,SDK38_VERSION,SDK39_VERSION].includes(sdkVersion)?[...selected,SDK28_SOURCE_CURRENT_RULE]:selected;
}
// Build/readback DATA only. The normal package caller MUST first obtain this
// component from verifySDK13NativeComponent; it is never Source admission.
export function auth26PackagedNativeSources(inventoryBytes,component,availableNames){
 if(JSON.parse(inventoryBytes).version!==SDK_CONTROL_CUSTODY_VERSION)throw Error('Auth26 matched inventory required');
 return matchedCustodyPackagedNativeSources(inventoryBytes,component,availableNames);
}
export function matchedCustodyPackagedNativeSources(inventoryBytes,component,availableNames){
 if(component?.sourceBytesVerified!==true||!Array.isArray(component.walletInputs)||!Array.isArray(availableNames))throw Error('Auth26 matched component must precede source selection');
 const inventory=JSON.parse(inventoryBytes);if(![SDK_CONTROL_CUSTODY_VERSION,SDK_PRINCIPAL_CURRENT_VERSION,SDK31_VERSION,SDK32_VERSION,SDK33_VERSION,SDK34_VERSION,SDK35_VERSION,SDK36_VERSION,SDK37_VERSION,SDK38_VERSION,SDK39_VERSION].includes(inventory.version))throw Error('Matched custody inventory required');
 const names=[...inventory.NativeInputs.map(p=>p.path),...component.walletInputs.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS];
 const pins=[...inventory.NativeInputs,...component.walletInputs].map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256}));canonicalNativeInputSelection(inventory.version,names,inventoryBytes,pins);
 if(names.some(name=>!availableNames.includes(name)))throw Error('Auth26 selected Native source is missing from frozen Git');return names;
}
// Fixed original Native build-evidence inputs may be carried by the normal
// builder. They are not runtime entrypoints; never allow arbitrary *.test.mjs.
const NATIVE_BUILD_EVIDENCE_TESTS=CANONICAL_NATIVE_EVIDENCE_TESTS;

// SDK production JS can live outside src (for example the R28 same-Host
// publisher). Derive that closure from the selected commit's package files,
// never from the mutable checkout, archive receipt or an ambient SDK copy.
export function declaredSDKRuntimeSources(root,sourceCommit){
 const sdk=JSON.parse(git(root,'show',`${sourceCommit}:packages/wallet-auth/package.json`));
 if(sdk.files===undefined)return [];
 if(!Array.isArray(sdk.files)||sdk.files.some(name=>typeof name!=='string'))throw Error('SDK declared runtime inventory is invalid');
 const scopes=sdk.files.filter(name=>name==='scripts'||name.startsWith('scripts/')||name.startsWith('native/'));
 for(const name of scopes)if(path.posix.normalize(name)!==name||name.includes('\\')||name.split('/').includes('..')||/[\0*?\[\]{}!]/.test(name))throw Error('SDK declared runtime scope is invalid');
 const names=new Set();
 for(const scope of scopes){
  const prefix='packages/wallet-auth/'+scope,declared=git(root,'ls-tree','-r','--name-only',sourceCommit,'--',prefix).split('\n').filter(Boolean);
  // A declaration must exist in the selected commit even when it is solely a
  // type or native source. Zero JS matches alone is not proof of a missing file.
  if(!declared.length)throw Error(`SDK declared runtime source is missing: ${scope}`);
  const found=declared.filter(name=>/\.(?:mjs|js|cjs|json)$/.test(name)&&!name.endsWith('.test.mjs'));
  // Existing package documentation is not JavaScript. Still require its
  // declaration to exist in the immutable selected commit above; this never
  // makes a missing JS file, unknown asset or arbitrary scope acceptable.
  const nonRuntime=name=>/\.d\.(?:ts|mts|cts)$/.test(name)||/\.(?:h|hpp|c|cc|cpp|mm|m|md)$/.test(name);
  if(!found.length&&!declared.every(nonRuntime))throw Error(`SDK declared runtime source is missing: ${scope}`);
  for(const name of found)names.add(name);
 }
 return [...names].sort();
}

export function relocateDesktopRuntimeSource(name, source, sdkVersion='1.3.0-pq.3.18') {
  const rule = selectedRelocationRules(sdkVersion).find(item=>item.sourcePath===name);
  let text = source.toString("utf8");
  if (!rule) {
    if (repositoryOperand.test(text)) throw new Error(`Unlisted repository operand: ${name}`);
    return {bytes:source,operands:[]};
  }
  const operands=[];
  for (const operand of rule.operands) {
    const prefix=operand.kind==="from"?"\\bfrom\\s*":"\\bnew\\s+URL\\s*\\(\\s*";
    const pattern=new RegExp(`(${prefix})(["'])${escapeRE(operand.from)}\\2`,"g");
    let count=0;
    text=text.replace(pattern,()=>{count++;return '';});
    if(count!==operand.count) throw new Error(`Relocation operand count differs: ${name} ${operand.from}`);
    operands.push({...operand,count});
  }
  if(repositoryOperand.test(text)) throw new Error(`Unlisted repository operand: ${name}`);
  return {bytes:source,operands};
}

function relocationPlan(cwd, expected) {
  const root=git(cwd,"rev-parse","--show-toplevel");
  const sdk=JSON.parse(git(root,'show',`${expected.sourceCommit}:packages/wallet-auth/package.json`));
  return selectedRelocationRules(sdk.version).map(rule=>{
    const source=execFileSync("git",["show",`${expected.sourceCommit}:${rule.sourcePath}`],{cwd:root,maxBuffer:16*1024*1024});
    const output=relocateDesktopRuntimeSource(rule.sourcePath,source,sdk.version);
    return {...rule,gitBlob:git(root,"rev-parse",`${expected.sourceCommit}:${rule.sourcePath}`),inputBytes:source.length,inputSHA256:digest(source),emittedBytes:output.bytes.length,emittedSHA256:digest(output.bytes),operands:output.operands,source,output:output.bytes};
  });
}
const publicRelocationRows = plan => plan.map(({source,output,...row})=>row);

export function desktopAsarHeaderIntegrity(resources,cwd=projectDir) {
  const asar=createRequire(path.join(cwd,"package.json"))("@electron/asar"),archive=path.join(resources,"app.asar");
  return {algorithm:"SHA256",hash:digest(Buffer.from(asar.getRawHeader(archive).headerString,"utf8"))};
}

function archiveInventory(asar, archive) {
  asar.uncache(archive);
  return asar.listPackage(archive).map(item=>{
    const name=item.replace(/^\//,""), info=asar.statFile(archive,path.normalize(name),false);
    if("files" in info) return {path:name,type:"directory",unpacked:!!info.unpacked};
    if("link" in info) return {path:name,type:"link",link:info.link,unpacked:!!info.unpacked};
    const b=asar.extractFile(archive,path.normalize(name),false);
    const physicalMode=info.unpacked?lstatSync(path.join(archive+".unpacked",name)).mode&0o777:null;
    return {path:name,type:"file",unpacked:!!info.unpacked,executable:!!info.executable,physicalMode,bytes:b.length,sha256:digest(b)};
  }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
function nativeEvidencePlan(cwd,sourceCommit){
  const root=git(cwd,'rev-parse','--show-toplevel'),sdk=JSON.parse(git(root,'show',`${sourceCommit}:packages/wallet-auth/package.json`));
  return canonicalNativeEvidencePlan(sdk.version,name=>execFileSync('git',['show',`${sourceCommit}:${name}`],{cwd:root,maxBuffer:262144}));
}
/** Source-selected runtime manifests and normal pack filters must agree.
 * This is an early refusal, not a new manifest/projection or admission. Only
 * independently pinned existing tables are read; no row is removed or granted
 * runtime status merely because a package happened to include it.
 */
export function assertSDKRuntimePackCoverage(cwd,sourceCommit){
 const root=git(cwd,'rev-parse','--show-toplevel'),metadata=JSON.parse(git(root,'show',`${sourceCommit}:apps/wallet-desktop/package.json`));
 if(!Array.isArray(metadata.build?.files)||metadata.build.files.some(p=>typeof p!=='string'))throw Error('SDK_RUNTIME_PACK_FILTER_REQUIRED');
 const {FileMatcher}=createRequire(import.meta.url)('app-builder-lib/out/fileMatcher');
 const selected=new FileMatcher(cwd,'/PUBLIC/not-an-output',value=>value,metadata.build.files).createFilter(),manifests=fixedSDKRuntimeManifestSources(root,sourceCommit),seen=new Set(),product=readSDKProductRuntime(root,sourceCommit);
 for(const manifest of manifests){const body=product?{files:[...(manifest.endsWith('/original-ide-auth-runtime-manifest.json')?product.authRows:product.unionRows).values()]}:JSON.parse(git(root,'show',`${sourceCommit}:${manifest}`));
  if(!Array.isArray(body.files))throw Error('SDK_RUNTIME_MANIFEST_INVALID');
  for(const row of body.files){const relative=row.path;
   // Type declarations/Native source and dependency layout have their own
   // existing gates. Here check actual executable SDK source rows only.
   if(typeof relative!=='string'||!/^(?:src|native|scripts)\/.+\.(?:js|mjs|cjs|json)$/.test(relative))continue;
   if(!selected(path.join(cwd,SDK_ALIAS,relative),{isDirectory:()=>false}))throw Object.assign(Error('SDK_RUNTIME_MANIFEST_PACK_SELECTION_CONFLICT:'+relative),{code:'SDK_RUNTIME_MANIFEST_PACK_SELECTION_CONFLICT',path:relative,manifest});
   seen.add(relative);
  }
 }
 return Object.freeze({manifests,executableSDKRowsChecked:seen.size,runtimeQualified:false});
}
function ensureUnchangedMembers(before, after, plan, metadataInput,dependencies,evidence,productRuntime=null) {
  const expected=canonicalArchivePlan(before,metadataInput,[...dependencies.rows,...evidence.rows],productRuntime?.manifestRows??[],productRuntime?.dataRows??[],productRuntime?.excludedRows??[]).after;
  if(!isDeepStrictEqual(after,expected))throw new Error('Canonical packaging changed unexpected archive members');
  for(const row of plan){const found=after.find(item=>item.path===row.packedPath);if(!found||found.type!=='file'||found.bytes!==row.emittedBytes||found.sha256!==row.emittedSHA256)throw new Error('Canonical source input differs: '+row.sourcePath);}
}

// Run only in a short-lived packaging data child. The parent waits for its exit
// before reading output: this ASAR version resolves before the final stream flush.
export async function writeRelocatedArchive(resources, cwd, output) {
  const asar=createRequire(path.join(cwd,"package.json"))("@electron/asar");
  const archive=path.join(resources,"app.asar");
  asar.uncache(archive);
  const metadata=JSON.parse(asar.extractFile(archive,"package.json").toString("utf8"));
  const expected=desktopReleaseIdentity(cwd,metadata.version),plan=relocationPlan(cwd,expected);
  const before=archiveInventory(asar,archive),metadataInput=asar.extractFile(archive,'package.json'),dependencies=walletAuthDependencyPlan(cwd,expected.sourceCommit),evidence=nativeEvidencePlan(cwd,expected.sourceCommit);
  // Preserve the normal early refusal for already-canonical/foreign inputs,
  // before attempting any raw source-path lookup or creating output streams.
  const product=readSDKProductRuntime(git(cwd,'rev-parse','--show-toplevel'),expected.sourceCommit),productRuntime=product?.prepare(before)??null;
  const canonical=canonicalArchivePlan(before,metadataInput,[...dependencies.rows,...evidence.rows],productRuntime?.manifestRows??[],productRuntime?.dataRows??[],productRuntime?.excludedRows??[]);
  for(const row of plan){
    const rawPath=row.sourcePath.startsWith('apps/wallet-desktop/')?row.sourcePath.slice('apps/wallet-desktop/'.length):SDK_ALIAS+'/'+row.sourcePath.slice('packages/wallet-auth/'.length);
    const info=asar.statFile(archive,path.normalize(rawPath),false);
    if(info.unpacked||info.link||info.files||!asar.extractFile(archive,path.normalize(rawPath),false).equals(row.source)) throw new Error(`Relocation input differs: ${row.sourcePath}`);
  }
  await writeCanonicalArchiveInputs({asar,archive,output,before,metadataInput,dependencies,evidence,productRuntime,canonical});
}

/** The normal relocation child's real ASAR writer. Tests use PUBLIC archives,
 * not a replacement packer; final product verification remains separate. */
export async function writeCanonicalArchiveInputs({asar,archive,output,before,metadataInput,dependencies,evidence,productRuntime=null,canonical:preparedPlan}){
  if(evidence.rows.length){
    const allowed=new Set(CANONICAL_NATIVE_EVIDENCE_TESTS.map(canonicalSourcePath));
    for(const row of before)if(/^code\/packages\/wallet-auth\/native\/.+\.test\.mjs$/.test(canonicalPackedPath(row.path))&&!allowed.has(canonicalPackedPath(row.path)))throw Error('Foreign Native build evidence asset');
  }
  const canonical=preparedPlan??canonicalArchivePlan(before,metadataInput,[...dependencies.rows,...evidence.rows],productRuntime?.manifestRows??[],productRuntime?.dataRows??[],productRuntime?.excludedRows??[]);
  const originals=new Map(before.map(row=>[canonicalPackedPath(row.path),row.path]));
  const streams=canonical.after.map(row=>{
    if(row.type==="directory") return {path:row.path,type:row.type,unpacked:row.unpacked};
    if(row.type==="link") return {path:row.path,type:row.type,unpacked:row.unpacked,symlink:path.posix.relative(path.posix.dirname(row.path),row.link),stat:{mode:0o777}};
    const canonicalAlias=row.path.startsWith(SDK_ALIAS+'/')?'code/packages/wallet-auth'+row.path.slice(SDK_ALIAS.length):null;
    const input=canonicalAlias??row.path;
    const bytes=row.path==='package.json'?canonical.metadata:row.path===CANONICAL_APP_METADATA?canonical.appMetadata:productRuntime?.contents.get(input)??productRuntime?.readAdditional?.(input)??dependencies.contents.get(input)??evidence.contents.get(input)??asar.extractFile(archive,path.normalize(originals.get(input)),false);
    return {path:row.path,type:"file",unpacked:row.unpacked,stat:{mode:row.physicalMode??(row.executable?0o755:0o644),size:bytes.length},streamGenerator:()=>Readable.from([bytes])};
  });
  await asar.createPackageFromStreams(output,streams);
}

export function relocateDesktopPackage(resources, cwd=projectDir) {
  const asar=createRequire(path.join(cwd,"package.json"))("@electron/asar");
  const archive=path.join(resources,"app.asar");
  asar.uncache(archive);
  const metadata=JSON.parse(asar.extractFile(archive,"package.json").toString("utf8"));
  const expected=desktopReleaseIdentity(cwd,metadata.version),plan=relocationPlan(cwd,expected);
  assertSDKRuntimePackCoverage(cwd,expected.sourceCommit);
  const before=archiveInventory(asar,archive);
  const metadataInput=asar.extractFile(archive,'package.json');
  const dependencies=walletAuthDependencyPlan(cwd,expected.sourceCommit);
  const evidence=nativeEvidencePlan(cwd,expected.sourceCommit);
  const product=readSDKProductRuntime(git(cwd,'rev-parse','--show-toplevel'),expected.sourceCommit),productRuntime=product?.prepare(before)??null;
  const temporary=mkdtempSync(path.join(resources,".ynx-relocation-")),output=path.join(temporary,"app.asar");
  const nativeBefore=path.join(archive+'.unpacked','native/original-auth-identity.node'),nativeAfter=path.join(archive+'.unpacked',NATIVE_CANONICAL),backup=path.join(temporary,'original.asar');
  let nativeMoved=false,archiveMoved=false,replacement=false;
  try{
    execFileSync(process.execPath,[fileURLToPath(import.meta.url),"--relocate-data-child",resources,cwd,output],{maxBuffer:16*1024*1024,stdio:"pipe"});
    const after=archiveInventory(asar,output);
    ensureUnchangedMembers(before,after,plan,metadataInput,dependencies,evidence,productRuntime);
    assertSDKProductArchive(product,after);
    // Only packed operands change; retain the original unpacked tree, not a
    // newly copied native artifact. Verify again against that retained tree.
    mkdirSync(path.dirname(nativeAfter),{recursive:true});renameSync(nativeBefore,nativeAfter);nativeMoved=true;
    renameSync(archive,backup);archiveMoved=true;renameSync(output,archive);replacement=true;asar.uncache(archive);
    if(!isDeepStrictEqual(archiveInventory(asar,archive),after)) throw new Error("Retained unpacked tree differs");
    const receipt={schemaVersion:2,recipe:RELOCATION_VERSION,sourceCommit:expected.sourceCommit,files:publicRelocationRows(plan),sdkDependencies:dependencies.public,nativeBuildEvidence:evidence.public,sdkProductRuntime:product?.public??null,metadataInputBase64:metadataInput.toString('base64'),before,after,asarHeaderIntegrity:desktopAsarHeaderIntegrity(resources,cwd)};
    writeFileSync(path.join(resources,PACKAGED_RELOCATION_RECEIPT),JSON.stringify(receipt,null,2)+"\n");
    return receipt;
  }catch(cause){
    // Packaging is offline. A failed transaction restores its original archive
    // and sole unpacked native file; no half-canonical package is accepted.
    if(archiveMoved){if(replacement)renameSync(archive,output);renameSync(backup,archive);asar.uncache(archive);}
    if(nativeMoved)renameSync(nativeAfter,nativeBefore);
    throw cause;
  }finally{rmSync(temporary,{recursive:true,force:true});}
}

export function desktopReleaseIdentity(cwd = projectDir, version) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const sourceCommit = git(root, "rev-parse", "HEAD");
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("An exact source commit is required");
  if (process.env.GITHUB_SHA && sourceCommit !== process.env.GITHUB_SHA) throw new Error("CI source and checkout differ");
  // A package identity must never describe a tracked dirty source as a commit.
  git(root, "diff", "--exit-code", "HEAD", "--", "apps/wallet-desktop", "packages/wallet-auth");
  const metadata = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Package version is invalid");
  return Object.freeze({ schemaVersion: 1, product: "YNX Wallet", version, sourceVersion: metadata.version, sourceCommit,
    walletTree: git(root, "rev-parse", `${sourceCommit}:apps/wallet-desktop`),
    walletAuthTree: git(root, "rev-parse", `${sourceCommit}:packages/wallet-auth`),
    distribution: "testnet-preview", productionSigned: false, storeReleased: false,
    installedRuntimeVerified: false, publicDownloadVerified: false });
}

export function verifyDesktopPackage(resources, cwd = projectDir) {
  const require = createRequire(path.join(cwd, "package.json"));
  const asar = require("@electron/asar");
  const archive = path.join(resources, "app.asar");
  // Verification must read the current archive, including after an in-process rebuild.
  asar.uncache(archive);
  const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
  const expected = desktopReleaseIdentity(cwd, metadata.version);
  assertSDKRuntimePackCoverage(cwd,expected.sourceCommit);
  const actual = JSON.parse(readFileSync(path.join(resources, "ynx-wallet-build-identity.json"), "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Embedded build identity does not match the checkout");
  const plan=relocationPlan(cwd,expected);
  const dependencies=walletAuthDependencyPlan(cwd,expected.sourceCommit);
  const evidence=nativeEvidencePlan(cwd,expected.sourceCommit);
  const receipt=JSON.parse(readFileSync(path.join(resources,PACKAGED_RELOCATION_RECEIPT),"utf8"));
  if(receipt.schemaVersion!==2||receipt.recipe!==RELOCATION_VERSION||receipt.sourceCommit!==expected.sourceCommit||!isDeepStrictEqual(receipt.files,publicRelocationRows(plan))||typeof receipt.metadataInputBase64!=='string') throw new Error("Packaged relocation receipt differs from source recipe");
  if(!isDeepStrictEqual(receipt.sdkDependencies,dependencies.public))throw Error('Packaged SDK dependency receipt differs from fixed source inputs');
  if(!isDeepStrictEqual(receipt.nativeBuildEvidence??[],evidence.public))throw Error('Packaged Native evidence receipt differs from fixed source inputs');
  const product=readSDKProductRuntime(git(cwd,'rev-parse','--show-toplevel'),expected.sourceCommit),productRuntime=product?.prepare(receipt.before)??null;
  if(!isDeepStrictEqual(receipt.sdkProductRuntime??null,product?.public??null))throw Error('Packaged SDK product projection receipt differs from fixed source inputs');
  ensureUnchangedMembers(receipt.before,receipt.after,plan,Buffer.from(receipt.metadataInputBase64,'base64'),dependencies,evidence,productRuntime);
  assertSDKProductArchive(product,receipt.after);
  if(!isDeepStrictEqual(archiveInventory(asar,archive),receipt.after)) throw new Error("Packaged archive differs from relocation receipt");
  const unavailableOptionalRuntimeAssets=plan.filter(row=>row.unavailableNativeAsset).map(row=>{
    if(receipt.after.some(member=>member.path===row.unavailableNativeAsset))throw Error('Unreviewed optional source-current Native module');
    return {declaredBy:row.sourcePath,path:row.unavailableNativeAsset,packaged:false,capability:'NOT_SUPPLIED'};
  });
  if(!isDeepStrictEqual(desktopAsarHeaderIntegrity(resources,cwd),receipt.asarHeaderIntegrity)) throw new Error("Relocated ASAR header integrity differs");
  let macAsarIntegrityVerified=false;
  if(path.basename(resources)==="Resources"&&path.basename(path.dirname(resources))==="Contents"){
    const plist=path.join(path.dirname(resources),"Info.plist");
    const entry=JSON.parse(execFileSync("plutil",["-extract","ElectronAsarIntegrity","json","-o","-",plist],{encoding:"utf8"}))["Resources/app.asar"];
    if(!isDeepStrictEqual(entry,receipt.asarHeaderIntegrity)) throw new Error("Mac ASAR integrity metadata differs from relocated header");
    macAsarIntegrityVerified=true;
  }
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const sourceMetadata=JSON.parse(execFileSync("git",["show",`${expected.sourceCommit}:apps/wallet-desktop/package.json`],{cwd:root,encoding:"utf8",maxBuffer:16*1024*1024}));
  const sdkMetadata=JSON.parse(execFileSync('git',['show',`${expected.sourceCommit}:packages/wallet-auth/package.json`],{cwd:root,maxBuffer:16*1024*1024}));
  const sdkRuntimeDependencies=verifyPackagedWalletAuthDependencies(asar,archive,dependencies,sdkMetadata);
  const nativeSourceNames=git(root,'ls-tree','-r','--name-only',expected.sourceCommit,'apps/wallet-desktop/native','packages/wallet-auth/native').split('\n').filter(isCanonicalNativeSourceAsset);
  const nativeReceiptBytes=asar.extractFile(archive,NATIVE_RECEIPT),nativeReceipt=JSON.parse(nativeReceiptBytes.toString('utf8'));
  const sourceBytes=name=>execFileSync('git',['show',`${expected.sourceCommit}:${name}`],{cwd:root,maxBuffer:16*1024*1024});
  const inventoryBytes=[SDK332_CLEANUP_VERSION,SDK332_DEPLOYMENT_VERSION,SDK_R154_VERSION,SDK_CONTRACT_CLIENT_VERSION,SDK_CONTRACT_CURRENT_VERSION,SDK_AUTONOMOUS_SCOPE_VERSION,SDK_PROJECT_READER_VERSION,SDK_WORKSPACE_SELECTION_VERSION,SDK_PUBLICATION_RESULT_VERSION,SDK_CONTROL_CUSTODY_VERSION,SDK_PRINCIPAL_CURRENT_VERSION,SDK31_VERSION,SDK32_VERSION,SDK33_VERSION,SDK34_VERSION,SDK35_VERSION,SDK36_VERSION,SDK37_VERSION,SDK38_VERSION,SDK39_VERSION].includes(sdkMetadata.version)?sourceBytes(SDK332_NATIVE_INVENTORY):null;
  const localNative=path.join(cwd,'native/original-auth-identity.node'),localReceipt=path.join(cwd,'native/original-auth-identity-build.json'),nativeBytes=asar.extractFile(archive,NATIVE_CANONICAL);
  if(!lstatSync(localNative).isFile()||!lstatSync(localReceipt).isFile()||!nativeBytes.equals(readFileSync(localNative))||!nativeReceiptBytes.equals(readFileSync(localReceipt)))throw Error('Packaged native module or receipt differs from frozen build input');
  let originalR155=null,originalSDK13=null;
  if([SDK_R154_VERSION,SDK_CONTRACT_CLIENT_VERSION].includes(sdkMetadata.version)){
    const extra=name=>{const packed=asar.extractFile(archive,canonicalSourcePath(name)),local=path.join(root,name);if(!lstatSync(local).isFile()||lstatSync(local).isSymbolicLink()||!packed.equals(readFileSync(local)))throw Error('R155 packaged supplier asset differs');return packed};
    originalR155=verifyOriginalR155Component({recordBytes:nativeReceiptBytes,intakeBytes:extra(R155_INTAKE_ASSET),inventoryBytes,moduleBytes:nativeBytes,helperBytes:extra(R155_HELPER_ASSET)},sourceBytes);
    if(!macAsarIntegrityVerified)throw Error('Original R155 component requires its matched Mac bundle');
    originalR155.helperBundle=verifyOriginalR155HelperBundle(path.dirname(resources));
  }
  if([SDK_CONTRACT_CURRENT_VERSION,SDK_AUTONOMOUS_SCOPE_VERSION,SDK_PROJECT_READER_VERSION,SDK_WORKSPACE_SELECTION_VERSION,SDK_PUBLICATION_RESULT_VERSION,SDK_CONTROL_CUSTODY_VERSION,SDK_PRINCIPAL_CURRENT_VERSION,SDK31_VERSION,SDK32_VERSION,SDK33_VERSION,SDK34_VERSION,SDK35_VERSION,SDK36_VERSION,SDK37_VERSION,SDK38_VERSION,SDK39_VERSION].includes(sdkMetadata.version)){
    const helperBytes=asar.extractFile(archive,canonicalSourcePath(SDK13_HELPER_ASSET)),localHelper=path.join(root,SDK13_HELPER_ASSET);
    if(!lstatSync(localHelper).isFile()||lstatSync(localHelper).isSymbolicLink()||!helperBytes.equals(readFileSync(localHelper)))throw Error('SDK13 packaged helper differs from matching build');
    originalSDK13=verifySDK13NativeComponent({record:nativeReceipt,inventoryBytes,moduleBytes:nativeBytes,helperBytes},sourceBytes);
    if(!macAsarIntegrityVerified)throw Error('SDK13 paired component requires matching Mac bundle');
    originalSDK13.helperBundle=verifySDK13HelperBundle(path.dirname(resources),helperBytes,sourceBytes(SDK13_HELPER_PLIST));
  }
  // Auth26 may preserve both optional role headers and the historical archive
  // in Git. Presence is not activation. Narrow ONLY after the independent
  // exact-inventory/role/command/byte component reader has succeeded above;
  // never infer authority or a compile set from arbitrary receipt argv.
  let selectedNativeNames=nativeSourceNames;
  if([SDK_CONTROL_CUSTODY_VERSION,SDK_PRINCIPAL_CURRENT_VERSION,SDK31_VERSION,SDK32_VERSION,SDK33_VERSION,SDK34_VERSION,SDK35_VERSION,SDK36_VERSION,SDK37_VERSION,SDK38_VERSION,SDK39_VERSION].includes(sdkMetadata.version)){
    selectedNativeNames=matchedCustodyPackagedNativeSources(inventoryBytes,originalSDK13,nativeSourceNames);
  }
  const nativeSelection=canonicalNativeInputSelection(sdkMetadata.version,selectedNativeNames,inventoryBytes,originalR155?.nodeInputFiles??nativeReceipt.inputFiles),nativeInputs=nativeSelection.inputs;
  const nativeModuleBuild={...(originalR155??originalSDK13??verifyCanonicalNativeReceipt(nativeReceipt,nativeBytes,nativeInputs,sourceBytes)),sourceInventory:nativeSelection.inventory??null,walletSourceInputs:nativeSelection.walletInputs??[],supplierNodeInputCount:nativeSelection.supplierNodeInputCount??nativeInputs.length,receipt:{path:NATIVE_RECEIPT,bytes:nativeReceiptBytes.length,sha256:digest(nativeReceiptBytes)}};
  // The two closed source-inspection assets remain exact Git-bound evidence,
  // even when the production compile inventory correctly excludes tests.
  // Do not make them compiler inputs or admit arbitrary packaged test files.
  const nativeBuildEvidenceAssets=NATIVE_BUILD_EVIDENCE_TESTS.filter(name=>nativeSelection.evidenceAssets.includes(name)&&!product?.excluded.has(name.replace(/^packages\/wallet-auth\//,'')));
  // Matching src bytes are insufficient if package.json can select another
  // entrypoint or alter resolution. Release version remains separately bound
  // by the existing identity; these runtime fields must match source exactly.
  for(const field of RUNTIME_PACKAGE_FIELDS){
    // Node selects conditional imports/exports in insertion order, recursively.
    // Both values come from JSON.parse: serialized equality preserves that
    // order, including nested conditions and fallback arrays, without running
    // any packaged entrypoint. Other metadata maps remain order-insensitive.
    const same=field==='main' ? sourceMetadata.main==='src/main.mjs'&&metadata.main===CANONICAL_MAIN : field==="imports"||field==="exports"
      ?JSON.stringify(metadata[field])===JSON.stringify(sourceMetadata[field])
      :isDeepStrictEqual(metadata[field],sourceMetadata[field]);
    if(Object.hasOwn(metadata,field)!==Object.hasOwn(sourceMetadata,field)||!same)throw new Error(`Packaged runtime metadata differs: ${field}`);
  }
  // wallet-auth-contract.mjs reads this registry from the SDK root at runtime.
  // Require it in the commit as well as the archive: ls-tree alone can silently
  // omit a named path that no longer exists in the selected commit.
  const requiredRuntimeAssets = ["packages/wallet-auth/package.json", "packages/wallet-auth/product-session-registry.json",...fixedSDKRuntimeManifestSources(root,expected.sourceCommit)];
  const declaredSDKRuntimeAssets=declaredSDKRuntimeSources(root,expected.sourceCommit);
  const names = [...new Set([...git(root, "ls-tree", "-r", "--name-only", expected.sourceCommit, "apps/wallet-desktop/src", "packages/wallet-auth/src", ...requiredRuntimeAssets).split("\n"),...declaredSDKRuntimeAssets,
    ...nativeInputs.filter(name=>name.startsWith('packages/wallet-auth/')&&name.endsWith('.mjs')&&!name.endsWith('.test.mjs')),...nativeBuildEvidenceAssets])];
  for (const name of requiredRuntimeAssets) {
    if (!names.includes(name)) throw new Error(`Required runtime asset is missing from the selected commit: ${name}`);
  }
  // electron-builder excludes TypeScript declarations from an executable package.
  // Keep that exclusion explicit; all runtime logic binds to the selected
  // checkout. Canonical packaging validates the seven closed operand inventories
  // but never rewrites any source operand or executes the packaged entrypoint.
  const excludedTypeDeclarations = names.filter(name => name.endsWith(".d.ts")&&!product?.selected.has(name.replace(/^packages\/wallet-auth\//,'')));
  const verified = [];
  for (const name of names) {
    if (excludedTypeDeclarations.includes(name)) continue;
    const packedName = packedRuntimePath(name);
    const source = execFileSync("git", ["show", `${expected.sourceCommit}:${name}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    // @electron/asar traverses its header with the host path separator.
    const packed = asar.extractFile(archive, path.normalize(packedName));
    // Evidence data is never interpreted as runtime or relocated. This exact
    // closed subset can contain source-inspection operands in its test body.
    const emitted=product?.contents.get(packedName)??(nativeBuildEvidenceAssets.includes(name)?source:relocateDesktopRuntimeSource(name,source,sdkMetadata.version).bytes);
    if (!emitted.equals(packed)) throw new Error(`Packaged source differs: ${name}`);
    verified.push({ path: packedName, bytes: packed.length, sha256: digest(packed) });
  }
  const allowed=new Set(names.filter(name=>!excludedTypeDeclarations.includes(name)).map(packedRuntimePath));
  if(product)for(const name of product.selected.keys())allowed.add('code/packages/wallet-auth/'+name);
  for(const row of receipt.after){
    const additionalSDKRuntime=/^code\/packages\/wallet-auth\/(?:native|scripts)\/.+\.(?:mjs|js|cjs|json)$/.test(row.path);
    if(row.type!=="directory"&&(row.path.startsWith("code/apps/wallet-desktop/src/")||row.path.startsWith("code/packages/wallet-auth/src/")||additionalSDKRuntime)&&!allowed.has(row.path)) throw new Error(`Unlisted packaged runtime member: ${row.path}`);
  }
  return { ...expected, packagedSourceVerified: true, sourceVerificationScope: "every runtime Wallet and SDK source", runtimePackageMetadataVerified:true,verifiedRuntimePackageFields:[...RUNTIME_PACKAGE_FIELDS], excludedTypeDeclarations,
    canonicalLayoutVerified:true,sourceOperandsUnchanged:true,nativeModuleBuild,declaredSDKRuntimeAssets,nativeBuildEvidenceAssets,
    unavailableOptionalRuntimeAssets,sdkProductRuntime:product?.public??null,
    sdkRuntimeDependenciesVerified:true,sdkRuntimeDependencies,
    staticPathRelocationVerified:true,staticPathRelocation:receipt.files,macAsarIntegrityVerified,
    typeDeclarationExclusionReason: product?"Fixed SDK product selection retains required declarations; only declarations outside that selection are excluded.":"TypeScript declarations are compile-time files excluded by electron-builder; they are not claimed to be packaged runtime bytes.",
    asarSHA256: digest(readFileSync(archive)), files: verified };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]==="--relocate-data-child") {
  const [,resources,cwd,output]=process.argv.slice(2);
  if(!resources||!cwd||!output) throw new Error("Relocation data child requires exact resources, project and output");
  await writeRelocatedArchive(path.resolve(resources),path.resolve(cwd),path.resolve(output));
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [resources, outputDirectory] = process.argv.slice(2);
  if (!resources || !outputDirectory) throw new Error("Usage: release-provenance.mjs <resources-directory> <artifact-directory>");
  const verification = verifyDesktopPackage(path.resolve(resources));
  const artifacts = readdirSync(outputDirectory, { withFileTypes: true })
    .filter(item => item.isFile() && /\.(?:exe|deb|AppImage|dmg)$/.test(item.name))
    .map(item => { const bytes = readFileSync(path.join(outputDirectory, item.name)); return { filename: item.name, bytes: bytes.length, sha256: digest(bytes) }; });
  if (!artifacts.length) throw new Error("No distributable installer was produced");
  const manifest = { ...verification, buildPlatform: process.platform, buildArchitecture: process.arch, artifacts };
  writeFileSync(path.join(outputDirectory, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ sourceCommit: manifest.sourceCommit, version: manifest.version, verifiedFiles: manifest.files.length, artifacts }));
}

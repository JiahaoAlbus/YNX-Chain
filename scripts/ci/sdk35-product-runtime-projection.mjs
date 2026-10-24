// BUILD ONLY, SDK35 derived metadata. No files are removed/copied from a product,
// no Native reader is weakened and no old full-runtime digest is reused.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const VERSION='1.3.0-pq.3.32-auth.35',SCHEMA='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1';
const sha=b=>createHash('sha256').update(b).digest('hex'),fail=c=>{throw Object.assign(Error(c),{code:c})};
const policyPath=fileURLToPath(new URL('./fixtures/sdk35-product-runtime-policy.json',import.meta.url));
const policyRaw=fs.readFileSync(policyPath);if(policyRaw.length!==4082||sha(policyRaw)!=='df1d8e329a4e9d3266359da9999081ccafcf3396a3c6439aa31dbae1ce93a5b7')fail('SDK35_PRODUCT_POLICY_PIN');
const policy=JSON.parse(policyRaw),eq=(a,b)=>a.bytes===b.bytes&&a.sha256===b.sha256;
const flags={NativeAdmission:false,SourceAdmission:false,Root:false,AppQualified:false,activation:false,installed:false,published:false};
const requiredProof=['package.json','native/original-auth-identity-source-verifier.mjs','native/original-ide-auth-proof-dispatch.mjs','native/original-auth-identity-v2-contract.mjs','src/auth-identity-verification.js','src/pq-wallet-policy.js','src/pq-wallet-authorization.js'];
const requiredRelay=['package.json','src/original-ide-contract-relay-guard-node.js','src/original-ide-contract-relay-guard-core.js','src/walletconnect-dapp-connection.js','src/walletconnect-contract-initiator-boundary.js','src/walletconnect-contract-initiator-boundary-node.js','node_modules/@walletconnect/core/dist/index.cjs','node_modules/@walletconnect/core/package.json','node_modules/@walletconnect/sign-client/dist/index.cjs','node_modules/@walletconnect/sign-client/package.json','node_modules/@walletconnect/utils/dist/index.cjs','node_modules/@walletconnect/utils/package.json','node_modules/.package-lock.json'];
function rows(files,count){if(!Array.isArray(files)||files.length!==count)fail('SDK35_PRODUCT_COUNT');let previous='';const map=new Map();for(const p of files){if(!p||Object.keys(p).sort().join('|')!=='bytes|path|sha256'||typeof p.path!=='string'||!p.path||p.path>='\x7f'||/[^\x20-\x7e]|\\/.test(p.path)||path.posix.isAbsolute(p.path)||p.path.split('/').some(x=>!x||x==='.'||x==='..')||p.path<=previous||!Number.isSafeInteger(p.bytes)||p.bytes<0||p.bytes>16777216||!/^[a-f0-9]{64}$/.test(p.sha256))fail('SDK35_PRODUCT_ROW');map.set(p.path,p);previous=p.path;}return map;}
function matches(map,p,code='SDK35_PRODUCT_MEMBER'){const r=map.get(p.path);if(!r||!eq(r,p))fail(code);}
function subpath(p){if(p.startsWith('packages/wallet-auth/'))return p.slice(21);if(p.startsWith('apps/wallet-desktop/native/'))return 'native/'+p.slice(27);return p;}
/** Pure metadata projection for PUBLIC controls and the fixed-ref entry below.
 * This function alone proves no original provenance, runtime readback or grant. */
export function projectSDK35ProductRuntimeMetadata({inventory,auth,union,materialization,appManifest,packageJSON,nativeInventory,exclusions=policy.excluded}){
 if(JSON.stringify(exclusions)!==JSON.stringify(policy.excluded))fail('SDK35_PRODUCT_EXCLUSION_POLICY');
 if(inventory.kind!=='YNX_SDK35_COMPLETE_NORMAL_PREFIX_FILE_INVENTORY/v1'||inventory.versionSDK!==VERSION||inventory.fileCount!==9581||packageJSON.version!==VERSION||nativeInventory.version!==VERSION||nativeInventory.NativeInputs?.length!==99)fail('SDK35_PRODUCT_VERSION');
 if(Object.keys(auth).sort().join('|')!=='files|version'||Object.keys(union).sort().join('|')!=='files|version'||auth.version!==SCHEMA||union.version!==SCHEMA)fail('SDK35_PRODUCT_RUNTIME_SCHEMA');
 const full=rows(inventory.files,9581),a=rows(auth.files,566),u=rows(union.files,9426),removed=new Set(exclusions.map(x=>x.path));
 for(const p of [...a.values(),...u.values()])matches(full,p);
 for(const p of a.values())matches(u,p);
 for(const p of exclusions){matches(full,p);if(p.path.startsWith('native/')){matches(a,p);matches(u,p);}else if(a.has(p.path)||u.has(p.path))fail('SDK35_PRODUCT_EXCLUSION_MEMBERSHIP');}
 const protectedNames=new Set([...requiredProof,...requiredRelay,'package-lock.json',...policy.nativeReaders.map(p=>p.path)]);
 for(const n of nativeInventory.NativeInputs)protectedNames.add(subpath(n.path));
 const publicNames=new Set();const strings=v=>{if(typeof v==='string'){if(v.startsWith('./')){protectedNames.add(v.slice(2));publicNames.add(v.slice(2));}}else if(v&&typeof v==='object')for(const x of Object.values(v))strings(x);};strings(packageJSON.exports);
 for(const b of Object.values(packageJSON.bin??{})){const n=b.replace(/^\.\//,'');protectedNames.add(n);publicNames.add(n);}
 for(const n of publicNames)if(!full.has(n))fail('SDK35_PRODUCT_PUBLIC_ENTRYPOINT_MISSING');
 for(const p of removed)if(protectedNames.has(p))fail('SDK35_PRODUCT_REQUIRED_REMOVAL');
 for(const p of protectedNames)if(!p.startsWith('apps/')&&full.has(p)&&removed.has(p))fail('SDK35_PRODUCT_REQUIRED_REMOVAL');
 if(materialization.filesCopied!==9176||materialization.files?.length!==9176||materialization.app316Files!==316||materialization.app316Added!==53||materialization.fullAppDependencyCoverage!==true||appManifest.files?.length!==316)fail('SDK35_PRODUCT_DEPENDENCIES');
 const deps=rows(materialization.files,9176);for(const p of deps.values()){if(!p.path.startsWith('node_modules/'))fail('SDK35_PRODUCT_DEPENDENCIES');matches(full,p);}
 matches(full,{path:'node_modules/.package-lock.json',bytes:54706,sha256:'4bcda46e64a177344da39833571be1c875398fa3b4fc8e6dd12104bfc4e77048'});
 let extra=0;for(const p of appManifest.files){const q={...p,path:'node_modules/'+p.path};matches(full,q);matches(deps,q);if(!u.has(q.path))extra++;}if(extra!==53)fail('SDK35_PRODUCT_APP316');
 const files=inventory.files.filter(p=>!removed.has(p.path)),authFiles=auth.files.filter(p=>!removed.has(p.path)),unionFiles=union.files.filter(p=>!removed.has(p.path));
 // New product identity additionally binds the already full-prefix-pinned lock
 // demanded by the unchanged Native Relay reader. The old9426 stays untouched.
 if(u.has('node_modules/.package-lock.json'))fail('SDK35_PRODUCT_UNEXPECTED_OLD_LOCK');
 unionFiles.push(full.get('node_modules/.package-lock.json'));unionFiles.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(files.length!==9566||authFiles.length!==556||unionFiles.length!==9417)fail('SDK35_PRODUCT_COUNT');
 const productAuth={files:authFiles,version:SCHEMA},productUnion={files:unionFiles,version:SCHEMA},missingProof=requiredProof.filter(p=>!authFiles.some(x=>x.path===p)),missingRelay=requiredRelay.filter(p=>!unionFiles.some(x=>x.path===p));
 return {kind:'YNX_SDK35_PRODUCT_RUNTIME_METADATA_PROJECTION/v1',versionSDK:VERSION,files,Auth:productAuth,union:productUnion,excluded:exclusions,fullPrefixFiles:9581,productFiles:9566,fullAuthFiles:566,productAuthFiles:556,fullUnionFiles:9426,productUnionFiles:9417,productUnionInheritedRemovals:10,productUnionAddedRequiredLock:1,dependenciesPreserved:9176,installedLockPreserved:true,App316FilesPreserved:316,App316Extra53Preserved:true,missingProofRuntimeEntrypoints:missingProof,missingRelayRuntimeEntrypoints:missingRelay,nativeReaderInputsComplete:!missingProof.length&&!missingRelay.length,originalProvenanceVerified:false,runtimeBytesReadBack:false,...flags};
}
/** Verify that a proposed pack selection can satisfy each unchanged Native
 * manifest row. This is metadata consistency, never filesystem/admission. */
export function verifySDK35ProductRuntimeProjectionMetadata({selection,auth,union}){
 const kept=rows(selection.files,9566);for(const body of [auth,union]){if(Object.keys(body).sort().join('|')!=='files|version'||body.version!==SCHEMA)fail('SDK35_PRODUCT_RUNTIME_SCHEMA');for(const p of body.files)matches(kept,p,'SDK35_PRODUCT_MANIFEST_PACK_MISMATCH');}
 rows(auth.files,556);rows(union.files,9417);for(const n of requiredProof)if(!auth.files.some(p=>p.path===n))fail('SDK35_PRODUCT_NATIVE_REQUIRED_ENTRYPOINT_MISSING');for(const n of requiredRelay)if(!union.files.some(p=>p.path===n))fail('SDK35_PRODUCT_NATIVE_REQUIRED_ENTRYPOINT_MISSING');
 for(const p of policy.excluded)if(kept.has(p.path))fail('SDK35_PRODUCT_EXCLUSION_POLICY');
 return {metadataConsistent:true,runtimeReadBack:false,...flags};
}
function canonical(file,dir=false){if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)fail('SDK35_PRODUCT_PATH');for(let at=file;;at=path.dirname(at)){if(fs.lstatSync(at).isSymbolicLink())fail('SDK35_PRODUCT_SYMLINK');if(at===path.dirname(at))break;}if(fs.realpathSync(file)!==file||dir&&!fs.lstatSync(file).isDirectory())fail('SDK35_PRODUCT_PATH');}
function exact(ref,expected=ref){if(!ref||ref.bytes!==expected.bytes||ref.sha256!==expected.sha256)fail('SDK35_PRODUCT_REF');canonical(ref.path);const st=fs.lstatSync(ref.path);if(!st.isFile()||st.size!==ref.bytes||st.size>4194304)fail('SDK35_PRODUCT_PIN');const raw=fs.readFileSync(ref.path);if(sha(raw)!==ref.sha256)fail('SDK35_PRODUCT_PIN');return raw;}
const json=(ref,expected)=>JSON.parse(exact(ref,expected));
/** Fixed SDK35 supply only. Builds new DATA manifests/pack selection under an
 * absent output directory. No tree walk, runtime/dependency scan or copying.
 * Requires original builder checkout npm-ci TypeScript solely for static AST. */
export async function createSDK35ProductRuntimeProjection({fullSupplyHandoff,completePrefixInventory,ideProjectionInput,composedSourceRoot}){
 const h=json(fullSupplyHandoff,policy.fullSupplyHandoff),inventory=json(completePrefixInventory,policy.completePrefixInventory);if(h.versionSDK!==VERSION||h.commit!==inventory.sourceCommit||h.prefix!==inventory.prefix)fail('SDK35_PRODUCT_SOURCE');
 const ide=json(ideProjectionInput,policy.ideProjectionInput);if(ide.testCount!==15||ide.prefix!==h.prefix||!eq(ide.parentInventory,policy.completePrefixInventory)||JSON.stringify(ide.exactTestRows)!==JSON.stringify(policy.excluded))fail('SDK35_PRODUCT_IDE_POLICY');
 const auth=json(h.runtime.Auth.manifest,policy.Auth),union=json(h.runtime.union,policy.union),materialization=json(inventory.parents[0]),nativeInventory=json(h.independent35SourcePins['packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json']),packageJSON=json(h.independent35SourcePins['packages/wallet-auth/package.json']);
 const appManifest=json({path:path.join(h.prefix,'integration/WALLET_APP_RUNTIME_DEPENDENCIES_316.json'),...policy.App316});
 const npmReceipt=json(inventory.parents[1]),sourceReceipt=json(inventory.parents[2]),full=rows(inventory.files,9581);
 if(npmReceipt.commit!==h.commit||npmReceipt.version!==VERSION||npmReceipt.files?.length!==339||sourceReceipt.commit!==h.commit||sourceReceipt.membersVerifiedExactGit!==339||sourceReceipt.extraFixedGitSourceCount!==64||sourceReceipt.extraFixedGitSource?.length!==64)fail('SDK35_PRODUCT_SOURCE_RECEIPTS');
 const reconciled=new Map();for(const p of [...npmReceipt.files,...sourceReceipt.extraFixedGitSource,...materialization.files,full.get('package-lock.json'),full.get('node_modules/.package-lock.json')]){matches(full,p);if(reconciled.has(p.path))fail('SDK35_PRODUCT_RECEIPT_OVERLAP');reconciled.set(p.path,p);}
 if(reconciled.size!==9581||sourceReceipt.rootLockSHA256!==full.get('package-lock.json').sha256||sourceReceipt.installedLockSHA256!==full.get('node_modules/.package-lock.json').sha256)fail('SDK35_PRODUCT_SOURCE_RECEIPTS');
 for(const pin of policy.nativeReaders)exact({path:path.join(h.prefix,pin.path),bytes:pin.bytes,sha256:pin.sha256});
 const projected=projectSDK35ProductRuntimeMetadata({inventory,auth,union,materialization,appManifest,packageJSON,nativeInventory});
 // Existing Native methods have a hard minimum required set. No caller marker
 // or new digest makes an incomplete manifest admissible.
 verifySDK35ProductRuntimeProjectionMetadata({selection:{files:projected.files},auth:projected.Auth,union:projected.union});
 if(!projected.nativeReaderInputsComplete){const e=Object.assign(Error('SDK35_PRODUCT_NATIVE_REQUIRED_ENTRYPOINT_MISSING'),{code:'SDK35_PRODUCT_NATIVE_REQUIRED_ENTRYPOINT_MISSING',missingProof:projected.missingProofRuntimeEntrypoints,missingRelay:projected.missingRelayRuntimeEntrypoints});throw e;}
 const {analyzeSDK35ProductSourceImports}=await import('./sdk35-product-source-analysis.mjs');
 const analysis=analyzeSDK35ProductSourceImports({prefix:h.prefix,files:inventory.files,excluded:policy.excluded});
 canonical(composedSourceRoot,true);if(composedSourceRoot===h.prefix||composedSourceRoot.startsWith(h.prefix+path.sep))fail('SDK35_PRODUCT_OUTPUT');
 const projectionParent=path.join(composedSourceRoot,'runtime-projections'),outputRoot=path.join(projectionParent,'sdk35-product');if(fs.existsSync(projectionParent))canonical(projectionParent,true);
 const serialize=v=>Buffer.from(JSON.stringify(v)+'\n'),outputs=[['original-ide-auth-runtime-manifest.json',projected.Auth],['original-ide-contract-relay-runtime-manifest.json',projected.union],['SDK35_PRODUCT_PACK_SELECTION.json',{kind:'YNX_SDK35_PRODUCT_PACK_SELECTION/v1',versionSDK:VERSION,files:projected.files,fileCount:9566,generatedManifestFilesCountedSeparately:2,...flags}],['STATIC_SOURCE_ANALYSIS.json',analysis]],pins=[];
 if(!fs.existsSync(projectionParent))fs.mkdirSync(projectionParent,{mode:0o700});fs.mkdirSync(outputRoot,{mode:0o700});try{for(const [name,body]of outputs){const raw=serialize(body),file=path.join(outputRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,raw,{flag:'wx',mode:0o600});const pin={path:file,bytes:raw.length,sha256:sha(raw)};exact(pin);pins.push(pin);}
  const receipt={...projected,files:undefined,Auth:undefined,union:undefined,sourceHandoff:fullSupplyHandoff,completePrefixInventory,ideProjectionInput,sourceAnalysis:analysis.sources.length,packMappings:[{source:'runtime-projections/sdk35-product/original-ide-auth-runtime-manifest.json',packed:'code/packages/wallet-auth/native/original-ide-auth-runtime-manifest.json'},{source:'runtime-projections/sdk35-product/original-ide-contract-relay-runtime-manifest.json',packed:'code/packages/wallet-auth/native/original-ide-contract-relay-runtime-manifest.json'}],outputs:pins,originalProvenanceVerified:true,fullSupplyMutated:false,fullCustodyManifestReused:false,generatedManifestsRequireNewMainProfile:true,...flags};fs.writeFileSync(path.join(outputRoot,'PROJECTION_RECEIPT.json'),serialize(receipt),{flag:'wx',mode:0o600});return receipt;
 }catch(e){if(e&&typeof e==='object'){e.partialOutputPreserved=true;e.firstCause??=e.code??e.message;}throw e;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length!==3)fail('SDK35_PRODUCT_ARGUMENTS');const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(await createSDK35ProductRuntimeProjection(request)));}

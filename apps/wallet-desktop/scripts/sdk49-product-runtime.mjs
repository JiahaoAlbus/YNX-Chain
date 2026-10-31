import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {SDK_CANONICAL} from './canonical-package.mjs';
import {SDK49_SOURCE_COMMIT,SDK49_SOURCE_VARIANT} from './sdk49-runtime-source.mjs';
import {SDK49_DAEMON_PRODUCT_PINS,SDK49_DAEMON_VARIANT,SDK49_DAEMON_COMMIT,SDK49_DAEMON_TREE} from './sdk49-daemon-profile.mjs';
import {SDK49_NORMAL_PRODUCT_PINS,SDK49_NORMAL_VARIANT,SDK49_NORMAL_COMMIT,SDK49_NORMAL_TREE} from './sdk49-normal-profile.mjs';
const base='runtime-projections/sdk49-product/';
// SDK49 normal prefix has no separate legacy build-input tables to exclude.
// Preserve full Native custody separately; product slots use only formal6 pins.
const SDK49_BUILD_INPUT_MANIFESTS=Object.freeze([]);
export const SDK49_PRODUCT_PINS=Object.freeze({
  "original-ide-auth-runtime-manifest.json": {
    "bytes": 83612,
    "sha256": "d5b351adf97a69efd234216d30c04b43c40baa79edea7e65b49696d46e2e866d",
    "fullBytes": 85049,
    "fullSHA256": "b5c5a2f53babe1354733c9958f30962ea5af3ab0fdbf862c86a4541d1f472d1d"
  },
  "original-ide-contract-relay-runtime-manifest.json": {
    "bytes": 1469474,
    "sha256": "726833172aad2ce6b980b0de20a46aaeecf50d99fc8f5efb3e5217d9b075ecc2",
    "fullBytes": 1470778,
    "fullSHA256": "de0cfa0bbccb7338c2f35e8326c4a739b1273293e55c162e2b211fd6172104e7"
  },
  "SDK49_PRODUCT_PACK_SELECTION.json": {
    "bytes": 1817313,
    "sha256": "088e1cd79ad1312f3810775b2bdf42989f9bf37211e7f8a099c6f13a128c35fb"
  },
  "STATIC_SOURCE_ANALYSIS.json": {
    "bytes": 152197,
    "sha256": "cd21935775ce72bfdf480890a5ae801ac037858aaf787eef8106efe473a95c35"
  },
  "PROJECTION_RECEIPT.json": {
    "bytes": 1394,
    "sha256": "e604263da94f036d3abdf0a750b8b3831304fa56a4e3418614049394b2608a73"
  },
  "SDK49_FINITE_EXCLUSION_POLICY.json": {
    "bytes": 3216,
    "sha256": "34c0e85c9930447bd36a6aeba1e4b40309d230304bc88b6fe19ee6725a9c2acd"
  }
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const relative=p=>typeof p==='string'&&p&&!p.startsWith('/')&&!p.includes('\\')&&!p.includes('\0')&&path.posix.normalize(p)===p&&!p.split('/').some(s=>s==='.'||s==='..');
function rows(value,count,ordered=true,fields='bytes,path,sha256'){
 if(!Array.isArray(value)||value.length!==count)fail('SDK49_PRODUCT_ROWS_INVALID');let previous='';const map=new Map();
 for(const row of value){if(Object.keys(row).join(',')!==fields||!relative(row.path)||ordered&&row.path<=previous||map.has(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>16777216||!/^[a-f0-9]{64}$/.test(row.sha256))fail('SDK49_PRODUCT_ROWS_INVALID');previous=row.path;map.set(row.path,row);}
 return map;
}
const equalRow=(a,b)=>a&&b&&a.bytes===b.bytes&&a.sha256===b.sha256;
// Match the original normal/Main and Native dictionary readers. A fixed pin
// alone cannot establish their canonical byte contract. Never trim or repair.
export function assertSDK49CanonicalRuntimeManifest(raw){
 let body;try{body=JSON.parse(raw);}catch{fail('SDK49_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS');}
 if(!Buffer.isBuffer(raw)||!body||Array.isArray(body)||Object.keys(body).join(',')!=='files,version'||body.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||!Array.isArray(body.files)||!Buffer.from(JSON.stringify(body)).equals(raw))fail('SDK49_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS');
 return body;
}
/** Fixed build DATA projection. This does not generate a manifest, change a
 * component record or authorize a Source. Missing projection keeps old normal
 * source behavior; its manifest/filter conflicts must still be refused.
 */
export function readSDK49ProductRuntime(root,sourceCommit){
 const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:8<<20});
 const sdk=JSON.parse(git('show',sourceCommit+':packages/wallet-auth/package.json'));if(sdk.version!=='1.3.0-pq.3.32-auth.49')return null;
 const present=git('ls-tree','-r','--name-only',sourceCommit,'--',base).toString().trim();if(!present)return null;
 const rawReceipt=git('show',sourceCommit+':'+base+'PROJECTION_RECEIPT.json'),daemon=rawReceipt.length===SDK49_DAEMON_PRODUCT_PINS['PROJECTION_RECEIPT.json'].bytes&&hash(rawReceipt)===SDK49_DAEMON_PRODUCT_PINS['PROJECTION_RECEIPT.json'].sha256;
 const normal=rawReceipt.length===SDK49_NORMAL_PRODUCT_PINS['PROJECTION_RECEIPT.json'].bytes&&hash(rawReceipt)===SDK49_NORMAL_PRODUCT_PINS['PROJECTION_RECEIPT.json'].sha256;
 const pins=normal?SDK49_NORMAL_PRODUCT_PINS:daemon?SDK49_DAEMON_PRODUCT_PINS:SDK49_PRODUCT_PINS,counts=normal?{pack:9639,auth:614,union:9474,fullAuth:624,fullUnion:9484}:daemon?{pack:9612,auth:601,union:9462,fullAuth:611,fullUnion:9471}:{pack:9598,auth:587,union:9448,fullAuth:597,fullUnion:9457};
 if(JSON.stringify(present.split('\n').sort())!==JSON.stringify(Object.keys(pins).map(name=>base+name).sort()))fail('SDK49_PRODUCT_SOURCE_SET_DIFFERS');
 const blobs=new Map(),documents=new Map();
 for(const[name,pin]of Object.entries(pins)){const raw=git('show',sourceCommit+':'+base+name);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('SDK49_PRODUCT_SOURCE_PIN_DIFFERS');blobs.set(name,raw);documents.set(name,JSON.parse(raw));}
 const selection=documents.get('SDK49_PRODUCT_PACK_SELECTION.json'),auth=documents.get('original-ide-auth-runtime-manifest.json'),union=documents.get('original-ide-contract-relay-runtime-manifest.json'),receipt=documents.get('PROJECTION_RECEIPT.json');
 const analysis=documents.get('STATIC_SOURCE_ANALYSIS.json');
 if(normal){
  if(receipt.schema!=='ynx-sdk49-normal-main-product-source-projection/v1'||receipt.sourceCommit!==SDK49_NORMAL_COMMIT||receipt.sourceTree!==SDK49_NORMAL_TREE||receipt.sourceVariant!==SDK49_NORMAL_VARIANT||receipt.counts?.prefixFiles!==9654||receipt.counts?.NativeInputs!==137||receipt.counts?.HelperInputs!==5||analysis.kind!=='YNX_SDK49_NORMAL_MAIN_SOURCE_ANALYSIS/v1'||analysis.sources?.length!==263||analysis.edges?.length!==947||receipt.inheritedOldRoleQualification!==false||['NativeAdmission','SourceAdmission','RootAdmission','compiled','installed','activation','realLogin','realRestore','realRevoke'].some(k=>receipt[k]!==false))fail('SDK49_PRODUCT_SUCCESSOR_ROLE_REQUIRED');
 }else if(daemon){
  if(receipt.schema!=='ynx-sdk49-pair-daemon-product-source-projection/v1'||receipt.sourceCommit!==SDK49_DAEMON_COMMIT||receipt.sourceTree!==SDK49_DAEMON_TREE||receipt.counts?.prefixFiles!==9627||receipt.counts?.NativeInputs!==117||receipt.counts?.HelperInputs!==5||receipt.ASTSources!==224||receipt.literalEdges!==768||analysis.kind!=='YNX_SDK49_PAIR_DAEMON_STATIC_SOURCE_ANALYSIS/v1'||analysis.sources?.length!==224||analysis.edges?.length!==768||receipt.RootStorageAddonSupplied!==false||receipt.SourceAdmission!==false||receipt.RootAdmission!==false||receipt.compiled!==false||receipt.installed!==false)fail('SDK49_PRODUCT_SUCCESSOR_ROLE_REQUIRED');
 }else if(receipt.commit!==SDK49_SOURCE_COMMIT||receipt.sourceVariant!==SDK49_SOURCE_VARIANT||receipt.fullPrefixFiles!==9613||receipt.NativeInputs!==117||receipt.HelperInputs!==5||receipt.NativeChanged!==26||receipt.HelperChanged!==0||receipt.ASTSources!==213||receipt.literalEdges!==726||analysis.kind!=='YNX_SDK49_BUILD_STATIC_SOURCE_ANALYSIS/v1'||analysis.sources?.length!==213||analysis.edges?.length!==726)fail('SDK49_PRODUCT_SUCCESSOR_ROLE_REQUIRED');
 if(analysis.noStaticEdgeToExcludedFiles!==true||analysis.computedEdgesProven!==false||analysis.NativeAdmission!==false||analysis.SourceAdmission!==false||analysis.activation!==false)fail('SDK49_PRODUCT_SUCCESSOR_ROLE_REQUIRED');
 assertSDK49CanonicalRuntimeManifest(blobs.get('original-ide-auth-runtime-manifest.json'));assertSDK49CanonicalRuntimeManifest(blobs.get('original-ide-contract-relay-runtime-manifest.json'));
 if(selection.kind!=='YNX_SDK49_PRODUCT_PACK_SELECTION/v1'||selection.versionSDK!==sdk.version||auth.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||union.version!==auth.version||!normal&&!daemon&&(receipt.kind!=='YNX_SDK49_COMPLETE_PRODUCT_RUNTIME_PROJECTION/v1'||receipt.versionSDK!==sdk.version))fail('SDK49_PRODUCT_SCHEMA_DIFFERS');
 const policy=documents.get('SDK49_FINITE_EXCLUSION_POLICY.json'),full=normal||daemon?{Auth:receipt.counts?.Auth,union:receipt.counts?.union}:receipt.full,product=normal?{Auth:receipt.counts?.productAuth,union:receipt.counts?.productUnion,selection:receipt.counts?.productSelection}:daemon?{Auth:receipt.counts?.productAuth,union:receipt.counts?.productunion,selection:receipt.counts?.productSelection}:receipt.product;
 if(policy.kind!=='YNX_SDK49_FINITE_PRODUCT_EXCLUSION_POLICY/v1'||policy.versionSDK!==sdk.version||policy.count!==15||(normal?receipt.finiteExclusionCount:daemon?receipt.finiteExcludedFiles:receipt.excludedFiles)!==15||full?.Auth!==counts.fullAuth||full?.union!==counts.fullUnion||product?.Auth!==counts.auth||product?.union!==counts.union||product?.selection!==counts.pack)fail('SDK49_PRODUCT_FINITE_POLICY_DIFFERS');
 // The exact SHA-pinned selection uses supplier locale ordering (e.g. compat/
 // before compat.d.ts), unlike the codepoint-ordered full runtime tables.
 const selected=normal?rows(selection.files,counts.pack):rows(selection.files,counts.pack,false,'path,bytes,sha256'),authRows=rows(auth.files,counts.auth),unionRows=rows(union.files,counts.union),excluded=rows(policy.excluded,15,true,normal?'bytes,path,sha256':'path,bytes,sha256');
 for(const row of [...authRows.values(),...unionRows.values()])if(!equalRow(row,selected.get(row.path)))fail('SDK49_PRODUCT_CLOSURE_INCOMPLETE');
 for(const row of excluded.values())if(selected.has(row.path))fail('SDK49_PRODUCT_EXCLUSION_CONFLICT');
 const lock=(normal?selected:unionRows).get('node_modules/.package-lock.json');if(lock?.bytes!==54707||lock.sha256!=='a6156ecfdededf82c182684e86f00d803b04fc76c6a4b59b27e62ea81983e775')fail('SDK49_PRODUCT_INSTALLED_LOCK_REQUIRED');
 const manifestRows=[],contents=new Map();
 for(const[name,pin]of Object.entries(pins).filter(([,pin])=>pin.fullSHA256)){
  const original=git('show',sourceCommit+':packages/wallet-auth/native/'+name);if(original.length!==pin.fullBytes||hash(original)!==pin.fullSHA256)fail('SDK49_PRODUCT_FULL_CUSTODY_DIFFERS');assertSDK49CanonicalRuntimeManifest(original);
  const packed=SDK_CANONICAL+'/native/'+name;manifestRows.push({path:packed,sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256,originalBytes:pin.fullBytes,originalSHA256:pin.fullSHA256});contents.set(packed,blobs.get(name));
 }
 const publicData=Object.freeze({kind:'YNX-WALLET-SDK49-PRODUCT-PACK/v1',...(normal||daemon?{sourceVariant:normal?SDK49_NORMAL_VARIANT:SDK49_DAEMON_VARIANT}:{}),inputs:Object.entries(pins).map(([name,pin])=>({sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256})),manifestRows,packRows:counts.pack,authRows:counts.auth,unionRows:counts.union,excluded:[...excluded.values()],fullBuildCustodyUnchanged:true,computedEdgesProven:false,SourceQualified:false,Root:false});
 function inputFile(name){if(!relative(name))fail('SDK49_PRODUCT_SOURCE_PATH_INVALID');const file=path.join(root,'packages/wallet-auth',name),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(file)!==file)fail('SDK49_PRODUCT_SOURCE_NOT_REGULAR');return{file,stat};}
 return Object.freeze({public:publicData,manifestRows,contents,selected,authRows,unionRows,excluded,
  prepare(before){
   const old=new Map(before.map(row=>[row.path.startsWith('node_modules/@ynx-chain/wallet-auth/')?SDK_CANONICAL+row.path.slice('node_modules/@ynx-chain/wallet-auth'.length):row.path,row])),missing=new Set(),dataRows=[];
   const buildInputRows=[];
   for(const pin of SDK49_BUILD_INPUT_MANIFESTS){
    const target=SDK_CANONICAL+'/'+pin.path,existing=old.get(target);if(!existing)continue;
    const original=git('show',sourceCommit+':packages/wallet-auth/'+pin.path);
    if(original.length!==pin.bytes||hash(original)!==pin.sha256||existing.type!=='file'||existing.unpacked||existing.executable||!equalRow(existing,pin))fail('SDK49_PRODUCT_BUILD_INPUT_MANIFEST_DIFFERS');
    buildInputRows.push({...pin,path:target});
   }
   for(const row of selected.values()){const target=SDK_CANONICAL+'/'+row.path,existing=old.get(target);let executable=existing?.executable??false;
    if(!existing){const{stat}=inputFile(row.path);if(stat.size!==row.bytes)fail('SDK49_PRODUCT_SOURCE_SIZE_DIFFERS');executable=!!(stat.mode&0o111);missing.add(target);}
    dataRows.push({path:target,type:'file',unpacked:false,executable,physicalMode:null,bytes:row.bytes,sha256:row.sha256});
   }
   return{public:publicData,manifestRows,contents,dataRows,excludedRows:[...[...excluded.values()].map(row=>({...row,path:SDK_CANONICAL+'/'+row.path})),...buildInputRows],missing,
    readAdditional(target){if(!missing.has(target))return undefined;const name=target.slice(SDK_CANONICAL.length+1),row=selected.get(name),{file,stat}=inputFile(name),raw=readFileSync(file),after=lstatSync(file);if(raw.length!==row.bytes||hash(raw)!==row.sha256||['dev','ino','size','mtimeMs','ctimeMs','mode'].some(k=>stat[k]!==after[k]))fail('SDK49_PRODUCT_SOURCE_BYTES_DIFFERS');return raw;}
   };
  }
 });
}
export function assertSDK49ProductArchive(product,inventory){
 if(!product)return;const actual=new Map(inventory.map(row=>[row.path,row])),allowed=new Set([...product.selected.keys()].map(p=>SDK_CANONICAL+'/'+p));
 for(const row of product.manifestRows)allowed.add(row.path);
 for(const name of product.excluded.keys())if(actual.has(SDK_CANONICAL+'/'+name))fail('SDK49_PRODUCT_EXCLUDED_PACK_MEMBER');
 for(const[name,pin]of product.selected){const found=actual.get(SDK_CANONICAL+'/'+name);if(found?.type!=='file'||found.bytes!==pin.bytes||found.sha256!==pin.sha256)fail('SDK49_PRODUCT_PACK_ROW_MISSING_OR_CHANGED');}
 for(const pin of product.manifestRows){const found=actual.get(pin.path);if(found?.type!=='file'||found.bytes!==pin.bytes||found.sha256!==pin.sha256)fail('SDK49_PRODUCT_MANIFEST_NOT_MAPPED');}
 for(const row of inventory)if(row.type!=='directory'&&row.path.startsWith(SDK_CANONICAL+'/')&&!allowed.has(row.path))fail('SDK49_PRODUCT_UNLISTED_PACK_MEMBER');
}

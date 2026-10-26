import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {SDK_CANONICAL} from './canonical-package.mjs';
const base='runtime-projections/sdk49-product/';
// SDK49 normal prefix has no separate legacy build-input tables to exclude.
// Preserve full Native custody separately; product slots use only formal6 pins.
const SDK49_BUILD_INPUT_MANIFESTS=Object.freeze([]);
export const SDK49_PRODUCT_PINS=Object.freeze({
  "PROJECTION_RECEIPT.json": {
    "bytes": 1027,
    "sha256": "7fc1c88899e235526d9439e4f8b8ea1f4c3bb26cd4535899fcca3657c0b63bb2"
  },
  "SDK49_FINITE_EXCLUSION_POLICY.json": {
    "bytes": 2606,
    "sha256": "ac66666ce30de57174293fc2ee79df62e79dac12b067f106288d4e418407d1b6"
  },
  "SDK49_PRODUCT_PACK_SELECTION.json": {
    "bytes": 1489844,
    "sha256": "aec3e06cc03c6b49033a2e9a71d162e23647eb6ae0d59648833e559a5e87cb9b"
  },
  "STATIC_SOURCE_ANALYSIS.json": {
    "bytes": 149137,
    "sha256": "bc16f6ede942a4c1d3cacf06d4249436a5bb1cf8228fd4e21bfdf61875e5ec66"
  },
  "original-ide-auth-runtime-manifest.json": {
    "bytes": 82583,
    "sha256": "0f9ae727304e651aa620e3bb0aaf7a81ad8926dd3d41080b88de0014d5a6bd89",
    "fullBytes": 84020,
    "fullSHA256": "4bdfd990f3cafa14fc98c871306cddaf77e71e9bafda5f1bbc7ca469aa8496ac"
  },
  "original-ide-contract-relay-runtime-manifest.json": {
    "bytes": 1468445,
    "sha256": "959592cbffd854aa04717c3eadb8081baed89ec6e84cd38f13abc34339c63ab9",
    "fullBytes": 1469749,
    "fullSHA256": "70d62d2e1c5ad71661a1647434796aea448dbbb16dd22d4b1addefaf3b01abfc"
  }
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const relative=p=>typeof p==='string'&&p&&!p.startsWith('/')&&!p.includes('\\')&&!p.includes('\0')&&path.posix.normalize(p)===p&&!p.split('/').some(s=>s==='.'||s==='..');
function rows(value,count,ordered=true){
 if(!Array.isArray(value)||value.length!==count)fail('SDK49_PRODUCT_ROWS_INVALID');let previous='';const map=new Map();
 for(const row of value){if(Object.keys(row).join(',')!=='bytes,path,sha256'||!relative(row.path)||ordered&&row.path<=previous||map.has(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>16777216||!/^[a-f0-9]{64}$/.test(row.sha256))fail('SDK49_PRODUCT_ROWS_INVALID');previous=row.path;map.set(row.path,row);}
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
 if(JSON.stringify(present.split('\n').sort())!==JSON.stringify(Object.keys(SDK49_PRODUCT_PINS).map(name=>base+name).sort()))fail('SDK49_PRODUCT_SOURCE_SET_DIFFERS');
 const blobs=new Map(),documents=new Map();
 for(const[name,pin]of Object.entries(SDK49_PRODUCT_PINS)){const raw=git('show',sourceCommit+':'+base+name);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('SDK49_PRODUCT_SOURCE_PIN_DIFFERS');blobs.set(name,raw);documents.set(name,JSON.parse(raw));}
 const selection=documents.get('SDK49_PRODUCT_PACK_SELECTION.json'),auth=documents.get('original-ide-auth-runtime-manifest.json'),union=documents.get('original-ide-contract-relay-runtime-manifest.json'),receipt=documents.get('PROJECTION_RECEIPT.json');
 assertSDK49CanonicalRuntimeManifest(blobs.get('original-ide-auth-runtime-manifest.json'));assertSDK49CanonicalRuntimeManifest(blobs.get('original-ide-contract-relay-runtime-manifest.json'));
 if(selection.kind!=='YNX_SDK49_PRODUCT_PACK_SELECTION/v1'||selection.versionSDK!==sdk.version||auth.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||union.version!==auth.version||receipt.kind!=='YNX_SDK49_COMPLETE_PRODUCT_RUNTIME_PROJECTION/v1'||receipt.versionSDK!==sdk.version)fail('SDK49_PRODUCT_SCHEMA_DIFFERS');
 const policy=documents.get('SDK49_FINITE_EXCLUSION_POLICY.json');if(policy.kind!=='YNX_SDK49_FINITE_PRODUCT_EXCLUSION_POLICY/v1'||policy.versionSDK!==sdk.version||policy.count!==15||receipt.excludedFiles!==15||receipt.full?.Auth!==590||receipt.full?.union!==9450||receipt.product?.Auth!==580||receipt.product?.union!==9441||receipt.product?.selection!==9591)fail('SDK49_PRODUCT_FINITE_POLICY_DIFFERS');
 // The exact SHA-pinned selection uses supplier locale ordering (e.g. compat/
 // before compat.d.ts), unlike the codepoint-ordered full runtime tables.
 const selected=rows(selection.files,9591,false),authRows=rows(auth.files,580),unionRows=rows(union.files,9441),excluded=rows(policy.excluded,15);
 for(const row of [...authRows.values(),...unionRows.values()])if(!equalRow(row,selected.get(row.path)))fail('SDK49_PRODUCT_CLOSURE_INCOMPLETE');
 for(const row of excluded.values())if(selected.has(row.path))fail('SDK49_PRODUCT_EXCLUSION_CONFLICT');
 const lock=unionRows.get('node_modules/.package-lock.json');if(lock?.bytes!==54707||lock.sha256!=='a6156ecfdededf82c182684e86f00d803b04fc76c6a4b59b27e62ea81983e775')fail('SDK49_PRODUCT_INSTALLED_LOCK_REQUIRED');
 const manifestRows=[],contents=new Map();
 for(const[name,pin]of Object.entries(SDK49_PRODUCT_PINS).filter(([,pin])=>pin.fullSHA256)){
  const original=git('show',sourceCommit+':packages/wallet-auth/native/'+name);if(original.length!==pin.fullBytes||hash(original)!==pin.fullSHA256)fail('SDK49_PRODUCT_FULL_CUSTODY_DIFFERS');assertSDK49CanonicalRuntimeManifest(original);
  const packed=SDK_CANONICAL+'/native/'+name;manifestRows.push({path:packed,sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256,originalBytes:pin.fullBytes,originalSHA256:pin.fullSHA256});contents.set(packed,blobs.get(name));
 }
 const publicData=Object.freeze({kind:'YNX-WALLET-SDK49-PRODUCT-PACK/v1',inputs:Object.entries(SDK49_PRODUCT_PINS).map(([name,pin])=>({sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256})),manifestRows,packRows:9591,authRows:580,unionRows:9441,excluded:[...excluded.values()],fullBuildCustodyUnchanged:true,computedEdgesProven:false,SourceQualified:false,Root:false});
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

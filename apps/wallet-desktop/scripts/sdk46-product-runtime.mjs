import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {SDK_CANONICAL} from './canonical-package.mjs';
const base='runtime-projections/sdk46-product/';
// Original supplier's two build-input tables, not the two Native-reader
// product slots. Preserve them in frozen Git; never carry these extra tables
// into the closed 9573+2 product archive or count them as finite-policy rows.
const SDK46_BUILD_INPUT_MANIFESTS=Object.freeze([
 Object.freeze({path:'native/original-auth-runtime-manifest.json',bytes:81401,sha256:'8caa2a369c923c4ad8249c2d897ff4a9882c7f5a58b8a647decd07eeb38ced4a'}),
 Object.freeze({path:'native/walletconnect-runtime-manifest.json',bytes:1566605,sha256:'f069c4299614f2fd5429c65f40f1b0c5d2f0e75389e488be6c4ece8835d72c82'})
]);
export const SDK46_PRODUCT_PINS=Object.freeze({
  "original-ide-auth-runtime-manifest.json": {
    "bytes": 79964,
    "sha256": "3d992d67002544ded8b9b29bff7c6412badac16007735eb3bb320d97bece4438",
    "fullBytes": 81401,
    "fullSHA256": "8caa2a369c923c4ad8249c2d897ff4a9882c7f5a58b8a647decd07eeb38ced4a"
  },
  "original-ide-contract-relay-runtime-manifest.json": {
    "bytes": 1465826,
    "sha256": "8626b70a9754e59cfbea737de937b3e1ffc7277c4d16bd1b0933a01a4080bfcd",
    "fullBytes": 1467130,
    "fullSHA256": "71a388f8459ac084ebdd3c94743536fe333c02fcb95d37a683eec0f31e71c075"
  },
  "SDK46_PRODUCT_PACK_SELECTION.json": {
    "bytes": 1487225,
    "sha256": "f47ab87edb55da2383dff6d9fd8c0e0481a7a76b831e99dd9a1ddb2896d2279a"
  },
  "STATIC_SOURCE_ANALYSIS.json": {
    "bytes": 143479,
    "sha256": "cf23e3c1507c77395ff2427d4848fc54e012528398917773b3ca8c830e7c05d0"
  },
  "PROJECTION_RECEIPT.json": {
    "bytes": 1186,
    "sha256": "e60a7c3d6b1ab06d35bb5c15ace29f3b5e58782d6928bbd5155b2b1e73bab681"
  },
  "SDK46_FINITE_EXCLUSION_POLICY.json": {
    "bytes": 2606,
    "sha256": "f66e51107b1139b8a755fa94eb444d97f52d2afa271b2b0a09612a746b0a5127"
  }
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const relative=p=>typeof p==='string'&&p&&!p.startsWith('/')&&!p.includes('\\')&&!p.includes('\0')&&path.posix.normalize(p)===p&&!p.split('/').some(s=>s==='.'||s==='..');
function rows(value,count){
 if(!Array.isArray(value)||value.length!==count)fail('SDK46_PRODUCT_ROWS_INVALID');let previous='';const map=new Map();
 for(const row of value){if(Object.keys(row).join(',')!=='bytes,path,sha256'||!relative(row.path)||row.path<=previous||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>16777216||!/^[a-f0-9]{64}$/.test(row.sha256))fail('SDK46_PRODUCT_ROWS_INVALID');previous=row.path;map.set(row.path,row);}
 return map;
}
const equalRow=(a,b)=>a&&b&&a.bytes===b.bytes&&a.sha256===b.sha256;
// Match the original normal/Main and Native dictionary readers. A fixed pin
// alone cannot establish their canonical byte contract. Never trim or repair.
export function assertSDK46CanonicalRuntimeManifest(raw){
 let body;try{body=JSON.parse(raw);}catch{fail('SDK46_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS');}
 if(!Buffer.isBuffer(raw)||!body||Array.isArray(body)||Object.keys(body).join(',')!=='files,version'||body.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||!Array.isArray(body.files)||!Buffer.from(JSON.stringify(body)).equals(raw))fail('SDK46_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS');
 return body;
}
/** Fixed build DATA projection. This does not generate a manifest, change a
 * component record or authorize a Source. Missing projection keeps old normal
 * source behavior; its manifest/filter conflicts must still be refused.
 */
export function readSDK46ProductRuntime(root,sourceCommit){
 const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:8<<20});
 const sdk=JSON.parse(git('show',sourceCommit+':packages/wallet-auth/package.json'));if(sdk.version!=='1.3.0-pq.3.32-auth.46')return null;
 const present=git('ls-tree','-r','--name-only',sourceCommit,'--',base).toString().trim();if(!present)return null;
 if(JSON.stringify(present.split('\n').sort())!==JSON.stringify(Object.keys(SDK46_PRODUCT_PINS).map(name=>base+name).sort()))fail('SDK46_PRODUCT_SOURCE_SET_DIFFERS');
 const blobs=new Map(),documents=new Map();
 for(const[name,pin]of Object.entries(SDK46_PRODUCT_PINS)){const raw=git('show',sourceCommit+':'+base+name);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('SDK46_PRODUCT_SOURCE_PIN_DIFFERS');blobs.set(name,raw);documents.set(name,JSON.parse(raw));}
 const selection=documents.get('SDK46_PRODUCT_PACK_SELECTION.json'),auth=documents.get('original-ide-auth-runtime-manifest.json'),union=documents.get('original-ide-contract-relay-runtime-manifest.json'),receipt=documents.get('PROJECTION_RECEIPT.json');
 assertSDK46CanonicalRuntimeManifest(blobs.get('original-ide-auth-runtime-manifest.json'));assertSDK46CanonicalRuntimeManifest(blobs.get('original-ide-contract-relay-runtime-manifest.json'));
 if(selection.kind!=='YNX_SDK46_PRODUCT_PACK_SELECTION/v1'||selection.versionSDK!==sdk.version||auth.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||union.version!==auth.version||receipt.kind!=='YNX_SDK46_PRODUCT_RUNTIME_METADATA_PROJECTION/v1'||receipt.versionSDK!==sdk.version)fail('SDK46_PRODUCT_SCHEMA_DIFFERS');
 const policy=documents.get('SDK46_FINITE_EXCLUSION_POLICY.json');if(policy.kind!=='YNX_SDK46_FINITE_PRODUCT_EXCLUSION_POLICY/v1'||policy.versionSDK!==sdk.version||policy.count!==15||receipt.excludedFiles!==15||receipt.full?.Auth!==572||receipt.full?.union!==9432||receipt.product?.Auth!==562||receipt.product?.union!==9423||receipt.product?.selection!==9573)fail('SDK46_PRODUCT_FINITE_POLICY_DIFFERS');
 const selected=rows(selection.files,9573),authRows=rows(auth.files,562),unionRows=rows(union.files,9423),excluded=rows(policy.excluded,15);
 for(const row of [...authRows.values(),...unionRows.values()])if(!equalRow(row,selected.get(row.path)))fail('SDK46_PRODUCT_CLOSURE_INCOMPLETE');
 for(const row of excluded.values())if(selected.has(row.path))fail('SDK46_PRODUCT_EXCLUSION_CONFLICT');
 const lock=unionRows.get('node_modules/.package-lock.json');if(lock?.bytes!==54706||lock.sha256!=='4bcda46e64a177344da39833571be1c875398fa3b4fc8e6dd12104bfc4e77048')fail('SDK46_PRODUCT_INSTALLED_LOCK_REQUIRED');
 const manifestRows=[],contents=new Map();
 for(const[name,pin]of Object.entries(SDK46_PRODUCT_PINS).filter(([,pin])=>pin.fullSHA256)){
  const original=git('show',sourceCommit+':packages/wallet-auth/native/'+name);if(original.length!==pin.fullBytes||hash(original)!==pin.fullSHA256)fail('SDK46_PRODUCT_FULL_CUSTODY_DIFFERS');assertSDK46CanonicalRuntimeManifest(original);
  const packed=SDK_CANONICAL+'/native/'+name;manifestRows.push({path:packed,sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256,originalBytes:pin.fullBytes,originalSHA256:pin.fullSHA256});contents.set(packed,blobs.get(name));
 }
 const publicData=Object.freeze({kind:'YNX-WALLET-SDK46-PRODUCT-PACK/v1',inputs:Object.entries(SDK46_PRODUCT_PINS).map(([name,pin])=>({sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256})),manifestRows,packRows:9573,authRows:562,unionRows:9423,excluded:[...excluded.values()],fullBuildCustodyUnchanged:true,computedEdgesProven:false,SourceQualified:false,Root:false});
 function inputFile(name){if(!relative(name))fail('SDK46_PRODUCT_SOURCE_PATH_INVALID');const file=path.join(root,'packages/wallet-auth',name),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(file)!==file)fail('SDK46_PRODUCT_SOURCE_NOT_REGULAR');return{file,stat};}
 return Object.freeze({public:publicData,manifestRows,contents,selected,authRows,unionRows,excluded,
  prepare(before){
   const old=new Map(before.map(row=>[row.path.startsWith('node_modules/@ynx-chain/wallet-auth/')?SDK_CANONICAL+row.path.slice('node_modules/@ynx-chain/wallet-auth'.length):row.path,row])),missing=new Set(),dataRows=[];
   const buildInputRows=[];
   for(const pin of SDK46_BUILD_INPUT_MANIFESTS){
    const target=SDK_CANONICAL+'/'+pin.path,existing=old.get(target);if(!existing)continue;
    const original=git('show',sourceCommit+':packages/wallet-auth/'+pin.path);
    if(original.length!==pin.bytes||hash(original)!==pin.sha256||existing.type!=='file'||existing.unpacked||existing.executable||!equalRow(existing,pin))fail('SDK46_PRODUCT_BUILD_INPUT_MANIFEST_DIFFERS');
    buildInputRows.push({...pin,path:target});
   }
   for(const row of selected.values()){const target=SDK_CANONICAL+'/'+row.path,existing=old.get(target);let executable=existing?.executable??false;
    if(!existing){const{stat}=inputFile(row.path);if(stat.size!==row.bytes)fail('SDK46_PRODUCT_SOURCE_SIZE_DIFFERS');executable=!!(stat.mode&0o111);missing.add(target);}
    dataRows.push({path:target,type:'file',unpacked:false,executable,physicalMode:null,bytes:row.bytes,sha256:row.sha256});
   }
   return{public:publicData,manifestRows,contents,dataRows,excludedRows:[...[...excluded.values()].map(row=>({...row,path:SDK_CANONICAL+'/'+row.path})),...buildInputRows],missing,
    readAdditional(target){if(!missing.has(target))return undefined;const name=target.slice(SDK_CANONICAL.length+1),row=selected.get(name),{file,stat}=inputFile(name),raw=readFileSync(file),after=lstatSync(file);if(raw.length!==row.bytes||hash(raw)!==row.sha256||['dev','ino','size','mtimeMs','ctimeMs','mode'].some(k=>stat[k]!==after[k]))fail('SDK46_PRODUCT_SOURCE_BYTES_DIFFERS');return raw;}
   };
  }
 });
}
export function assertSDK46ProductArchive(product,inventory){
 if(!product)return;const actual=new Map(inventory.map(row=>[row.path,row])),allowed=new Set([...product.selected.keys()].map(p=>SDK_CANONICAL+'/'+p));
 for(const row of product.manifestRows)allowed.add(row.path);
 for(const name of product.excluded.keys())if(actual.has(SDK_CANONICAL+'/'+name))fail('SDK46_PRODUCT_EXCLUDED_PACK_MEMBER');
 for(const[name,pin]of product.selected){const found=actual.get(SDK_CANONICAL+'/'+name);if(found?.type!=='file'||found.bytes!==pin.bytes||found.sha256!==pin.sha256)fail('SDK46_PRODUCT_PACK_ROW_MISSING_OR_CHANGED');}
 for(const pin of product.manifestRows){const found=actual.get(pin.path);if(found?.type!=='file'||found.bytes!==pin.bytes||found.sha256!==pin.sha256)fail('SDK46_PRODUCT_MANIFEST_NOT_MAPPED');}
 for(const row of inventory)if(row.type!=='directory'&&row.path.startsWith(SDK_CANONICAL+'/')&&!allowed.has(row.path))fail('SDK46_PRODUCT_UNLISTED_PACK_MEMBER');
}

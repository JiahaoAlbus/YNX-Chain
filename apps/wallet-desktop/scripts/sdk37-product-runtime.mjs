import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {SDK_CANONICAL} from './canonical-package.mjs';
const base='runtime-projections/sdk37-product/';
export const SDK37_PRODUCT_PINS=Object.freeze({
 'original-ide-auth-runtime-manifest.json':{bytes:79115,sha256:'6f41a361e1fe616669ca4a547a3f3ce67a85fb0b9302cc4c6dcdd919756e3298',fullBytes:80552,fullSHA256:'fbda1cf6569b31d9014c1124818cd3f1adc8dc15e2f8dbbaeb68ad9fdf91c7ab'},
 'original-ide-contract-relay-runtime-manifest.json':{bytes:1464977,sha256:'96cfb79aabded681111266af52c0215b6ed7c707ce6a578394fc10cc49f03b32',fullBytes:1466281,fullSHA256:'a9e6c4469e797855b0afc2fa4e73c56b347ece595a377ddaaa4ee1e4175d7d0d'},
 'SDK37_PRODUCT_PACK_SELECTION.json':{bytes:1486242,sha256:'7d3a14192875f99593bcf47aaf4fe7c763754d9dfd823640bbf7f7737e7bb80d'},
 'PROJECTION_RECEIPT.json':{bytes:5601,sha256:'1c30d07c760d2e19fc0a85dce0d04cc5ee304104ad57b46c071c7b16025625a0'},
 'SDK37_FINITE_EXCLUSION_POLICY.json':{bytes:3013,sha256:'55a2dece3fa0aa55290e0347deb2a7775ff4b28509fdb6130e892b72117ef8c6'},
 'STATIC_SOURCE_ANALYSIS.json':{bytes:139541,sha256:'b2a868fe56440f77dda46a2cd30f21e06013794df9fb555e4754d4b63f119f8e'}
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const relative=p=>typeof p==='string'&&p&&!p.startsWith('/')&&!p.includes('\\')&&!p.includes('\0')&&path.posix.normalize(p)===p&&!p.split('/').some(s=>s==='.'||s==='..');
function rows(value,count){
 if(!Array.isArray(value)||value.length!==count)fail('SDK37_PRODUCT_ROWS_INVALID');let previous='';const map=new Map();
 for(const row of value){if(Object.keys(row).join(',')!=='bytes,path,sha256'||!relative(row.path)||row.path<=previous||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>16777216||!/^[a-f0-9]{64}$/.test(row.sha256))fail('SDK37_PRODUCT_ROWS_INVALID');previous=row.path;map.set(row.path,row);}
 return map;
}
const equalRow=(a,b)=>a&&b&&a.bytes===b.bytes&&a.sha256===b.sha256;
// Match the original normal/Main and Native dictionary readers. A fixed pin
// alone cannot establish their canonical byte contract. Never trim or repair.
export function assertSDK37CanonicalRuntimeManifest(raw){
 let body;try{body=JSON.parse(raw);}catch{fail('SDK37_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS');}
 if(!Buffer.isBuffer(raw)||!body||Array.isArray(body)||Object.keys(body).join(',')!=='files,version'||body.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||!Array.isArray(body.files)||!Buffer.from(JSON.stringify(body)).equals(raw))fail('SDK37_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS');
 return body;
}
/** Fixed build DATA projection. This does not generate a manifest, change a
 * component record or authorize a Source. Missing projection keeps old normal
 * source behavior; its manifest/filter conflicts must still be refused.
 */
export function readSDK37ProductRuntime(root,sourceCommit){
 const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:8<<20});
 const sdk=JSON.parse(git('show',sourceCommit+':packages/wallet-auth/package.json'));if(sdk.version!=='1.3.0-pq.3.32-auth.37')return null;
 const present=git('ls-tree','-r','--name-only',sourceCommit,'--',base).toString().trim();if(!present)return null;
 if(JSON.stringify(present.split('\n').sort())!==JSON.stringify(Object.keys(SDK37_PRODUCT_PINS).map(name=>base+name).sort()))fail('SDK37_PRODUCT_SOURCE_SET_DIFFERS');
 const blobs=new Map(),documents=new Map();
 for(const[name,pin]of Object.entries(SDK37_PRODUCT_PINS)){const raw=git('show',sourceCommit+':'+base+name);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('SDK37_PRODUCT_SOURCE_PIN_DIFFERS');blobs.set(name,raw);documents.set(name,JSON.parse(raw));}
 const selection=documents.get('SDK37_PRODUCT_PACK_SELECTION.json'),auth=documents.get('original-ide-auth-runtime-manifest.json'),union=documents.get('original-ide-contract-relay-runtime-manifest.json'),receipt=documents.get('PROJECTION_RECEIPT.json');
 assertSDK37CanonicalRuntimeManifest(blobs.get('original-ide-auth-runtime-manifest.json'));assertSDK37CanonicalRuntimeManifest(blobs.get('original-ide-contract-relay-runtime-manifest.json'));
 if(selection.kind!=='YNX_SDK37_PRODUCT_PACK_SELECTION/v1'||selection.versionSDK!==sdk.version||auth.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||union.version!==auth.version||receipt.kind!=='YNX_SDK37_PRODUCT_RUNTIME_METADATA_PROJECTION/v1'||receipt.versionSDK!==sdk.version)fail('SDK37_PRODUCT_SCHEMA_DIFFERS');
 const policy=documents.get('SDK37_FINITE_EXCLUSION_POLICY.json');if(policy.kind!=='YNX_SDK37_FINITE_PRODUCT_EXCLUSION_POLICY/v1'||policy.versionSDK!==sdk.version||JSON.stringify(policy.excluded)!==JSON.stringify(receipt.excluded))fail('SDK37_PRODUCT_FINITE_POLICY_DIFFERS');
 const selected=rows(selection.files,9566),authRows=rows(auth.files,556),unionRows=rows(union.files,9417),excluded=rows(receipt.excluded,15);
 for(const row of [...authRows.values(),...unionRows.values()])if(!equalRow(row,selected.get(row.path)))fail('SDK37_PRODUCT_CLOSURE_INCOMPLETE');
 for(const row of excluded.values())if(selected.has(row.path))fail('SDK37_PRODUCT_EXCLUSION_CONFLICT');
 const lock=unionRows.get('node_modules/.package-lock.json');if(lock?.bytes!==54706||lock.sha256!=='4bcda46e64a177344da39833571be1c875398fa3b4fc8e6dd12104bfc4e77048')fail('SDK37_PRODUCT_INSTALLED_LOCK_REQUIRED');
 const manifestRows=[],contents=new Map();
 for(const[name,pin]of Object.entries(SDK37_PRODUCT_PINS).filter(([,pin])=>pin.fullSHA256)){
  const original=git('show',sourceCommit+':packages/wallet-auth/native/'+name);if(original.length!==pin.fullBytes||hash(original)!==pin.fullSHA256)fail('SDK37_PRODUCT_FULL_CUSTODY_DIFFERS');assertSDK37CanonicalRuntimeManifest(original);
  const packed=SDK_CANONICAL+'/native/'+name;manifestRows.push({path:packed,sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256,originalBytes:pin.fullBytes,originalSHA256:pin.fullSHA256});contents.set(packed,blobs.get(name));
 }
 const publicData=Object.freeze({kind:'YNX-WALLET-SDK37-PRODUCT-PACK/v1',inputs:Object.entries(SDK37_PRODUCT_PINS).map(([name,pin])=>({sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256})),manifestRows,packRows:9566,authRows:556,unionRows:9417,excluded:[...excluded.values()],fullBuildCustodyUnchanged:true,computedEdgesProven:false,SourceQualified:false,Root:false});
 function inputFile(name){if(!relative(name))fail('SDK37_PRODUCT_SOURCE_PATH_INVALID');const file=path.join(root,'packages/wallet-auth',name),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(file)!==file)fail('SDK37_PRODUCT_SOURCE_NOT_REGULAR');return{file,stat};}
 return Object.freeze({public:publicData,manifestRows,contents,selected,authRows,unionRows,excluded,
  prepare(before){
   const old=new Map(before.map(row=>[row.path.startsWith('node_modules/@ynx-chain/wallet-auth/')?SDK_CANONICAL+row.path.slice('node_modules/@ynx-chain/wallet-auth'.length):row.path,row])),missing=new Set(),dataRows=[];
   for(const row of selected.values()){const target=SDK_CANONICAL+'/'+row.path,existing=old.get(target);let executable=existing?.executable??false;
    if(!existing){const{stat}=inputFile(row.path);if(stat.size!==row.bytes)fail('SDK37_PRODUCT_SOURCE_SIZE_DIFFERS');executable=!!(stat.mode&0o111);missing.add(target);}
    dataRows.push({path:target,type:'file',unpacked:false,executable,physicalMode:null,bytes:row.bytes,sha256:row.sha256});
   }
   return{public:publicData,manifestRows,contents,dataRows,excludedRows:[...excluded.values()].map(row=>({...row,path:SDK_CANONICAL+'/'+row.path})),missing,
    readAdditional(target){if(!missing.has(target))return undefined;const name=target.slice(SDK_CANONICAL.length+1),row=selected.get(name),{file,stat}=inputFile(name),raw=readFileSync(file),after=lstatSync(file);if(raw.length!==row.bytes||hash(raw)!==row.sha256||['dev','ino','size','mtimeMs','ctimeMs','mode'].some(k=>stat[k]!==after[k]))fail('SDK37_PRODUCT_SOURCE_BYTES_DIFFERS');return raw;}
   };
  }
 });
}
export function assertSDK37ProductArchive(product,inventory){
 if(!product)return;const actual=new Map(inventory.map(row=>[row.path,row])),allowed=new Set([...product.selected.keys()].map(p=>SDK_CANONICAL+'/'+p));
 for(const row of product.manifestRows)allowed.add(row.path);
 for(const name of product.excluded.keys())if(actual.has(SDK_CANONICAL+'/'+name))fail('SDK37_PRODUCT_EXCLUDED_PACK_MEMBER');
 for(const[name,pin]of product.selected){const found=actual.get(SDK_CANONICAL+'/'+name);if(found?.type!=='file'||found.bytes!==pin.bytes||found.sha256!==pin.sha256)fail('SDK37_PRODUCT_PACK_ROW_MISSING_OR_CHANGED');}
 for(const pin of product.manifestRows){const found=actual.get(pin.path);if(found?.type!=='file'||found.bytes!==pin.bytes||found.sha256!==pin.sha256)fail('SDK37_PRODUCT_MANIFEST_NOT_MAPPED');}
 for(const row of inventory)if(row.type!=='directory'&&row.path.startsWith(SDK_CANONICAL+'/')&&!allowed.has(row.path))fail('SDK37_PRODUCT_UNLISTED_PACK_MEMBER');
}

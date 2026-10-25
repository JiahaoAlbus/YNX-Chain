import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {SDK_CANONICAL} from './canonical-package.mjs';
const base='runtime-projections/sdk40-product/';
export const SDK40_PRODUCT_PINS=Object.freeze({
 'original-ide-auth-runtime-manifest.json':{bytes:79256,sha256:'1aee8c1d88905094262662389a9d735b2f0864152c3651509dfdcd7750e9c33c',fullBytes:80693,fullSHA256:'36f643feda5c9492a01f0779e78e67b83ef289384d1d5837b7529165cb39a61e'},
 'original-ide-contract-relay-runtime-manifest.json':{bytes:1465118,sha256:'d26d2046522bc4efd18cc021e71f18b42898dd2f0aae191713cb97cd1347a2bf',fullBytes:1466422,fullSHA256:'e6b9b6a8b2ea43779f57b2c0a820654256d96df4e1867399d70866d946ba72ea'},
 'SDK40_PRODUCT_PACK_SELECTION.json':{bytes:1486517,sha256:'83ce738bb27270ce6d5af8cefb779375f96008507e1c139b2d95b0bc625eca56'},
 'PROJECTION_RECEIPT.json':{bytes:5291,sha256:'02bad03b77577cb8e7f8a5c14abd677c306c0416fa31b7a77440fa1665a3bce8'},
 'SDK40_FINITE_EXCLUSION_POLICY.json':{bytes:2516,sha256:'8bab76bb836cacb91bf9ac6df3b3bc6d49ed6aec939ac7a7b3eea81d4e1d7025'},
 'STATIC_SOURCE_ANALYSIS.json':{bytes:141469,sha256:'f7af4d458d76573b294f0722f7aa44b4581db32ecbd87848ae78c97c1b23a164'}
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const relative=p=>typeof p==='string'&&p&&!p.startsWith('/')&&!p.includes('\\')&&!p.includes('\0')&&path.posix.normalize(p)===p&&!p.split('/').some(s=>s==='.'||s==='..');
function rows(value,count){
 if(!Array.isArray(value)||value.length!==count)fail('SDK40_PRODUCT_ROWS_INVALID');let previous='';const map=new Map();
 for(const row of value){if(Object.keys(row).join(',')!=='bytes,path,sha256'||!relative(row.path)||row.path<=previous||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>16777216||!/^[a-f0-9]{64}$/.test(row.sha256))fail('SDK40_PRODUCT_ROWS_INVALID');previous=row.path;map.set(row.path,row);}
 return map;
}
const equalRow=(a,b)=>a&&b&&a.bytes===b.bytes&&a.sha256===b.sha256;
// Match the original normal/Main and Native dictionary readers. A fixed pin
// alone cannot establish their canonical byte contract. Never trim or repair.
export function assertSDK40CanonicalRuntimeManifest(raw){
 let body;try{body=JSON.parse(raw);}catch{fail('SDK40_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS');}
 if(!Buffer.isBuffer(raw)||!body||Array.isArray(body)||Object.keys(body).join(',')!=='files,version'||body.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||!Array.isArray(body.files)||!Buffer.from(JSON.stringify(body)).equals(raw))fail('SDK40_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS');
 return body;
}
/** Fixed build DATA projection. This does not generate a manifest, change a
 * component record or authorize a Source. Missing projection keeps old normal
 * source behavior; its manifest/filter conflicts must still be refused.
 */
export function readSDK40ProductRuntime(root,sourceCommit){
 const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:8<<20});
 const sdk=JSON.parse(git('show',sourceCommit+':packages/wallet-auth/package.json'));if(sdk.version!=='1.3.0-pq.3.32-auth.40')return null;
 const present=git('ls-tree','-r','--name-only',sourceCommit,'--',base).toString().trim();if(!present)return null;
 if(JSON.stringify(present.split('\n').sort())!==JSON.stringify(Object.keys(SDK40_PRODUCT_PINS).map(name=>base+name).sort()))fail('SDK40_PRODUCT_SOURCE_SET_DIFFERS');
 const blobs=new Map(),documents=new Map();
 for(const[name,pin]of Object.entries(SDK40_PRODUCT_PINS)){const raw=git('show',sourceCommit+':'+base+name);if(raw.length!==pin.bytes||hash(raw)!==pin.sha256)fail('SDK40_PRODUCT_SOURCE_PIN_DIFFERS');blobs.set(name,raw);documents.set(name,JSON.parse(raw));}
 const selection=documents.get('SDK40_PRODUCT_PACK_SELECTION.json'),auth=documents.get('original-ide-auth-runtime-manifest.json'),union=documents.get('original-ide-contract-relay-runtime-manifest.json'),receipt=documents.get('PROJECTION_RECEIPT.json');
 assertSDK40CanonicalRuntimeManifest(blobs.get('original-ide-auth-runtime-manifest.json'));assertSDK40CanonicalRuntimeManifest(blobs.get('original-ide-contract-relay-runtime-manifest.json'));
 if(selection.kind!=='YNX_SDK40_PRODUCT_PACK_SELECTION/v1'||selection.versionSDK!==sdk.version||auth.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||union.version!==auth.version||receipt.kind!=='YNX_SDK40_PRODUCT_RUNTIME_METADATA_PROJECTION/v1'||receipt.versionSDK!==sdk.version)fail('SDK40_PRODUCT_SCHEMA_DIFFERS');
 const policy=documents.get('SDK40_FINITE_EXCLUSION_POLICY.json');if(policy.kind!=='YNX_SDK40_FINITE_PRODUCT_EXCLUSION_POLICY/v1'||policy.versionSDK!==sdk.version||JSON.stringify(policy.excluded)!==JSON.stringify(receipt.excluded))fail('SDK40_PRODUCT_FINITE_POLICY_DIFFERS');
 const selected=rows(selection.files,9568),authRows=rows(auth.files,557),unionRows=rows(union.files,9418),excluded=rows(receipt.excluded,15);
 for(const row of [...authRows.values(),...unionRows.values()])if(!equalRow(row,selected.get(row.path)))fail('SDK40_PRODUCT_CLOSURE_INCOMPLETE');
 for(const row of excluded.values())if(selected.has(row.path))fail('SDK40_PRODUCT_EXCLUSION_CONFLICT');
 const lock=unionRows.get('node_modules/.package-lock.json');if(lock?.bytes!==54706||lock.sha256!=='4bcda46e64a177344da39833571be1c875398fa3b4fc8e6dd12104bfc4e77048')fail('SDK40_PRODUCT_INSTALLED_LOCK_REQUIRED');
 const manifestRows=[],contents=new Map();
 for(const[name,pin]of Object.entries(SDK40_PRODUCT_PINS).filter(([,pin])=>pin.fullSHA256)){
  const original=git('show',sourceCommit+':packages/wallet-auth/native/'+name);if(original.length!==pin.fullBytes||hash(original)!==pin.fullSHA256)fail('SDK40_PRODUCT_FULL_CUSTODY_DIFFERS');assertSDK40CanonicalRuntimeManifest(original);
  const packed=SDK_CANONICAL+'/native/'+name;manifestRows.push({path:packed,sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256,originalBytes:pin.fullBytes,originalSHA256:pin.fullSHA256});contents.set(packed,blobs.get(name));
 }
 const publicData=Object.freeze({kind:'YNX-WALLET-SDK40-PRODUCT-PACK/v1',inputs:Object.entries(SDK40_PRODUCT_PINS).map(([name,pin])=>({sourcePath:base+name,bytes:pin.bytes,sha256:pin.sha256})),manifestRows,packRows:9568,authRows:557,unionRows:9418,excluded:[...excluded.values()],fullBuildCustodyUnchanged:true,computedEdgesProven:false,SourceQualified:false,Root:false});
 function inputFile(name){if(!relative(name))fail('SDK40_PRODUCT_SOURCE_PATH_INVALID');const file=path.join(root,'packages/wallet-auth',name),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(file)!==file)fail('SDK40_PRODUCT_SOURCE_NOT_REGULAR');return{file,stat};}
 return Object.freeze({public:publicData,manifestRows,contents,selected,authRows,unionRows,excluded,
  prepare(before){
   const old=new Map(before.map(row=>[row.path.startsWith('node_modules/@ynx-chain/wallet-auth/')?SDK_CANONICAL+row.path.slice('node_modules/@ynx-chain/wallet-auth'.length):row.path,row])),missing=new Set(),dataRows=[];
   for(const row of selected.values()){const target=SDK_CANONICAL+'/'+row.path,existing=old.get(target);let executable=existing?.executable??false;
    if(!existing){const{stat}=inputFile(row.path);if(stat.size!==row.bytes)fail('SDK40_PRODUCT_SOURCE_SIZE_DIFFERS');executable=!!(stat.mode&0o111);missing.add(target);}
    dataRows.push({path:target,type:'file',unpacked:false,executable,physicalMode:null,bytes:row.bytes,sha256:row.sha256});
   }
   return{public:publicData,manifestRows,contents,dataRows,excludedRows:[...excluded.values()].map(row=>({...row,path:SDK_CANONICAL+'/'+row.path})),missing,
    readAdditional(target){if(!missing.has(target))return undefined;const name=target.slice(SDK_CANONICAL.length+1),row=selected.get(name),{file,stat}=inputFile(name),raw=readFileSync(file),after=lstatSync(file);if(raw.length!==row.bytes||hash(raw)!==row.sha256||['dev','ino','size','mtimeMs','ctimeMs','mode'].some(k=>stat[k]!==after[k]))fail('SDK40_PRODUCT_SOURCE_BYTES_DIFFERS');return raw;}
   };
  }
 });
}
export function assertSDK40ProductArchive(product,inventory){
 if(!product)return;const actual=new Map(inventory.map(row=>[row.path,row])),allowed=new Set([...product.selected.keys()].map(p=>SDK_CANONICAL+'/'+p));
 for(const row of product.manifestRows)allowed.add(row.path);
 for(const name of product.excluded.keys())if(actual.has(SDK_CANONICAL+'/'+name))fail('SDK40_PRODUCT_EXCLUDED_PACK_MEMBER');
 for(const[name,pin]of product.selected){const found=actual.get(SDK_CANONICAL+'/'+name);if(found?.type!=='file'||found.bytes!==pin.bytes||found.sha256!==pin.sha256)fail('SDK40_PRODUCT_PACK_ROW_MISSING_OR_CHANGED');}
 for(const pin of product.manifestRows){const found=actual.get(pin.path);if(found?.type!=='file'||found.bytes!==pin.bytes||found.sha256!==pin.sha256)fail('SDK40_PRODUCT_MANIFEST_NOT_MAPPED');}
 for(const row of inventory)if(row.type!=='directory'&&row.path.startsWith(SDK_CANONICAL+'/')&&!allowed.has(row.path))fail('SDK40_PRODUCT_UNLISTED_PACK_MEMBER');
}

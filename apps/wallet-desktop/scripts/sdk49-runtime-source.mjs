import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SDK49_DAEMON_AUTH,SDK49_DAEMON_UNION} from './sdk49-daemon-profile.mjs';
export const SDK49_VERSION='1.3.0-pq.3.32-auth.49';
export const SDK49_SOURCE_COMMIT='ef7493e6718ac7edc11e7d7cbf8f5812313cbf05';
export const SDK49_SOURCE_VARIANT='SDK49-NATIVE-READ-LEASE-ISSUER/v1';
export const SDK49_PREFIX_INVENTORY=Object.freeze({bytes:1820524,sha256:'885606ac06d63f7ff71734225e912843417a5270501145e1a58cf4dd7a2fde43'});
export const SDK49_FULL_AUTH=Object.freeze({bytes:85049,sha256:'b5c5a2f53babe1354733c9958f30962ea5af3ab0fdbf862c86a4541d1f472d1d',files:597,totalBytes:7850712});
export const SDK49_FULL_UNION=Object.freeze({bytes:1470778,sha256:'de0cfa0bbccb7338c2f35e8326c4a739b1273293e55c162e2b211fd6172104e7',files:9457,totalBytes:78060924});
const fail=()=>{throw Error('WALLET_SDK49_COHERENT_SOURCE_REQUIRED');};
const sha=b=>createHash('sha256').update(b).digest('hex');
const matches=(bytes,pin)=>Buffer.isBuffer(bytes)&&bytes.length===pin.bytes&&sha(bytes)===pin.sha256;
const relative=p=>typeof p==='string'&&p&&path.posix.normalize(p)===p&&!path.posix.isAbsolute(p)&&!p.includes('\\')&&!p.includes('\0')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
function table(raw,pin){
 if(!matches(raw,pin))fail();const j=JSON.parse(raw);
 if(Object.keys(j).join(',')!=='files,version'||j.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||!Buffer.from(JSON.stringify(j)).equals(raw)||j.files.length!==pin.files||j.files.reduce((s,r)=>s+r.bytes,0)!==pin.totalBytes)fail();
 let previous='';for(const row of j.files){if(Object.keys(row).join(',')!=='bytes,path,sha256'||!relative(row.path)||row.path<=previous||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>16777216||!/^[a-f0-9]{64}$/.test(row.sha256))fail();previous=row.path;}
 return j;
}
export function verifySDK49FullRuntimeTables(authRaw,unionRaw){
 const daemon=matches(unionRaw,SDK49_DAEMON_UNION),authPin=daemon?SDK49_DAEMON_AUTH:SDK49_FULL_AUTH,unionPin=daemon?SDK49_DAEMON_UNION:SDK49_FULL_UNION;
 const auth=table(authRaw,authPin),union=table(unionRaw,unionPin),rows=new Map(union.files.map(r=>[r.path,r]));
 for(const row of auth.files){const found=rows.get(row.path);if(!found||found.bytes!==row.bytes||found.sha256!==row.sha256)fail();}
 return {authFiles:authPin.files,unionFiles:unionPin.files,fullAuthSubsetOfFullUnion:true,NativeAdmission:false};
}
function read(root,name,pin){
 if(!relative(name))fail();const file=path.join(root,name),before=fs.lstatSync(file);
 if(!before.isFile()||before.isSymbolicLink()||fs.realpathSync(file)!==file)fail();const raw=fs.readFileSync(file),after=fs.lstatSync(file);
 if(!matches(raw,pin)||['dev','ino','size','mode','uid','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k]))fail();return raw;
}
/** Validate normal supplier DATA/source bytes only. No import aliases, Native
 * execution, manifest replacement, issuer or build/admission qualification. */
export function verifySDK49NormalSource(root,inventoryRaw){
 if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root||fs.realpathSync(root)!==root||!matches(inventoryRaw,SDK49_PREFIX_INVENTORY))fail();
 const inventory=JSON.parse(inventoryRaw);
 if(inventory.versionSDK!==SDK49_VERSION||inventory.sourceCommit!==SDK49_SOURCE_COMMIT||inventory.sourceVariant!==SDK49_SOURCE_VARIANT||inventory.fileCount!==9613||inventory.files?.length!==9613)fail();
 const seen=new Set();for(const row of inventory.files){if(!relative(row.path)||seen.has(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<0||!/^[a-f0-9]{64}$/.test(row.sha256))fail();seen.add(row.path);read(root,row.path,row);}
 // The formal CAS supplies these two full Native source slots separately
 // from the normal prefix. They are not product projections or prefix rows.
 const authName='native/original-ide-auth-runtime-manifest.json',unionName='native/original-ide-contract-relay-runtime-manifest.json';
 if(seen.has(authName)||seen.has(unionName))fail();
 verifySDK49FullRuntimeTables(read(root,authName,SDK49_FULL_AUTH),read(root,unionName,SDK49_FULL_UNION));seen.add(authName);seen.add(unionName);
 const list=(dir,prefix='')=>fs.readdirSync(path.join(dir,prefix),{withFileTypes:true}).flatMap(e=>{const name=prefix?prefix+'/'+e.name:e.name;if(e.isDirectory())return list(dir,name);if(!e.isFile())fail();return [name];});
 if(JSON.stringify(list(root).sort())!==JSON.stringify([...seen].sort()))fail();
 if(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version!==SDK49_VERSION)fail();
 return Object.freeze({version:SDK49_VERSION,sourceCommit:SDK49_SOURCE_COMMIT,sourceVariant:SDK49_SOURCE_VARIANT,normalPrefixFiles:9613,formalFullSourceManifests:2,materializedFiles:9615,NativeAdmission:false,SourceAdmission:false,issuerSupplied:false,AppBuilt:false,installed:false});
}

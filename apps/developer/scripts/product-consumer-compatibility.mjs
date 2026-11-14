import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,posix} from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validPath=path=>typeof path==='string'&&!path.startsWith('/')&&!path.includes('\\')&&posix.normalize(path)===path&&!path.split('/').some(part=>part==='..'||!part);
// Build DATA only, not a Source verifier or image/identity admission API.
export function assertCurrentNativeConsumerMapping(expected,supplierRows){
 const actual=new Map();
 for(const row of supplierRows){if(!validPath(row.relativePath)||actual.has(row.relativePath))throw Error('Ambiguous supplier source mapping');actual.set(row.relativePath,row);}
 const native=expected.filter(row=>row.role==='current own native source/header');
 if(!native.some(row=>row.relativePath.endsWith('/main.m'))||!native.some(row=>row.relativePath.endsWith('/ynx-wallet-admission-parent.m')))throw Error('Current native consumer pins are incomplete');
 for(const row of native){const got=actual.get(row.relativePath);if(!got||got.bytes!==row.bytes||got.sha256!==row.sha256)throw Error('Historical or changed native consumer: '+row.relativePath);}
 return native;
}
async function verifyFile(row){
 const s=await lstat(row.path);if(!s.isFile()||s.isSymbolicLink()||await realpath(row.path)!==row.path||s.size!==row.bytes)throw Error('Consumer input identity changed');const b=await readFile(row.path);if(sha(b)!==row.sha256)throw Error('Consumer input bytes changed');
}
export async function verifyCurrentConsumerInputs(contract,sourceRoot,supplierRows){
 if(contract.schema!=='YNX_P03_CURRENT_PRODUCT_CONSUMER_INPUTS/v1'||!Array.isArray(contract.files))throw Error('Exact current product consumer packet required');
 const records=contract.files.map(({relativePath,bytes,sha256})=>({relativePath,bytes,sha256}));
 if(sha(Buffer.from(JSON.stringify(records)))!==contract.consumerInputDigest||new Set(records.map(row=>row.relativePath)).size!==records.length||records.some(row=>!validPath(row.relativePath)))throw Error('Consumer packet digest differs');
 for(const row of contract.files)await verifyFile({...row,path:join(sourceRoot,row.relativePath)});
 const mapped=assertCurrentNativeConsumerMapping(contract.files,supplierRows);
 for(const expected of mapped)await verifyFile(supplierRows.find(row=>row.relativePath===expected.relativePath));
 return {consumerAbiOriginCommit:contract.consumerSourceCommit,consumerInputDigest:contract.consumerInputDigest,nativeLeaves:mapped.length,callerLeaves:contract.files.length-mapped.length,SourceAdmission:false,NativeAdmission:false};
}

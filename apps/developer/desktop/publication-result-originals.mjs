import {readFile,realpath} from 'node:fs/promises';
import {dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const fail=code=>{throw Object.assign(Error('Original publication result DATA is unavailable or mismatched.'),{code});};
function copy(value,cap=262144){
 try{if(!(value instanceof Uint8Array)||!(value.buffer instanceof ArrayBuffer)||value.buffer.resizable||value.byteLength<1||value.byteLength>cap)fail('IDE_PUBLICATION_RESULT_ARGUMENTS');return new Uint8Array(value);}
 catch(error){if(error?.code)throw error;fail('IDE_PUBLICATION_RESULT_ARGUMENTS');}
}
const encode=value=>new TextEncoder().encode(value);
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function captured(input){
 if(!input||![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail('IDE_PUBLICATION_RESULT_ARGUMENTS');
 const descriptors=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(descriptors),expected=['resultOriginal','expectedRequestOriginal','expectedManifestOriginal'];
 if(keys.length!==3||keys.some(k=>!expected.includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable))fail('IDE_PUBLICATION_RESULT_ARGUMENTS');
 const value=Object.fromEntries(expected.map(k=>[k,descriptors[k].value]));
 for(const k of expected.slice(1))if(typeof value[k]!=='string'||encode(value[k]).length<1||encode(value[k]).length>16384||new TextDecoder('utf-8',{fatal:true}).decode(encode(value[k]))!==value[k])fail('IDE_PUBLICATION_RESULT_ARGUMENTS');
 return {...value,resultOriginal:copy(value.resultOriginal)};
}
function decoded(input,decode){
 if(typeof decode!=='function')fail('IDE_PUBLICATION_RESULT_NOT_SUPPLIED');
 // The SDK owns the existing Native wire schema/duplicates/base64 decoder.
 // Isolate even a foreign decoder's argument from our retained original bytes.
 const value=decode(new Uint8Array(input.resultOriginal));
 if(!value||value.version!=='YNX-IDE-ARTIFACT-RELEASE-RESULT/v1'||value.purpose!=='ARTIFACT-RELEASE'||value.dataOnly!==true
  ||['signatureVerified','trusted','authorized','nativeAdmission','registered','current','approvalCurrent','publicationAuthorized'].some(k=>value[k]!==false)
  ||Object.hasOwn(value,'proofOriginal'))fail('IDE_PUBLICATION_RESULT_INVALID');
 if(value.requestOriginal!==input.expectedRequestOriginal||value.manifestOriginal!==input.expectedManifestOriginal||value.invocationOriginal!==input.expectedManifestOriginal
  ||!same(copy(value.resultOriginal),input.resultOriginal)
  ||!same(copy(value.requestOriginalBytes,16384),encode(input.expectedRequestOriginal))
  ||!same(copy(value.manifestOriginalBytes,16384),encode(input.expectedManifestOriginal))
  ||!same(copy(value.invocationOriginalBytes,16384),encode(input.expectedManifestOriginal)))fail('IDE_PUBLICATION_RESULT_BINDING_INVALID');
 // Return the official DATA DTO, never another receipt/proof/envelope. Use its
 // .resultOriginal for raw result hashing/transport, not JSON.stringify(DTO).
 // .signatureOriginalBytes is a whole member decoded once, never a proof.
 return value;
}
// Pure DATA boundary for controlled tests. Only the fixed loader below is used
// by the production consumer; this callback cannot supply a Native/Source grant.
export function decodeOriginalPublicationResultData(input,decode){return decoded(captured(input),decode);}
function originalTransport(value){
 // Auth's explicit transport contract, not the SDK DTO and not a proof. The
 // outer JSON may be encoded normally; decoding this string must recover the
 // exact retained Native UTF8 bytes. Never serialize the parsed inner DTO.
 return Object.freeze({version:'YNX-IDE-PUBLICATION-INPUT/v1',
  requestOriginal:value.requestOriginal,
  resultOriginal:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(copy(value.resultOriginal)),
  invocationOriginal:value.invocationOriginal,
  signatureOriginal:value.signatureOriginal,actualApprovalRef:value.actualApprovalRef});
}
export function createOriginalPublicationInputData(input,decode){return originalTransport(decodeOriginalPublicationResultData(input,decode));}
export async function openBundledOriginalPublicationInput(input){return originalTransport(await openBundledOriginalPublicationResult(input));}
export async function openBundledOriginalPublicationResult(input){
 const original=captured(input); // snapshot request, manifest and raw bytes before I/O
 const metadataURL=new URL('../../../packages/wallet-auth/package.json',import.meta.url);
 const metadata=JSON.parse(await readFile(metadataURL,'utf8'));
 if(metadata.name!=='@ynx-chain/wallet-auth')fail('IDE_PUBLICATION_RESULT_NOT_SUPPLIED');
 const root=await realpath(dirname(fileURLToPath(metadataURL))),sdk=createRequire(metadataURL);
 let target;try{target=await realpath(sdk.resolve('@ynx-chain/wallet-auth/ide-artifact-release-result'));}
 catch(cause){if(['MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED','ENOENT'].includes(cause?.code))throw Object.assign(Error('The matching original publication result decoder is not supplied.'),{code:'IDE_PUBLICATION_RESULT_NOT_SUPPLIED',cause});throw cause;}
 if(!target.startsWith(root+sep))fail('IDE_PUBLICATION_RESULT_NOT_SUPPLIED');
 const api=await import(pathToFileURL(target).href);
 return decoded(original,api.decodeIDEArtifactReleaseResultData);
}

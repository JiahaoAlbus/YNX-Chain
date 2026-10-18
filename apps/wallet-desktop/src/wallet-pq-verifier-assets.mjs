import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {PQ_FINALITY_EVIDENCE_LIMITS as limits} from './wallet-pq-finality-evidence.mjs';
import {PQFinalityVerifierProcessKernel} from './wallet-pq-verifier-process.mjs';
const sourceCommit='0345970c7c616c24ebf3e494e9a8d9628ff8ae40',forkTree='9777a6f8544fe5f9d41b546c6a34b3e3e02ab54e';
const ciOriginal=Object.freeze({bytes:34423202,sha256:'e4011728d2c64d80c886f7648977e9812ca08932ad2d2d09e2e1a492612c3ca2'});
const sourceFile=Object.freeze({bytes:1938,sha256:'140cd07e512486ef812522cc9fcd20e53023256bf55c6290c4b10203d48bf027'});
const fail=code=>{throw Object.assign(Error(code),{code});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function exact(value,fields){if(types.isProxy(value))fail('PQ_FINALITY_ASSET_INVALID');exactData(value,fields,'PQ_FINALITY_ASSET_INVALID');}
function pin(value,maximum){exact(value,['bytes','sha256']);if(!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>maximum||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))fail('PQ_FINALITY_ASSET_INVALID');return Object.freeze({...value});}
function canonical(file){if(typeof file!=='string'||!path.isAbsolute(file)||path.normalize(file)!==file)fail('PQ_FINALITY_ASSET_INVALID');}
async function readPinned(file,expected,maximum,{executable=false}={}){
 canonical(file);let handle;
 try{
  if(await fs.realpath(file)!==file)fail('PQ_FINALITY_ASSET_INVALID');
  handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));const before=await handle.stat();
  if(!before.isFile()||before.nlink!==1||before.size!==expected.bytes||before.size>maximum||(before.mode&0o022)!==0||executable&&(before.mode&0o111)===0||typeof process.getuid==='function'&&![0,process.getuid()].includes(before.uid))fail('PQ_FINALITY_ASSET_INVALID');
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,Math.min(1<<20,bytes.length-offset),null);if(!bytesRead)fail('PQ_FINALITY_ASSET_INVALID');offset+=bytesRead;}
  const after=await handle.stat(),entry=await fs.lstat(file);
  for(const next of [after,entry])if(!next.isFile()||next.isSymbolicLink()||['dev','ino','size','mode','uid','nlink','mtimeMs','ctimeMs'].some(key=>next[key]!==before[key]))fail('PQ_FINALITY_ASSET_INVALID');
  if(hash(bytes)!==expected.sha256)fail('PQ_FINALITY_ASSET_INVALID');return bytes;
 }catch(cause){throw Object.assign(Error('PQ_FINALITY_ASSET_UNVERIFIED'),{code:'PQ_FINALITY_ASSET_UNVERIFIED',cause});}
 finally{await handle?.close();}
}
/** Main-only source/bytes validation, NOT Host trust. The independent receipt
 * must come from the original builder's frozen post-inner-sign handoff, never
 * the manifest being checked or an IPC argument. CI and bundled hashes differ
 * when signing changes the executable. No signing/notarization is inferred. */
export async function preparePackagedPQVerifierInvocation(resourcesPath,independentReceipt,input){
 canonical(resourcesPath);
 if(independentReceipt===null||independentReceipt===undefined)fail('PQ_FINALITY_ASSET_RECEIPT_NOT_SUPPLIED');
 exact(independentReceipt,['sourceCommit','forkTree','manifest','bundled','sourceFile']);
 if(independentReceipt.sourceCommit!==sourceCommit||independentReceipt.forkTree!==forkTree)fail('PQ_FINALITY_ASSET_INVALID');
 const receipt={manifest:pin(independentReceipt.manifest,16384),bundled:pin(independentReceipt.bundled,64<<20),sourceFile:pin(independentReceipt.sourceFile,65536)};
 if(receipt.sourceFile.bytes!==sourceFile.bytes||receipt.sourceFile.sha256!==sourceFile.sha256)fail('PQ_FINALITY_ASSET_INVALID');
 exact(input,['contextPath','contextSha256','stdin']);canonical(input.contextPath);
 input=Object.freeze({contextPath:input.contextPath,contextSha256:input.contextSha256,stdin:input.stdin});
 if(typeof input.contextSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.contextSha256)||typeof input.stdin!=='string'||Buffer.byteLength(input.stdin)>limits['verifier-stdin']||Buffer.from(input.stdin).toString('utf8')!==input.stdin)fail('PQ_FINALITY_VERIFIER_INVOCATION_INVALID');
 const root=path.join(resourcesPath,'consensus-proof-verifier'),manifestBytes=await readPinned(path.join(root,'manifest.json'),receipt.manifest,16384);
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));}catch{fail('PQ_FINALITY_ASSET_INVALID');}
 exact(manifest,['schema','sourceCommit','forkTree','platform','architecture','binaryPath','ciOriginal','bundled','sourceFile','signingClass']);
 if(manifest.schema!=='YNX-WALLET-PACKAGED-PROOF-VERIFIER/v1'||manifest.sourceCommit!==sourceCommit||manifest.forkTree!==forkTree||manifest.platform!=='darwin'||manifest.architecture!=='arm64'||manifest.binaryPath!=='darwin-arm64/ynx-consensus-proof-verify'||typeof manifest.signingClass!=='string'||!manifest.signingClass.length||manifest.signingClass.length>64)fail('PQ_FINALITY_ASSET_INVALID');
 const original=pin(manifest.ciOriginal,64<<20),bundled=pin(manifest.bundled,64<<20);exact(manifest.sourceFile,['path','bytes','sha256']);
 if(original.bytes!==ciOriginal.bytes||original.sha256!==ciOriginal.sha256||bundled.bytes!==receipt.bundled.bytes||bundled.sha256!==receipt.bundled.sha256||manifest.sourceFile.path!=='SOURCE.json'||manifest.sourceFile.bytes!==receipt.sourceFile.bytes||manifest.sourceFile.sha256!==receipt.sourceFile.sha256)fail('PQ_FINALITY_ASSET_INVALID');
 await readPinned(path.join(root,'SOURCE.json'),receipt.sourceFile,65536);
 const executable=path.join(root,'darwin-arm64','ynx-consensus-proof-verify'),binary=await readPinned(executable,receipt.bundled,64<<20,{executable:true});
 if(binary.length<32||binary.readUInt32LE(0)!==0xfeedfacf||binary.readUInt32LE(4)!==0x0100000c)fail('PQ_FINALITY_ASSET_ARCHITECTURE');
 const context=await fs.lstat(input.contextPath);if(!context.isFile()||context.size<1||context.size>limits['host-context'])fail('PQ_FINALITY_CONTEXT_UNVERIFIED');
 await readPinned(input.contextPath,{bytes:context.size,sha256:input.contextSha256},limits['host-context']);
 return Object.freeze({executable,contextPath:input.contextPath,contextSha256:input.contextSha256,stdin:input.stdin});
}
export function createPackagedPQFinalityVerifier({app,independentReceipt=null}){
 // Normal factory has no injected spawn, filesystem, URL, clock or provider.
 // Its receipt is a private original-Main dependency, not a trust context.
 let receipt=null;
 if(independentReceipt!==null){
  exact(independentReceipt,['sourceCommit','forkTree','manifest','bundled','sourceFile']);
  if(independentReceipt.sourceCommit!==sourceCommit||independentReceipt.forkTree!==forkTree)fail('PQ_FINALITY_ASSET_INVALID');
  receipt=Object.freeze({sourceCommit,forkTree,manifest:pin(independentReceipt.manifest,16384),bundled:pin(independentReceipt.bundled,64<<20),sourceFile:pin(independentReceipt.sourceFile,65536)});
 }
 const kernel=new PQFinalityVerifierProcessKernel({prepare:async input=>{
  if(app?.isPackaged!==true||process.platform!=='darwin'||process.arch!=='arm64'||typeof process.resourcesPath!=='string')fail('PQ_FINALITY_PACKAGED_VERIFIER_UNAVAILABLE');
  return preparePackagedPQVerifierInvocation(process.resourcesPath,receipt,input);
 }});
 // Keep PUBLIC test seams off the actual Main caller. In particular the
 // packaged instance cannot have prepare/spawn replaced after construction.
 const caller=Object.freeze({
  run:input=>kernel.run(input).catch(cause=>{if(cause?.partial===kernel)cause.partial=caller;throw cause;}),
  snapshot:()=>kernel.snapshot(),retire:()=>kernel.retire(),
  identity:()=>receipt,
  join:()=>kernel.join(),assertSafeToClose:()=>kernel.assertSafeToClose(),
 });
 return caller;
}

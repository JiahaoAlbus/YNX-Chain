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
// Protocol's fixed whole591 tree and five Host leaves were independently
// read back by A. SOURCE/v1 remains its original five-leaf statement.
const hostProfile=Object.freeze({sourceCommit:'59185090aab3e4eaa6f8c9a0b29e975a2917e8b1',forkTree:'f694a8c86f7ed65e19d1ce08c690d5d8fe84fd42',
 ciOriginal:{bytes:34510674,sha256:'53de20fee3ae0a6717845d967eac95d1e4a0cb256d0fa5f01112f6a515d8f93b'},
 sourceFile:{bytes:1938,sha256:'8775709d35a0f2734c09a51bd4db7f446922faa34b9ca37924335dadddef61ce'},
 manifest:{bytes:729,sha256:'b574373a4304c682b73442c1cd8087562ff04be515a0fb4deba88f50104d098e'},
 bundled:{bytes:34310208,sha256:'a7e47ea79b3e4bdd40014c8c02aafbad7b37a69c9c15c7f45a9fd0c51d44479d'}});
// Source-owned closed fbec profile: original CI bytes and independently
// post-inner-sign bytes are different facts. Whole source/tree and twenty
// Host/typed leaves were independently bound in original A's frozen handoff.
const typedHostProfile=Object.freeze({sourceCommit:'fbecfbefff09d1f20b059fc859cfcdd6affcabde',forkTree:'fa760970088d4f1a275d4cab254d63a014db9c74',
 ciOriginal:{bytes:34663250,sha256:'e9bd43f234b8e1639de82414d2a71cc07147fba99d7fda0a6f3389270146535a'},
 sourceFile:{bytes:1938,sha256:'ea662a43b51f6b1f648f4cfc7311f6c8fec61a19f18f5dc30df1ea29a546cab5'},
 manifest:{bytes:729,sha256:'7ea67728d2d49e760962ed74471fb9aab4f6ef29dacccbc25828ba8721d4ef1f'},
 bundled:{bytes:34461888,sha256:'65b6b4375aafefbd0b08700495583dcea783d26b914d4843cb13d07b2167fca3'}});
// Separate original A post-inner-sign profile. forkTree is the original
// Protocol fork identity, NOT the whole Git tree in the separately pinned
// selector source sidecar. Neither statement is a Source/catalog permission.
const selectionHostProfile=Object.freeze({sourceCommit:'514e7763116b6bdaf0bbea5ba3b91c5269105cd0',forkTree:'fa760970088d4f1a275d4cab254d63a014db9c74',
 ciOriginal:{bytes:34734370,sha256:'c8ba9845aef3101bcdbfe41f783c03491133aa07ed14e81b369e7b0961e5378f'},
 sourceFile:{bytes:1938,sha256:'78f63f594320a5611ff1b1ef244163ae0eaf3b7a39d1a0d015a3ac281e66c7cf'},
 manifest:{bytes:729,sha256:'283485d2f79e9194be611cee9ccc90e2821ff2a62f2e185f61202bc4837ebe74'},
 bundled:{bytes:34532592,sha256:'eb32c5dd3e84d681b8265d7dfc3f8d47ed40158241426f869ada6c08db7d9b2b'},
 selectionSourceFile:{bytes:2049,sha256:'019a6cf30186e2976d7a96989589e9ecc7df6666ef7483b7b60b2fc1c1681e4b'}});
const fail=code=>{throw Object.assign(Error(code),{code});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function exact(value,fields){if(types.isProxy(value))fail('PQ_FINALITY_ASSET_INVALID');exactData(value,fields,'PQ_FINALITY_ASSET_INVALID');}
function pin(value,maximum){exact(value,['bytes','sha256']);if(!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>maximum||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))fail('PQ_FINALITY_ASSET_INVALID');return Object.freeze({...value});}
function canonical(file){if(typeof file!=='string'||!path.isAbsolute(file)||path.normalize(file)!==file)fail('PQ_FINALITY_ASSET_INVALID');}
function component(receipt){
 exact(receipt,['sourceCommit','forkTree','manifest','bundled','sourceFile']);
 if(receipt.sourceCommit===sourceCommit&&receipt.forkTree===forkTree)return {sourceCommit,forkTree,ciOriginal,sourceFile};
 const selected=[hostProfile,typedHostProfile,selectionHostProfile].find(p=>receipt.sourceCommit===p.sourceCommit&&receipt.forkTree===p.forkTree);
 if(selected){
  for(const key of ['manifest','bundled','sourceFile']){const p=pin(receipt[key],64<<20);if(p.bytes!==selected[key].bytes||p.sha256!==selected[key].sha256)fail('PQ_FINALITY_ASSET_INVALID');}
  return selected;
 }
 fail('PQ_FINALITY_ASSET_INVALID');
}
export function supportsPackagedPQTypedFinality(receipt){
 if(receipt===null||receipt===undefined)return false;
 exact(receipt,['sourceCommit','forkTree','manifest','bundled','sourceFile']);
 return [typedHostProfile,selectionHostProfile].includes(component(receipt));
}
const hostCapable=receipt=>[hostProfile,typedHostProfile,selectionHostProfile].includes(component(receipt));
export function packagedPQVerifierAssetPaths(receipt){
 const selected=component(receipt);
 return Object.freeze(['SOURCE.json','manifest.json','darwin-arm64/ynx-consensus-proof-verify',...(selected===selectionHostProfile?['HOST_SELECTION_SOURCE_GIT_PINS.json']:[])]);
}
async function readPinned(file,expected,maximum,{executable=false,privateOwner=false}={}){
 canonical(file);let handle;
 try{
  if(await fs.realpath(file)!==file)fail('PQ_FINALITY_ASSET_INVALID');
  handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));const before=await handle.stat();
  if(!before.isFile()||before.nlink!==1||before.size!==expected.bytes||before.size>maximum||(before.mode&0o022)!==0||executable&&(before.mode&0o111)===0||typeof process.getuid==='function'&&![0,process.getuid()].includes(before.uid))fail('PQ_FINALITY_ASSET_INVALID');
  if(privateOwner&&(typeof process.getuid!=='function'||before.uid!==process.getuid()||(before.mode&0o7777)!==0o600))fail('PQ_HOST_CATALOG_PRIVATE_REQUIRED');
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
export async function verifyPackagedPQVerifierAssets(resourcesPath,independentReceipt){
 canonical(resourcesPath);
 if(independentReceipt===null||independentReceipt===undefined)fail('PQ_FINALITY_ASSET_RECEIPT_NOT_SUPPLIED');
 exact(independentReceipt,['sourceCommit','forkTree','manifest','bundled','sourceFile']);
 const profile=component(independentReceipt),{sourceCommit,forkTree,ciOriginal,sourceFile}=profile;
 const receipt={manifest:pin(independentReceipt.manifest,16384),bundled:pin(independentReceipt.bundled,64<<20),sourceFile:pin(independentReceipt.sourceFile,65536)};
 if(receipt.sourceFile.bytes!==sourceFile.bytes||receipt.sourceFile.sha256!==sourceFile.sha256)fail('PQ_FINALITY_ASSET_INVALID');
 const root=path.join(resourcesPath,'consensus-proof-verifier'),manifestBytes=await readPinned(path.join(root,'manifest.json'),receipt.manifest,16384);
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));}catch{fail('PQ_FINALITY_ASSET_INVALID');}
 exact(manifest,['schema','sourceCommit','forkTree','platform','architecture','binaryPath','ciOriginal','bundled','sourceFile','signingClass']);
 if(manifest.schema!=='YNX-WALLET-PACKAGED-PROOF-VERIFIER/v1'||manifest.sourceCommit!==sourceCommit||manifest.forkTree!==forkTree||manifest.platform!=='darwin'||manifest.architecture!=='arm64'||manifest.binaryPath!=='darwin-arm64/ynx-consensus-proof-verify'||typeof manifest.signingClass!=='string'||!manifest.signingClass.length||manifest.signingClass.length>64)fail('PQ_FINALITY_ASSET_INVALID');
 const original=pin(manifest.ciOriginal,64<<20),bundled=pin(manifest.bundled,64<<20);exact(manifest.sourceFile,['path','bytes','sha256']);
 if(original.bytes!==ciOriginal.bytes||original.sha256!==ciOriginal.sha256||bundled.bytes!==receipt.bundled.bytes||bundled.sha256!==receipt.bundled.sha256||manifest.sourceFile.path!=='SOURCE.json'||manifest.sourceFile.bytes!==receipt.sourceFile.bytes||manifest.sourceFile.sha256!==receipt.sourceFile.sha256)fail('PQ_FINALITY_ASSET_INVALID');
 await readPinned(path.join(root,'SOURCE.json'),receipt.sourceFile,65536);
 if(profile===selectionHostProfile)await readPinned(path.join(root,'HOST_SELECTION_SOURCE_GIT_PINS.json'),profile.selectionSourceFile,65536);
 const executable=path.join(root,'darwin-arm64','ynx-consensus-proof-verify'),binary=await readPinned(executable,receipt.bundled,64<<20,{executable:true});
 if(binary.length<32||binary.readUInt32LE(0)!==0xfeedfacf||binary.readUInt32LE(4)!==0x0100000c)fail('PQ_FINALITY_ASSET_ARCHITECTURE');
 return Object.freeze({executable});
}
export async function preparePackagedPQVerifierInvocation(resourcesPath,independentReceipt,input){
 canonical(resourcesPath);if(independentReceipt===null||independentReceipt===undefined)fail('PQ_FINALITY_ASSET_RECEIPT_NOT_SUPPLIED');
 exact(input,['contextPath','contextSha256','stdin']);canonical(input.contextPath);
 input=Object.freeze({contextPath:input.contextPath,contextSha256:input.contextSha256,stdin:input.stdin});
 if(typeof input.contextSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.contextSha256)||typeof input.stdin!=='string'||Buffer.byteLength(input.stdin)>limits['verifier-stdin']||Buffer.from(input.stdin).toString('utf8')!==input.stdin)fail('PQ_FINALITY_VERIFIER_INVOCATION_INVALID');
 const {executable}=await verifyPackagedPQVerifierAssets(resourcesPath,independentReceipt);
 const context=await fs.lstat(input.contextPath);if(!context.isFile()||context.size<1||context.size>limits['host-context'])fail('PQ_FINALITY_CONTEXT_UNVERIFIED');
 await readPinned(input.contextPath,{bytes:context.size,sha256:input.contextSha256},limits['host-context']);
 return Object.freeze({executable,contextPath:input.contextPath,contextSha256:input.contextSha256,stdin:input.stdin});
}
export async function preparePackagedPQHostInvocation(resourcesPath,independentReceipt,input){
 canonical(resourcesPath);if(independentReceipt===null||independentReceipt===undefined)fail('PQ_FINALITY_ASSET_RECEIPT_NOT_SUPPLIED');
 if(!hostCapable(independentReceipt))fail('PQ_HOST_COMPONENT_UNAVAILABLE');
 exact(input,['sourcePath','sourceSha256','stdin']);canonical(input.sourcePath);
 const captured={sourcePath:input.sourcePath,sourceSha256:input.sourceSha256,stdin:input.stdin};
 if(Buffer.byteLength(captured.sourcePath)>4096||typeof captured.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(captured.sourceSha256)||typeof captured.stdin!=='string'||Buffer.byteLength(captured.stdin)>4096||Buffer.from(captured.stdin).toString('utf8')!==captured.stdin)fail('PQ_HOST_INVOCATION_INVALID');
 const {executable}=await verifyPackagedPQVerifierAssets(resourcesPath,independentReceipt);
 const source=await fs.lstat(captured.sourcePath);if(!source.isFile()||source.size<1||source.size>16384)fail('PQ_HOST_SOURCE_UNVERIFIED');
 await readPinned(captured.sourcePath,{bytes:source.size,sha256:captured.sourceSha256},16384);
 return Object.freeze({executable,contextPath:captured.sourcePath,contextSha256:captured.sourceSha256,stdin:captured.stdin});
}
export async function preparePackagedPQHostSelectionInvocation(resourcesPath,independentReceipt,input){
 canonical(resourcesPath);if(independentReceipt===null||independentReceipt===undefined)fail('PQ_FINALITY_ASSET_RECEIPT_NOT_SUPPLIED');
 if(component(independentReceipt)!==selectionHostProfile)fail('PQ_HOST_SELECTION_COMPONENT_UNAVAILABLE');
 exact(input,['catalogPath','catalogSha256','stdin']);canonical(input.catalogPath);
 const captured=Object.freeze({...input});
 if(Buffer.byteLength(captured.catalogPath)>4096||Buffer.from(captured.catalogPath).toString('utf8')!==captured.catalogPath||typeof captured.catalogSha256!=='string'||!/^[a-f0-9]{64}$/.test(captured.catalogSha256)||/^0{64}$/.test(captured.catalogSha256)||typeof captured.stdin!=='string'||Buffer.byteLength(captured.stdin)>4096||Buffer.from(captured.stdin).toString('utf8')!==captured.stdin)fail('PQ_HOST_SELECTION_INVOCATION_INVALID');
 const {executable}=await verifyPackagedPQVerifierAssets(resourcesPath,independentReceipt);
 const directory=path.dirname(captured.catalogPath);
 const inspect=async()=>{if(await fs.realpath(directory)!==directory)fail('PQ_HOST_CATALOG_PRIVATE_REQUIRED');const s=await fs.lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||typeof process.getuid!=='function'||s.uid!==process.getuid()||(s.mode&0o7777)!==0o700)fail('PQ_HOST_CATALOG_PRIVATE_REQUIRED');return s;};
 const parent=await inspect(),catalog=await fs.lstat(captured.catalogPath);
 if(!catalog.isFile()||catalog.size<1||catalog.size>16384)fail('PQ_HOST_CATALOG_UNVERIFIED');
 await readPinned(captured.catalogPath,{bytes:catalog.size,sha256:captured.catalogSha256},16384,{privateOwner:true});
 const after=await inspect();if(['dev','ino','mode','uid'].some(k=>after[k]!==parent[k]))fail('PQ_HOST_CATALOG_UNVERIFIED');
 return Object.freeze({executable,contextPath:captured.catalogPath,contextSha256:captured.catalogSha256,stdin:captured.stdin});
}
export function createPackagedPQFinalityVerifier(options){return packagedCaller(options,'proof');}
export function createPackagedPQHostProducer(options){return packagedCaller(options,'host-producer');}
export function createPackagedPQHostSelector(options){return packagedCaller(options,'host-selection');}
function packagedCaller({app,independentReceipt=null},mode){
 // Normal factory has no injected spawn, filesystem, URL, clock or provider.
 // Its receipt is a private original-Main dependency, not a trust context.
 let receipt=null;
 if(independentReceipt!==null){
  exact(independentReceipt,['sourceCommit','forkTree','manifest','bundled','sourceFile']);
  const {sourceCommit,forkTree}=component(independentReceipt);
  if(mode==='host-producer'&&!hostCapable(independentReceipt))fail('PQ_HOST_COMPONENT_UNAVAILABLE');
  if(mode==='host-selection'&&component(independentReceipt)!==selectionHostProfile)fail('PQ_HOST_SELECTION_COMPONENT_UNAVAILABLE');
  receipt=Object.freeze({sourceCommit,forkTree,manifest:pin(independentReceipt.manifest,16384),bundled:pin(independentReceipt.bundled,64<<20),sourceFile:pin(independentReceipt.sourceFile,65536)});
 }
 const kernel=new PQFinalityVerifierProcessKernel({mode,prepare:async input=>{
  if(app?.isPackaged!==true||process.platform!=='darwin'||process.arch!=='arm64'||typeof process.resourcesPath!=='string')fail('PQ_FINALITY_PACKAGED_VERIFIER_UNAVAILABLE');
  return mode==='proof'?preparePackagedPQVerifierInvocation(process.resourcesPath,receipt,input):mode==='host-producer'?preparePackagedPQHostInvocation(process.resourcesPath,receipt,input):preparePackagedPQHostSelectionInvocation(process.resourcesPath,receipt,input);
 }});
 // Keep PUBLIC test seams off the actual Main caller. In particular the
 // packaged instance cannot have prepare/spawn replaced after construction.
 const caller=Object.freeze({
  run:input=>kernel.run(input).catch(cause=>{if(cause?.partial===kernel)cause.partial=caller;throw cause;}),
  snapshot:()=>kernel.snapshot(),retire:()=>kernel.retire(),
  identity:()=>receipt,
  async verifyAssets(){
   if(app?.isPackaged!==true||process.platform!=='darwin'||process.arch!=='arm64'||typeof process.resourcesPath!=='string')fail('PQ_FINALITY_PACKAGED_VERIFIER_UNAVAILABLE');
   await verifyPackagedPQVerifierAssets(process.resourcesPath,receipt);
   return Object.freeze({available:true,sourceCommit:receipt.sourceCommit,forkTree:receipt.forkTree,sha256:receipt.bundled.sha256,independentFinality:false,nativeGrant:false});
  },
  join:()=>kernel.join(),assertSafeToClose:()=>kernel.assertSafeToClose(),
 });
 return caller;
}

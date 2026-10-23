import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {contractBroadcastReferenceId} from './wallet-contract-client.mjs';
const fail=()=>Object.assign(Error('Review the actual project compiler materials again. Nothing was automatically signed or submitted.'),{code:'IDE_CONTRACT_MATERIAL_REVIEW_REQUIRED'});
const fields=['owner','workspaceOwner','account','generation','identityReference','localProjectId','workspace','launch','sessionId'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// The published Go transport expects strings.TrimSpace(source), whereas a
// compiler source FILE normally retains its final newline. Normalize only the
// transport text, never the user's file or original compiler material. SDK
// remains the sole fixed-registry/commitment builder and rejects unknown data.
const goEdgeSpace='\\u0009-\\u000d\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const goEdges=new RegExp('^['+goEdgeSpace+']+|['+goEdgeSpace+']+$','gu');
export function createProjectContractDeployment({context,admittedProject,loadMaterialBuilder,now=Date.now}){
 let closed=false,captured,deadline,draft,busy=false;
 async function current(){if(closed||typeof admittedProject?.assertCurrent!=='function')throw fail();const state=await admittedProject.assertCurrent();if(closed||!state||fields.some(key=>state[key]===undefined)||state.workspace!==context.workspace||!Number.isSafeInteger(state.generation)||state.generation<0||!Number.isFinite(state.expiresAt)||state.expiresAt<=now())throw fail();if(captured&&(fields.some(key=>captured[key]!==state[key])||state.expiresAt<deadline||now()>=deadline))throw fail();if(!captured){captured=Object.freeze({...state});deadline=state.expiresAt;}}
 async function read(uri,limit){
  await current();const url=new URL(uri);if(url.protocol!=='file:'||url.host||url.search||url.hash)throw fail();const selected=fileURLToPath(url),relative=path.relative(context.workspace,selected);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||await fs.realpath(selected)!==selected)throw fail();
  const fd=await fs.open(selected,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const before=await fd.stat({bigint:true});if(!before.isFile()||before.uid!==BigInt(process.getuid())||before.nlink!==1n||before.size<1n||before.size>BigInt(limit))throw fail();const bytes=Buffer.alloc(Number(before.size)+1);let length=0;while(length<bytes.length){const result=await fd.read(bytes,length,bytes.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead;}const after=await fd.stat({bigint:true}),named=await fs.lstat(selected,{bigint:true});await current();if(await fs.realpath(selected)!==selected||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||named.dev!==after.dev||named.ino!==after.ino||named.nlink!==1n||BigInt(length)!==after.size)throw fail();return {bytes:Buffer.from(bytes.subarray(0,length)),fingerprint:[after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs,sha(bytes.subarray(0,length))].map(String).join(':')};}finally{await fd.close();}
 }
 async function originals(selection){const values=await Promise.allSettled([read(selection.sourceURI,65536),read(selection.artifactURI,131072),read(selection.buildInfoURI,16777216)]);const failed=values.find(value=>value.status==='rejected');if(failed)throw failed.reason;return values.map(value=>value.value);}
 async function recheck(){await current();if(!draft)throw fail();const actual=await originals(draft.selection);if(actual.some((value,index)=>value.fingerprint!==draft.originals[index].fingerprint))throw fail();return draft;}
 async function exclusive(run){if(busy)throw fail();busy=true;try{return await run();}finally{busy=false;}}
 return Object.freeze({
  preview(selection){return exclusive(async()=>{
    await current();if(!selection||Object.keys(selection).sort().join()!=='artifactURI,buildInfoURI,constructorArg,name,sourceURI'||!['SampleEVMWriteCounter','SampleYNXTCompatibleERC20'].includes(selection.name)||typeof selection.constructorArg!=='string'||selection.constructorArg==='')throw fail();const selected=structuredClone(selection),raw=await originals(selected);const prepare=await loadMaterialBuilder();if(typeof prepare!=='function')throw fail();
    const sourceFile=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw[0].bytes),wireSource=sourceFile.replace(goEdges,'');
    const data=prepare({name:selected.name,source:wireSource,material:{artifactFile:Uint8Array.from(raw[1].bytes),buildInfoFile:Uint8Array.from(raw[2].bytes)},constructorArgs:[selected.constructorArg]});await current();if(data?.dataOnly!==true||data.authorized!==false||data.nativeAdmission!==false||data.fee!=='10'||data.value!=='0')throw fail();
    const referenceId=randomUUID();draft={id:randomUUID(),referenceId,broadcastReferenceId:contractBroadcastReferenceId(referenceId),selection:selected,originals:raw,data,entered:false,prepared:false};return{draftId:draft.id,referenceId,broadcastReferenceId:draft.broadcastReferenceId,review:{name:data.name,sourceFileSHA256:sha(raw[0].bytes),wireSourceSHA256:sha(Buffer.from(wireSource)),sourceBoundaryWhitespaceNormalized:wireSource!==sourceFile,sourceHash:data.sourceHash,deployedBytecodeHash:data.deployedBytecodeHash,compilerConfigHash:data.compilerConfigHash,constructorArgs:[...data.constructorArgs],fee:data.fee,value:data.value,chainId:'eip155:6423'},authorized:false,submitted:false};
  });},
  prepare(draftId,client){return exclusive(async()=>{const value=await recheck();if(value.id!==draftId||value.entered)throw fail();value.entered=true;const data=value.data,material=data.material;const result=await client.prepareDeployment({referenceId:value.referenceId,action:{kind:'contract_deploy',fee:data.fee,payload:{name:data.name,sourceHash:data.sourceHash,deployedBytecodeHash:data.deployedBytecodeHash,compilerConfigHash:data.compilerConfigHash,constructorArgs:[...data.constructorArgs],value:data.value}},deployment:{source:data.source,material:{artifactFile:Buffer.from(material.artifactFile).toString('base64'),buildInfoFile:Buffer.from(material.buildInfoFile).toString('base64')}}});await current();value.prepared=true;return result;});},
  broadcast(referenceId,client){return exclusive(async()=>{const value=await recheck();if(value.referenceId!==referenceId||!value.prepared)throw fail();return client.broadcastDeployment(referenceId);});},
  close(){closed=true;draft=undefined;},
 });
}

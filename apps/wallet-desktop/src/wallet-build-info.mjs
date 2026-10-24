import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
const versionText=v=>typeof v==='string'&&/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v);
const commit=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
/** Public, recorded package DATA only. This never verifies installed code,
 * signatures, Source admission, accounts or runtime business capabilities. */
export function projectWalletBuildInfo(version,raw){
 const unavailable=()=>Object.freeze({version:versionText(version)?version:'unknown',build:null});
 try{
  if(!versionText(version)||!Buffer.isBuffer(raw)||raw.length<2||raw.length>8192)return unavailable();
  const record=JSON.parse(raw);
  if(record?.schemaVersion!==1||record.product!=='YNX Wallet'||record.version!==version||record.distribution!=='testnet-preview'||!commit(record.sourceCommit)||!commit(record.walletTree)||!commit(record.walletAuthTree))return unavailable();
  return Object.freeze({version,build:Object.freeze({sourceCommit:record.sourceCommit,walletTree:record.walletTree,walletAuthTree:record.walletAuthTree,distribution:'testnet-preview',metadataOnly:true})});
 }catch{return unavailable();}
}
/** Caller is original Main with a fixed resources path, never renderer input.
 * Bounded regular-file read; errors expose no local path or file contents. */
export async function readPackagedWalletBuildInfo(options){
 const {version,isPackaged}=options,unavailable=()=>projectWalletBuildInfo(version,null);
 if(isPackaged!==true)return unavailable();
 let file;
 try{
  const identityPath=options.identityPath;if(typeof identityPath!=='string'||!path.isAbsolute(identityPath))return unavailable();
  const entry=await lstat(identityPath);if(!entry.isFile()||entry.isSymbolicLink())return unavailable();
  file=await open(identityPath,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  const before=await file.stat();if(!before.isFile()||before.size<2||before.size>8192||entry.dev!==before.dev||entry.ino!==before.ino)return unavailable();
  const raw=Buffer.alloc(before.size);let offset=0;
  while(offset<raw.length){const read=await file.read(raw,offset,raw.length-offset,offset);if(read.bytesRead===0)return unavailable();offset+=read.bytesRead;}
  if((await file.read(Buffer.alloc(1),0,1,offset)).bytesRead!==0)return unavailable();
  const after=await file.stat(),current=await lstat(identityPath);if(!after.isFile()||!current.isFile()||current.isSymbolicLink()||['dev','ino','size','mode','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k]||before[k]!==current[k]))return unavailable();
  return projectWalletBuildInfo(version,raw);
 }catch{return unavailable();}finally{await file?.close().catch(()=>{});}
}

// Offline packaging only. The SDK component reader remains responsible for
// source/build receipt validation; these checks grant no runtime authority.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {isDeepStrictEqual} from 'node:util';
import {desktopNative49C6Selection,verifyDesktopNative49C6Runtime} from './desktop-native49-c6-pack.mjs';
import {desktopPackageNativeIdentityComponent} from './desktop-package-native-selection.mjs';
import path from 'node:path';
import {isPortableQARecord,portableRuntimePackAssetsDATA,assertPortableRuntimePackagedBytesDATA} from './canonical-native-portable-qa-profile.mjs';

export class NativePackageRecoveryError extends AggregateError {}

// Offline package rollback must preserve the original cause and attempt both
// restorations. A failed restoration retains the staging directory for recovery.
export function recoverFailedNativePackage(cause,temporary,restoreArchive,restoreNative){
 const cleanup=[];
 for(const restore of [restoreArchive,restoreNative])try{restore();}catch(error){cleanup.push(error);}
 if(cleanup.length||cause instanceof NativePackageRecoveryError){
  const error=new NativePackageRecoveryError([cause,...cleanup],'Package rollback incomplete; recovery files retained at '+temporary,{cause});
  Object.defineProperty(error,'recoveryDirectory',{value:temporary,enumerable:true});
  return {retainTemporary:true,error};
 }
 return {retainTemporary:false,error:cause};
}

export function portableRuntimeAssets(record){
 return isPortableQARecord(record)?portableRuntimePackAssetsDATA(record):[];
}

function regularBytes(root,relative){
 // Reject links in every component, including directories. A final regular
 // leaf behind a Homebrew/supplier directory link is not a packaged library.
 let current=root;
 if(!fs.lstatSync(current).isDirectory()||fs.lstatSync(current).isSymbolicLink())throw Error('PORTABLE_PACK_REGULAR_ROOT_REQUIRED');
 const parts=relative.split('/');
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);const s=fs.lstatSync(current);
  if(s.isSymbolicLink()||(i===parts.length-1?!s.isFile()||s.size<1||s.size>(16<<20):!s.isDirectory()))throw Error('PORTABLE_PACK_REGULAR_FILE_REQUIRED');
 }
 return fs.readFileSync(current);
}

export function verifyPortableRuntimeFiles(record,root,{canonical=false}={}){
 if(!isPortableQARecord(record))return null;
 return assertPortableRuntimePackagedBytesDATA(record,relative=>regularBytes(root,(canonical?'code/apps/wallet-desktop/':'')+relative));
}

// Only fixed generated outputs come from the package. Every other requested
// operand retains the original Git source reader and its failures.
export function createPortablePackageAssetReader(record,readSource,root){
 if(!isPortableQARecord(record))return readSource;
 const assets=portableRuntimeAssets(record),captured=new Map();
 for(const row of assets)captured.set(row.unpackedRelative,regularBytes(root,'code/apps/wallet-desktop/'+row.unpackedRelative));
 assertPortableRuntimePackagedBytesDATA(record,relative=>captured.get(relative));
 const bySource=new Map(assets.map(row=>[row.sourceRelative,captured.get(row.unpackedRelative)]));
 return relative=>bySource.has(relative)?Buffer.from(bySource.get(relative)):readSource(relative);
}

export function beginNativeRuntimeRelocation(record,unpacked,{c6RecordBytes,separateNative,separateRecordBytes}={}){
 if(!path.isAbsolute(unpacked)||path.normalize(unpacked)!==unpacked)throw Error('PORTABLE_PACK_ABSOLUTE_ROOT_REQUIRED');
 if(separateNative&&(c6RecordBytes||!separateRecordBytes))throw Error('SEPARATE_NATIVE_RELOCATION_SELECTION_CONFLICT');
 const component=separateNative?desktopPackageNativeIdentityComponent(separateNative.selection):null;
 const assets=component?component.selection.assets.filter(row=>row.path!==component.selection.recordRelative).map(row=>({unpackedRelative:row.path.slice('apps/wallet-desktop/'.length)})):c6RecordBytes?desktopNative49C6Selection.assets.filter(row=>row.path!==desktopNative49C6Selection.recordRelative).map(row=>({unpackedRelative:row.path.slice('apps/wallet-desktop/'.length)})):portableRuntimeAssets(record);
 if(component)component.verifyRuntime(unpacked,separateRecordBytes);
 else if(c6RecordBytes)verifyDesktopNative49C6Runtime(unpacked,c6RecordBytes);
 else if(assets.length)verifyPortableRuntimeFiles(record,unpacked);
 const moves=(assets.length?assets.map(row=>row.unpackedRelative):['native/original-auth-identity.node']).map(relative=>({before:path.join(unpacked,relative),after:path.join(unpacked,'code/apps/wallet-desktop',relative)}));
 for(const row of moves){
  try{fs.lstatSync(row.after);throw Error('PORTABLE_PACK_DESTINATION_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  let parent=path.dirname(row.after);
  while(parent!==unpacked){try{const s=fs.lstatSync(parent);if(s.isSymbolicLink()||!s.isDirectory())throw Error('PORTABLE_PACK_REGULAR_DIRECTORY_REQUIRED');}catch(error){if(error.code!=='ENOENT')throw error;}parent=path.dirname(parent);}
 }
 const moved=[];
 const rollback=()=>{while(moved.length){const row=moved.at(-1);fs.renameSync(row.after,row.before);moved.pop();}};
 try{for(const row of moves){fs.mkdirSync(path.dirname(row.after),{recursive:true});fs.renameSync(row.before,row.after);moved.push(row);}}
 catch(error){try{rollback();}catch(cleanup){throw new NativePackageRecoveryError([error,cleanup],'Native asset relocation and rollback failed',{cause:error});}throw error;}
 return {rollback,files:moves.length};
}

export function verifyPortableRuntimePackage(resources,projectDir){
 const identityPath=path.join(resources,'ynx-wallet-build-identity.json');
 const identity=fs.existsSync(identityPath)?JSON.parse(fs.readFileSync(identityPath,'utf8')):{};
 if(identity.nativeComponentSelection){
  const component=desktopPackageNativeIdentityComponent(identity.nativeComponentSelection);
  const physical=fs.existsSync(path.join(resources,'ynx-wallet-physical-code-layout.json'));
  const relative='code/'+component.selection.recordRelative;
  const bytes=physical?fs.readFileSync(path.join(resources,'app.code',relative)):createRequire(path.join(projectDir,'package.json'))('@electron/asar').extractFile(path.join(resources,'app.asar'),relative);
  return component.verifyRuntime(path.join(resources,physical?'app.code':'app.asar.unpacked'),bytes,{canonical:true});
 }

 const record=JSON.parse(fs.readFileSync(path.join(projectDir,'native/original-auth-identity-build.json'),'utf8'));
 if(!isPortableQARecord(record))return null;
 const physical=fs.existsSync(path.join(resources,'ynx-wallet-physical-code-layout.json'));
 return verifyPortableRuntimeFiles(record,path.join(resources,physical?'app.code':'app.asar.unpacked'),{canonical:true});
}

export const PORTABLE_NESTED_SIGN_IGNORE='/Contents/Resources/(?:app\\.asar\\.unpacked|app\\.code)/code/apps/wallet-desktop/native/(?:original-auth-identity\\.node|original-auth-runtime-libs/(?:libssl\\.3|libcrypto\\.3|libuv\\.1)\\.dylib)$';

export function preservePortableNestedSignatures(record,macOptions){
 if(!isPortableQARecord(record))return;
 // Only an actual portable role adds the closed paths. The four binaries were
 // signed and hashed by the normal Native builder before the record/ASAR.
 portableRuntimeAssets(record);
 const old=macOptions.signIgnore??[];
 if(!Array.isArray(old)||old.some(x=>typeof x!=='string'))throw Error('PORTABLE_PACK_SIGN_IGNORE_INVALID');
 macOptions.signIgnore=[...new Set([...old,PORTABLE_NESTED_SIGN_IGNORE])];
}

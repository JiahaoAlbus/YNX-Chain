// Main's normal build-time stage/ASAR adapter. This is not a runtime Source,
// Native loader or helper qualification. The old C227 cache/125a record stay.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {native49C6NormalNodeComponent} from './sdk13-native-component.mjs';
import {canonicalSourcePath} from './canonical-package.mjs';
import selected from './desktop-native49-c6-selection.json' with {type:'json'};

function freeze(value){if(value&&typeof value==='object'){for(const x of Object.values(value))freeze(x);Object.freeze(value);}return value;}
export const desktopNative49C6Selection=freeze(selected);
export const DESKTOP_C6_METADATA_ROLE='YNX_DESKTOP_SEPARATE_C6_NODE_SELECTION/v1';
export function desktopNative49C6Selected(metadata){
  if(!Object.hasOwn(metadata,'ynxNativeComponent'))return false;
  if(metadata.ynxNativeComponent!==DESKTOP_C6_METADATA_ROLE)throw Error('C6_UNKNOWN_PACKAGE_SELECTION');
  return true;
}
export function desktopNative49C6BuilderConfiguration(metadata){
  const old=metadata.build.files;
  const excluded=new Set(['native/original-auth-identity.node','native/original-auth-runtime-libs/{libssl.3.dylib,libcrypto.3.dylib,libuv.1.dylib,OPENSSL-LICENSE.txt,OPENSSL-AUTHORS.md,LIBUV-LICENSE.txt,LIBUV-LICENSE-extra.txt,LIBUV-LICENSE-docs.txt}']);
  if(!Array.isArray(old)||[...excluded].some(p=>!old.includes(p)))throw Error('C6_NORMAL_FILE_CONFIGURATION_CHANGED');
  // Builder tests asarUnpack against absolute SOURCE paths before FileSet.to mapping.
  // Keep the exact nine staged paths closed; the new record remains packed DATA.
  return {...metadata.build,mac:{...metadata.build.mac,minimumSystemVersion:selected.minimumMacOS},asarUnpack:[...metadata.build.asarUnpack,...selected.assets.filter(row=>!row.path.endsWith('/NATIVE49_C6_NORMAL_RECORD.json')).map(row=>stageRelative+'/'+row.path)],extraMetadata:{...metadata.build.extraMetadata,ynxNativeComponent:DESKTOP_C6_METADATA_ROLE},files:[...old.filter(p=>!excluded.has(p)),desktopNative49C6FileSet(),{from:"../developer/helper",to:"native/helper-data",filter:[path.posix.basename(selected.helperPlist.source)]}]};
}
const fail=code=>{throw Object.assign(Error(code),{code});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stageRelative='native/.native49-c6-input';

function regularRoot(root){
  if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root||fs.realpathSync(root)!==path.resolve(root)||!fs.lstatSync(root).isDirectory())fail('C6_REGULAR_ABSOLUTE_ROOT_REQUIRED');
}
function checkedAsset(root,row){
  regularRoot(root);let target=root;
  for(const part of row.path.split('/')){
    target=path.join(target,part);
    if(fs.lstatSync(target).isSymbolicLink())fail('C6_STAGE_SYMLINK');
  }
  const before=fs.lstatSync(target);
  if(!before.isFile()||before.size!==row.bytes||(before.mode&0o777)!==row.mode)fail('C6_STAGE_FILE_OR_MODE');
  const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
    const first=fs.fstatSync(fd),bytes=fs.readFileSync(fd),last=fs.fstatSync(fd),current=fs.lstatSync(target);
    if(first.dev!==before.dev||first.ino!==before.ino||first.size!==before.size||first.dev!==last.dev||first.ino!==last.ino||first.size!==last.size||first.mtimeMs!==last.mtimeMs||current.dev!==first.dev||current.ino!==first.ino||current.isSymbolicLink())fail('C6_STAGE_FILE_CHANGED');
    if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)fail('C6_STAGE_PIN');
    return bytes;
  }finally{fs.closeSync(fd);}
}
function readAsset(root,relative){
  const row=selected.assets.find(row=>row.path===relative);
  if(!row)fail('C6_UNLISTED_ASSET');
  return checkedAsset(root,row);
}
export function verifyDesktopNative49C6Input(root,sourceRoles=selected.sourceRoles){
  if(!isDeepStrictEqual(sourceRoles,selected.sourceRoles))fail('C6_INDEPENDENT_SOURCE_SELECTION');
  return native49C6NormalNodeComponent.verifyPackage({readPackedAsset:relative=>readAsset(root,relative),sourceRoles:selected.sourceRoles});
}
export function desktopNative49C6StageRoot(projectDir){return path.join(projectDir,stageRelative);}
export function stageDesktopNative49C6Input(projectDir,inputRoot){
  regularRoot(projectDir);verifyDesktopNative49C6Input(inputRoot);
  const destination=desktopNative49C6StageRoot(projectDir);
  if(fs.existsSync(destination)){
    verifyDesktopNative49C6Input(destination);
    return Object.freeze({destination,reused:true,files:selected.assets.length,oldNativeReplaced:false,recordRewritten:false});
  }
  fs.mkdirSync(destination,{recursive:false});
  // A partial stage is retained on error, never deleted/replaced to hide it.
  for(const row of selected.assets){
    const bytes=checkedAsset(inputRoot,row),file=path.join(destination,row.path);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:row.mode});fs.chmodSync(file,row.mode);
  }
  verifyDesktopNative49C6Input(destination);
  return Object.freeze({destination,reused:false,files:selected.assets.length,oldNativeReplaced:false,recordRewritten:false});
}
export function desktopNative49C6FileSet(){
  // electron-builder normalizes FileSet.to in place when loading a config.
  return {from:stageRelative+'/apps/wallet-desktop',to:'.',filter:selected.assets.map(row=>row.path.slice('apps/wallet-desktop/'.length))};
}
export function verifyDesktopNative49C6ASAR({asar,archive,projectDir}){
  const stage=desktopNative49C6StageRoot(projectDir);
  return native49C6NormalNodeComponent.verifyPackage({sourceRoles:selected.sourceRoles,readPackedAsset:relative=>{
    const name=canonicalSourcePath(relative),info=asar.statFile(archive,name,false);
    if(info.files||info.link||!!info.unpacked!==!relative.endsWith('/NATIVE49_C6_NORMAL_RECORD.json'))fail('C6_ASAR_ASSET_LAYOUT');
    const bytes=asar.extractFile(archive,name),local=readAsset(stage,relative);
    if(!Buffer.isBuffer(bytes)||!bytes.equals(local))fail('C6_PACKAGED_STAGE_DIFFERS');
    return bytes;
  }});
}

// Directories are used only by the packaging reader. The separate record is
// packed DATA; the nine binaries/licenses retain the original unpacked paths.
export function verifyDesktopNative49C6Runtime(root,recordBytes,{canonical=false}={}){
  return native49C6NormalNodeComponent.verifyPackage({sourceRoles:selected.sourceRoles,readPackedAsset:relative=>{
    if(relative.endsWith('/NATIVE49_C6_NORMAL_RECORD.json'))return recordBytes;
    const row=selected.assets.find(row=>row.path===relative);
    if(!row)fail('C6_UNLISTED_RUNTIME_ASSET');
    return checkedAsset(root,{...row,path:canonical?'code/'+relative:relative.slice('apps/wallet-desktop/'.length)});
  }});
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv.length!==5||process.argv[2]!=='--stage')fail('C6_EXACT_STAGE_ARGV');
  console.log(JSON.stringify(stageDesktopNative49C6Input(process.argv[3],process.argv[4]),null,2));
}

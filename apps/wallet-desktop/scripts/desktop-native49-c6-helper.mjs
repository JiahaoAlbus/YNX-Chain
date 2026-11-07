// Main normal helper-only source/bundle composition. Never accepts Node bytes,
// invokes a helper, registers a service or changes the original failed record.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyApproved125aHelperComponent,verifySDK13HelperBundle,SDK13_HELPER_ASSET,SDK13_HELPER_PLIST,SDK13_BUNDLE_HELPER,SDK13_BUNDLE_PLIST} from './sdk13-native-component.mjs';
import {desktopNative49C6Selection as selected} from './desktop-native49-c6-pack.mjs';
import {canonicalSourcePath} from './canonical-package.mjs';
export function desktopC6HelperPackedPath(relative){
 if(relative===SDK13_HELPER_PLIST)return canonicalSourcePath(selected.helperPlist.packedSource);
 if(relative===SDK13_HELPER_ASSET)return canonicalSourcePath(relative);
 throw Error('C6_HELPER_UNLISTED_PACKED_ASSET');
}
export function verifyDesktopC6ApprovedHelper({projectDir,recordBytes,readPackedAsset}){
 const root=path.resolve(projectDir,'../..'),tuple=selected.approved125aHelperSource;
 const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:16<<20});
 for(const [commit,tree] of [[tuple.compileCommit,tuple.compileTree],[tuple.producerCommit,tuple.producerTree]])if(git('rev-parse',commit+'^{tree}').toString().trim()!==tree)throw Error('C6_HELPER_ORIGINAL_TREE_DIFFERS');
 const current=git('rev-parse','HEAD').toString().trim();
 return verifyApproved125aHelperComponent({recordBytes,originalAttemptBytes:git('show',current+':apps/wallet-desktop/scripts/desktop-native49-c6-helper-original-attempt.json'),expectedHelperSourceTuple:tuple,readSource:(relative,commit)=>{if(![tuple.compileCommit,tuple.producerCommit].includes(commit))throw Error('C6_HELPER_UNLISTED_SOURCE');return git('show',commit+':'+relative);},readPackedAsset});
}
function regular(root,relative){let p=root;for(const part of relative.split('/')){p=path.join(p,part);if(fs.lstatSync(p).isSymbolicLink())throw Error('C6_HELPER_SYMLINK');}if(!fs.lstatSync(p).isFile())throw Error('C6_HELPER_REGULAR_FILE_REQUIRED');return fs.readFileSync(p);}
export function stageDesktopC6ApprovedHelper({contents,projectDir}){
 const root=path.resolve(projectDir,'../..');
 const helper=regular(root,SDK13_HELPER_ASSET),plist=regular(root,SDK13_HELPER_PLIST),recordBytes=regular(root,selected.legacyHelperRecord.relative);
 const component=verifyDesktopC6ApprovedHelper({projectDir,recordBytes,readPackedAsset:relative=>relative===SDK13_HELPER_ASSET?helper:relative===SDK13_HELPER_PLIST?plist:(()=>{throw Error('C6_HELPER_UNLISTED_ASSET');})()});
 if(!path.isAbsolute(contents)||path.normalize(contents)!==contents||fs.realpathSync(contents)!==contents||!fs.lstatSync(contents).isDirectory())throw Error('C6_HELPER_BUNDLE_ROOT');
 for(const [relative,bytes,mode] of [[SDK13_BUNDLE_HELPER,helper,0o755],[SDK13_BUNDLE_PLIST,plist,0o644]]){
  let parent=contents;for(const part of path.posix.dirname(relative).split('/')){parent=path.join(parent,part);try{const stat=fs.lstatSync(parent);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('C6_HELPER_BUNDLE_DIRECTORY');}catch(e){if(e.code!=='ENOENT')throw e;fs.mkdirSync(parent,{mode:0o755});}}
  const target=path.join(contents,relative);try{const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o777)!==mode||!fs.readFileSync(target).equals(bytes))throw Error('C6_HELPER_BUNDLE_CONFLICT');}catch(e){if(e.code!=='ENOENT')throw e;fs.writeFileSync(target,bytes,{flag:'wx',mode});}
 }
 return {component,bundle:verifySDK13HelperBundle(contents,helper,plist),executed:false,serviceRegistered:false,RootAdmission:false,SourceAdmission:false};
}

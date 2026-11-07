/** Build/artifact evidence only. Does not load Native, authenticate a peer, or qualify a helper. */
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const role=JSON.parse(readFileSync(path.join(here,'native49-c6-normal-component.data.json'),'utf8'));
const fail=c=>{throw Error('NATIVE49_C6_'+c);};
const same=(a,b,c)=>{if(!isDeepStrictEqual(a,b))fail(c);};
const hash=b=>createHash('sha256').update(b).digest('hex');
function pinned(b,p,c){if(!Buffer.isBuffer(b)||b.length!==p.bytes||hash(b)!==p.sha256)fail(c);return b;}
// Fixed input selector is compiled into this finite artifact role, never a caller URI/provider.
function regular(p){const parts=path.resolve(p).split(path.sep);let q=path.parse(p).root;for(const part of parts.filter(Boolean)){q=path.join(q,part);if(lstatSync(q).isSymbolicLink())fail('SYMLINK');}const a=lstatSync(p);if(!a.isFile()||a.size>(16<<20))fail('REGULAR_FILE');const fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const s=fstatSync(fd);if(a.dev!==s.dev||a.ino!==s.ino||a.size!==s.size||!s.isFile())fail('FILE_RACE');const b=readFileSync(fd),t=fstatSync(fd),u=lstatSync(p);if(t.dev!==s.dev||t.ino!==s.ino||t.size!==s.size||t.mtimeMs!==s.mtimeMs||u.dev!==s.dev||u.ino!==s.ino)fail('FILE_RACE');return b;}finally{closeSync(fd);}}
const result=()=>Object.freeze({kind:role.kind,nodeArtifactBytesVerified:true,recordBytesVerified:true,compiledCPPSourceCommit:role.sourceRoles.reusedCPPSourceCommit,swiftBuilderCommit:role.sourceRoles.swiftBuilderCommit,reusedCPP:84,compiledSwift:1,ledgerActions:17,SwiftGlobalNonPrivateFunctions:11,singleGoStrongSymbols:49,helperQualification:'NOT_SUPPLIED_BY_THIS_NODE_ROLE',JSRuntimeQualification:'SEPARATE_ROLE_REQUIRED',RootAdmission:false,SourceAdmission:false,NativeAdmission:false,actualPeer:false,wholeAppReady:false,installed:false,businessVerified:false,NativeLoaded:false});
export function verifyNative49C6ArtifactDATA(relative,bytes){
 const expected=role.artifacts.find(a=>a.path===relative);if(!expected)fail('UNKNOWN_ARTIFACT');pinned(bytes,expected,'ARTIFACT_BYTES');
 return Object.freeze({bytesVerified:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}
/** Normal pack hook, analogous to verifySDK13NativeComponent, deliberately Node-only.
 * sourceRoles must come from the packer's independent expected source selection, never record.plan.
 * runtimeFiles has exact nine package-relative names, including moduleBytes' node asset.
 */
export function inspectNative49C6NormalRecordDATA(recordBytes,sourceRoles){
 pinned(recordBytes,role.record,'RECORD_BYTES');same(sourceRoles,role.sourceRoles,'SOURCE_ROLES');
 const r=JSON.parse(recordBytes),p=JSON.parse(pinned(readFileSync(path.join(here,'native49-c6-plan.json')),role.independentPlan,'INDEPENDENT_PLAN'));
 delete p.compilerExecutedHere;delete p.NativeExecutedHere;same(r.plan,p,'PLAN');
 same(r.kind,'YNX_SINGLE49_REUSED_CPP_SWIFT_PUBLIC_REPAIR_NORMAL_RECORD/v1','RECORD_KIND');
 same(r.ledger.length,17,'LEDGER');for(const x of r.ledger)if(x.exit!==0||x.signal!==null||x.error!==null)fail('FAILED_LEDGER');
 return Object.freeze({recordDataVerified:true,artifactBytesVerified:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,wholeAppReady:false});
}
export function verifyNative49C6NormalNodeComponent({recordBytes,moduleBytes,runtimeFiles,sourceRoles}){
 inspectNative49C6NormalRecordDATA(recordBytes,sourceRoles);
 pinned(moduleBytes,role.image,'IMAGE');
 if(!runtimeFiles||Object.getPrototypeOf(runtimeFiles)!==Object.prototype)fail('RUNTIME_FILES');
 same(Reflect.ownKeys(runtimeFiles).sort(),role.artifacts.map(x=>x.path).sort(),'RUNTIME_SET');
 for(const a of role.artifacts){const d=Object.getOwnPropertyDescriptor(runtimeFiles,a.path);if(!d||!Object.hasOwn(d,'value'))fail('RUNTIME_DESCRIPTOR');verifyNative49C6ArtifactDATA(a.path,d.value);if(a.path.endsWith('.node'))same(d.value,moduleBytes,'IMAGE_RUNTIME');}
 return result();
}
/** Fixed original-A normal read entry. Read-only proof/source validation; does not run an image.
 * It reuses the real producer's --read implementation after exact source bytes have been checked.
 */
export async function readNative49C6NormalNodeComponent(){
 pinned(regular(role.qualifiedH.path),role.qualifiedH,'HANDOFF');
 for(const p of [...role.proofFiles,...role.reusedCPPObjects])pinned(regular(p.path),p,'PROOF');
 for(const p of role.sourceFiles){const file=path.join(role.sourceRoot,p.path);pinned(regular(file),p,'SOURCE_BYTES');if((lstatSync(file).mode&0o777)!==(p.gitMode==='100755'?0o755:0o644))fail('SOURCE_MODE');}
 const recordBytes=pinned(regular(role.record.path),role.record,'RECORD_BYTES'),runtimeFiles={};for(const a of role.artifacts)runtimeFiles[a.path]=regular(a.source);
 const checked=verifyNative49C6NormalNodeComponent({recordBytes,moduleBytes:regular(role.image.path),runtimeFiles,sourceRoles:role.sourceRoles});
 const producer=await import(pathToFileURL(path.join(role.sourceRoot,'apps/wallet-desktop/scripts/original-auth-single49-network-swift-repair.mjs')).href);
 const original=producer.verifyOriginalAuthSingle49SwiftVisibilityRepairRecord();
 if(original.complete!==true||original.NativeLoadedByReader!==false)fail('ORIGINAL_NORMAL_READER');
 return {...checked,originalNormalReader:original,sourceFilesVerified:role.sourceFiles.length,directProofsVerified:role.proofFiles.length};
}
/** Normal packer's build-time asset reader, equivalent to its existing readSource callback.
 * It reads fixed asset names only. This callback is not a Source, signer or runtime provider.
 * The raw original record remains a separate sidecar; the legacy helper receipt is untouched.
 */
export function verifyNative49C6PackagedNode({readPackedAsset,sourceRoles}){
 if(typeof readPackedAsset!=='function')fail('PACKAGE_READER');
 const runtimeFiles={};for(const a of role.artifacts)runtimeFiles[a.path]=readPackedAsset(a.path);
 return verifyNative49C6NormalNodeComponent({recordBytes:readPackedAsset('apps/wallet-desktop/native/NATIVE49_C6_NORMAL_RECORD.json'),moduleBytes:runtimeFiles['apps/wallet-desktop/native/original-auth-identity.node'],runtimeFiles,sourceRoles});
}
export function verifyNative49C6PackageDirectoryDATA(root){
 if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root)fail('PACKAGE_DIRECTORY');
 return verifyNative49C6PackagedNode({readPackedAsset:name=>regular(path.join(root,name)),sourceRoles:role.sourceRoles});
}
/** Actual normal-pack object method; helper/JS-runtime verifiers remain independently owned. */
export const native49C6NormalNodeComponent=Object.freeze({inspectRecord:inspectNative49C6NormalRecordDATA,verify:verifyNative49C6NormalNodeComponent,read:readNative49C6NormalNodeComponent,verifyPackage:verifyNative49C6PackagedNode,verifyDirectory:verifyNative49C6PackageDirectoryDATA});
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let r;if(process.argv.length===3&&process.argv[2]==='--read')r=await native49C6NormalNodeComponent.read();
 else if(process.argv.length===4&&process.argv[2]==='--verify-package')r=native49C6NormalNodeComponent.verifyDirectory(process.argv[3]);
 else fail('EXACT_ARGV');console.log(JSON.stringify(r,null,2));
}

import {createHash} from 'node:crypto';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {canonicalNativeInputSelection,verifyCanonicalNativeReceipt,CANONICAL_NATIVE_EVIDENCE_TESTS} from './canonical-package.mjs';
import {WALLET_PUBLISHER_NATIVE_INPUTS} from './wallet-publisher-native-build.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('SDK13 matched native component differs');};
export const SDK13_HELPER_ASSET='apps/wallet-desktop/native/YNXIdentityReceiver';
export const SDK13_HELPER_SOURCE_OUTPUT='apps/developer/helper/YNXIdentityReceiver';
export const SDK13_HELPER_PLIST='apps/developer/helper/com.ynxweb4.developer.testnetpreview.identity-receiver.plist';
export const SDK13_BUNDLE_HELPER='Library/HelperTools/YNXIdentityReceiver';
export const SDK13_BUNDLE_PLIST='Library/LaunchDaemons/com.ynxweb4.developer.testnetpreview.identity-receiver.plist';
export const SDK13_INVENTORY_PIN=Object.freeze({bytes:30418,sha256:'3d256c3c4581748448026d53bfd8160be1e00b80733b3d4c03af5ad30fb68a3c'});
const plistPin=Object.freeze({bytes:473,sha256:'08c5483639227287de41e081c61e3d2e5238db72122d08f5f397d8f4e78af69b'});
export const SDK13_HELPER_TRANSLATION_UNITS=Object.freeze(['apps/developer/helper/main.mm',...['original-ide-helper-listener.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-kernel.mm','original-ide-parent-source-binding.mm'].map(n=>'packages/wallet-auth/native/'+n),'apps/wallet-desktop/native/original-ide-auth-request-source.inc.mm','packages/wallet-auth/native/original-ide-helper-client.mm','packages/wallet-auth/native/original-ide-publication-artifact.mm']);
function absolute(p){if(typeof p!=='string'||!path.isAbsolute(p)||path.normalize(p)!==p||p.includes('\0'))fail();}
function pinned(bytes,p){if(!Buffer.isBuffer(bytes)||!p||bytes.length!==p.bytes||hash(bytes)!==p.sha256)fail();return bytes;}
const same=(a,b)=>{if(!isDeepStrictEqual(a,b))fail();};
export function sdk13HelperBuildCommands(sourceRoot,architectures){
 absolute(sourceRoot);if(!Array.isArray(architectures)||architectures.length<1||architectures.length>2||new Set(architectures).size!==architectures.length||architectures.some(a=>!['arm64','x86_64'].includes(a)))fail();
 const output=path.join(sourceRoot,SDK13_HELPER_SOURCE_OUTPUT),universal=architectures.length===2;
 if(universal)same(architectures,['arm64','x86_64']);
 const commands=architectures.map(arch=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-I'+path.join(sourceRoot,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security','-framework','ServiceManagement','-lbsm','-arch',arch,...SDK13_HELPER_TRANSLATION_UNITS.map(n=>path.join(sourceRoot,n)),'-o',output+(universal?'.'+(arch==='x86_64'?'x64':arch):'')]}));
 if(universal)commands.push({tool:'/usr/bin/lipo',argv:['-create',output+'.arm64',output+'.x64','-output',output]});
 return commands;
}
/** Verifies DATA, source and bytes. An executed build record is not a Source
 * registration, service install, user approval or accepted release signature.
 * The builder must separately attest the actual command execution.
 */
export function verifySDK13NativeComponent({record,inventoryBytes,moduleBytes,helperBytes},readSource){
 const inventory=JSON.parse(pinned(inventoryBytes,SDK13_INVENTORY_PIN));
 if(inventory.version!=='1.3.0-pq.3.32-auth.13'||record?.readbackOnly!==false||record?.commandsKind!=='executed-normal-build'||typeof readSource!=='function')fail();
 same(record.sourceInventory,{relative:'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json',...SDK13_INVENTORY_PIN});
 const helper=record.helperBuild;
 if(!helper||helper.kind!=='YNX_WALLET_ORIGINAL_HELPER_BUILD/v1'||helper.sourceRoot!==record.sourceRoot||helper.readbackOnly!==false||helper.commandsKind!=='executed-normal-build'||helper.executed!==true||helper.serviceRegistered!==false||helper.installed!==false||helper.nativeQualified!==false||helper.appSigned!==false)fail();
 same(helper.architectures,record.architectures);same(helper.commands,sdk13HelperBuildCommands(record.sourceRoot,record.architectures));same(helper.exitCodes,helper.commands.map(()=>0));
 same(record.exitCodes,record.commands.map(()=>0));
 const supplier=[...inventory.NativeInputs,...inventory.HelperInputs];
 const rows=supplier.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
 same(helper.inputFiles,rows);
 for(const p of supplier)pinned(readSource(p.path),p);
 for(const p of WALLET_PUBLISHER_NATIVE_INPUTS)pinned(readSource(p.path),p);
 const names=[...inventory.NativeInputs.map(p=>p.path),...WALLET_PUBLISHER_NATIVE_INPUTS.map(p=>p.path),...inventory.HelperInputs.filter(p=>p.path.startsWith('packages/wallet-auth/native/')).map(p=>p.path),...CANONICAL_NATIVE_EVIDENCE_TESTS];
 const selection=canonicalNativeInputSelection(inventory.version,names,inventoryBytes,record.inputFiles);
 const checked=verifyCanonicalNativeReceipt(record,moduleBytes,selection.inputs,readSource);
 if(helper.output?.relative!==SDK13_HELPER_SOURCE_OUTPUT||helper.packagedOutput!==SDK13_HELPER_ASSET)fail();pinned(helperBytes,helper.output);
 same(helper.plist,{relative:SDK13_HELPER_PLIST,...plistPin});pinned(readSource(SDK13_HELPER_PLIST),plistPin);
 for(const [owner,output]of [[record,'apps/wallet-desktop/native/original-auth-identity.node'],[helper,SDK13_HELPER_SOURCE_OUTPUT]]){
  const scan=owner.ownedUndefinedScan;
  if(!scan||scan.tool!=='/usr/bin/nm'||scan.exit!==0||typeof scan.stdoutSHA256!=='string'||!/^[a-f0-9]{64}$/.test(scan.stdoutSHA256))fail();
  same(scan.argv,['-u',path.join(record.sourceRoot,output)]);same(scan.ownedUndefined,[]);
 }
 return {...checked,sourceBytesVerified:true,artifactBytesVerified:true,walletInputs:selection.walletInputs,supplierNodeInputCount:69,helper:{output:helper.output,packagedOutput:helper.packagedOutput,translationUnits:11,sourceInputs:74},installed:false,serviceRegistered:false};
}
function regular(file){const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())fail();return readFileSync(file);}
function bundleRows(helperBytes,plistBytes){return [[SDK13_BUNDLE_HELPER,helperBytes,0o755],[SDK13_BUNDLE_PLIST,plistBytes,0o644]];}
export function stageSDK13HelperBundle({contents,projectDir}){
 absolute(contents);absolute(projectDir);const repo=path.resolve(projectDir,'../..');
 const record=JSON.parse(regular(path.join(projectDir,'native/original-auth-identity-build.json'))),helper=regular(path.join(repo,SDK13_HELPER_ASSET)),plist=regular(path.join(repo,SDK13_HELPER_PLIST));
 verifySDK13NativeComponent({record,inventoryBytes:regular(path.join(repo,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json')),moduleBytes:regular(path.join(projectDir,'native/original-auth-identity.node')),helperBytes:helper},name=>regular(path.join(repo,name)));
 const root=lstatSync(contents);if(!root.isDirectory()||root.isSymbolicLink())fail();
 for(const [relative,body,mode]of bundleRows(helper,plist)){
  let directory=contents;for(const part of path.posix.dirname(relative).split('/')){directory=path.join(directory,part);try{const s=lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink())fail();}catch(e){if(e.code!=='ENOENT')throw e;mkdirSync(directory,{mode:0o755});}}
  const target=path.join(contents,relative);let exists=false;try{const s=lstatSync(target);if(!regular(target).equals(body)||(s.mode&0o777)!==mode)fail();exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!exists)writeFileSync(target,body,{flag:'wx',mode});if(!regular(target).equals(body))fail();
 }
 return {staged:true,serviceRegistered:false,installed:false,executed:false,nativeQualified:false};
}
export function verifySDK13HelperBundle(contents,helperBytes,plistBytes){
 absolute(contents);pinned(plistBytes,plistPin);
 for(const part of ['Library','Library/HelperTools','Library/LaunchDaemons']){const s=lstatSync(path.join(contents,part));if(!s.isDirectory()||s.isSymbolicLink())fail();}
 for(const [relative,bytes,mode]of bundleRows(helperBytes,plistBytes)){const file=path.join(contents,relative),s=lstatSync(file);if((s.mode&0o777)!==mode||!regular(file).equals(bytes))fail();}
 return {bytesVerified:true,serviceRegistered:false,installed:false,executed:false,nativeQualified:false};
}

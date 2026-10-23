// Original executed supplier record, not the older build-plan schema. Keeping
// this distinct prevents relabeling an external Auth build as an A/Main build.
import {createHash} from 'node:crypto';
import path from 'node:path';
import {isDeepStrictEqual,types} from 'node:util';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('R155 original paired component record differs')};
export const R155_INTAKE_ASSET='apps/wallet-desktop/native/original-auth-identity-r155-source-intake.json';
export const R155_HELPER_ASSET='apps/wallet-desktop/native/YNXIdentityReceiver';
export const R155_RECORD_PIN=Object.freeze({bytes:11296,sha256:'8ad8c5b38ea83945f93f2ee1a8f44440f5a48b471796613f745a216471bd5caf'});
export const R155_INTAKE_PIN=Object.freeze({bytes:33995,sha256:'52be5da510d0eaf33fd94cf0813fb0697c19765e963a38fc8c5f0bd44834d15a'});
const inventoryPins=[{bytes:24580,sha256:'f74b7e805eebb86b1adff2f5865641d8c6cade0159bcf8f1baf214ae34d81b92'},{bytes:24580,sha256:'cd7dd07ddd14d37e76b897fc179c5582cd739029a834a7134b0f8d9c9fe857f8'}];
const headers=[
 ['node_api.h',10731,'a6d6732d02b9ece6b53168edc3f8a53af2653db6a7ae13b1c03987e32e2d0125'],
 ['node_api_types.h',1603,'8d5d854088d5725fec9775510e0aeeeb790a41ad083c49bb721d950b86e6bd61'],
 ['js_native_api.h',32182,'89393f07881fcba3ed097a5989fba1746f1c2cf611f19ba4dcb17071da8a661e'],
 ['js_native_api_types.h',7033,'0410c31e227f81e2981363c4d543f4832ac3df785343ec64cee621742ff8a034']
];
const native=n=>'packages/wallet-auth/native/'+n;
const nodeTUs=['apps/wallet-desktop/native/original-auth-identity-node.mm',...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm','original-ide-wallet-identity-source.mm','original-ide-wallet-peer-launch.mm','original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm'].map(native)];
const helperTUs=['apps/developer/helper/main.mm',...['original-ide-helper-listener.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-kernel.mm','original-ide-parent-source-binding.mm','original-ide-helper-client.mm'].map(native),'apps/wallet-desktop/native/original-ide-auth-request-source.inc.mm'];
const eq=(a,b)=>{if(!isDeepStrictEqual(a,b))fail()};
function data(value){
 if(value===null||['string','boolean','number'].includes(typeof value))return;
 if(!value||types.isProxy(value)||![Object.prototype,Array.prototype].includes(Object.getPrototypeOf(value)))fail();
 for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(value))){if(Array.isArray(value)&&k==='length')continue;if(!Object.hasOwn(d,'value')||!d.enumerable)fail();data(d.value)}
 if(Reflect.ownKeys(value).some(k=>typeof k!=='string'))fail();
}
const pin=p=>{if(!p||!Number.isSafeInteger(p.bytes)||p.bytes<1||! /^[a-f0-9]{64}$/.test(p.sha256??''))fail()};
const absolute=p=>{if(typeof p!=='string'||!path.isAbsolute(p)||path.normalize(p)!==p||p.includes('\0'))fail()};
/** Metadata validation alone is deliberately NOT artifact/source validation.
 * Tests may exercise this DATA grammar; production must use the wrapper below. */
export function inspectR155ProducerMetadata(record,intake,inventory){
 data(record);data(intake);data(inventory);
 if(record.pass!==true||record.PUBLICSubstitutes!==false||record.realKernelAndSource!==true||record.architecture!=='darwin-arm64'||record.sourceFiles!==67)fail();
 for(const k of ['loaded','executed','signedByAcceptedDeveloperID','notarized','installed','Root'])if(record[k]!==false)fail();
 eq(record.ownUndefined,[]);eq([inventory.NativeInputs.length,inventory.HelperInputs.length],[62,5]);
 if(!['1.3.0-pq.3.32-auth.5','1.3.0-pq.3.32-auth.6'].includes(inventory.version))fail();
 const inputs=[...inventory.NativeInputs,...inventory.HelperInputs].map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
 const selected=intake.files.map(p=>({relative:p.relative,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en'));
 if(new Set(inputs.map(p=>p.relative)).size!==67)fail();eq(selected,inputs);for(const p of inputs)pin(p);
 absolute(intake.sourceRoot);absolute(record.out);absolute(record.intake);
 const sourceRoot=intake.sourceRoot,headerRoot=path.dirname(record.headerRefs[0].path);
 if(record.headerRefs.length!==4)fail();
 eq(record.headerRefs.map(p=>({name:path.basename(p.path),bytes:p.bytes,sha256:p.sha256})),headers.map(([name,bytes,sha256])=>({name,bytes,sha256})));
 for(const p of record.headerRefs){absolute(p.path);if(path.dirname(p.path)!==headerRoot)fail()}
 eq(record.nodeTUs,nodeTUs.map(p=>path.join(sourceRoot,p)));eq(record.helperTUs,helperTUs.map(p=>path.join(sourceRoot,p)));
 const common=['-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-arch','arm64','-I'+path.join(sourceRoot,'packages/wallet-auth/native')];
 const frameworks=names=>names.flatMap(n=>['-framework',n]);
 const nodeArgs=[...common,'-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-I'+headerRoot,...frameworks(['Foundation','Security','AppKit','ServiceManagement']),'-lbsm',...record.nodeTUs,'-o',path.join(record.out,'original-auth-identity.node')];
 const helperArgs=[...common,...frameworks(['Foundation','Security','ServiceManagement']),'-lbsm',...record.helperTUs,'-o',path.join(record.out,'YNXIdentityReceiver')];
 eq(record.steps,[{name:'normalNode11',tool:'/usr/bin/clang++',args:nodeArgs,exit:0,signal:null},{name:'normalHelper10',tool:'/usr/bin/clang++',args:helperArgs,exit:0,signal:null}]);
 if(record.artifacts.length!==2)fail();for(const p of record.artifacts)pin(p);
 eq(record.artifacts.map(p=>p.path),[path.join(record.out,'original-auth-identity.node'),path.join(record.out,'YNXIdentityReceiver')]);
 return {inputs,nodeInputFiles:inventory.NativeInputs.map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})),artifacts:record.artifacts,sourceRoot,headerRoot,metadataVerified:true,artifactBytesVerified:false,sourceBytesVerified:false,nativeQualified:false,installed:false};
}
function pinned(bytes,p){if(!Buffer.isBuffer(bytes)||bytes.length!==p.bytes||sha(bytes)!==p.sha256)fail();return bytes}
/** Actual frozen producer supply. Never executes/loads a binary or rewrites
 * original paths/argv/flags. A future producer record needs its own profile. */
export function verifyOriginalR155Component({recordBytes,intakeBytes,inventoryBytes,moduleBytes,helperBytes},readSource){
 const record=JSON.parse(pinned(recordBytes,R155_RECORD_PIN)),intake=JSON.parse(pinned(intakeBytes,R155_INTAKE_PIN));
 if(!Buffer.isBuffer(inventoryBytes)||!inventoryPins.some(p=>inventoryBytes.length===p.bytes&&sha(inventoryBytes)===p.sha256))fail();
 const inventory=JSON.parse(inventoryBytes);
 if(record.bytes!==R155_INTAKE_PIN.bytes||record.sha256!==R155_INTAKE_PIN.sha256)fail();
 const checked=inspectR155ProducerMetadata(record,intake,inventory);
 pinned(moduleBytes,checked.artifacts[0]);pinned(helperBytes,checked.artifacts[1]);
 if(typeof readSource!=='function')fail();for(const p of checked.inputs)pinned(readSource(p.relative),p);
 return {...checked,output:checked.artifacts[0],helper:checked.artifacts[1],pinsVerified:true,artifactBytesVerified:true,sourceBytesVerified:true,headerVersion:'22.13.1',napiVersion:8,minimumSystemVersion:'13.0',readbackOnly:false,consumerReadbackOnly:true,commandsKind:'original-r155-executed-supplier-record',appSigned:false,nativeQualified:false,loaded:false,installed:false};
}
const helperPin={bytes:645456,sha256:'f83ff102eff416a70fbc511c2e523974068e96d9c3211e9b2cb03dd4f05ffc3d'};
const plistPin={bytes:473,sha256:'08c5483639227287de41e081c61e3d2e5238db72122d08f5f397d8f4e78af69b'};
export const R155_BUNDLE_HELPER='Library/HelperTools/YNXIdentityReceiver';
export const R155_BUNDLE_PLIST='Library/LaunchDaemons/com.ynxweb4.developer.testnetpreview.identity-receiver.plist';
/** Candidate bundle assembly only. Does NOT register/start SMAppService,
 * install a daemon, invoke a helper, sign it or create Root/release rows. */
export function stageOriginalR155HelperBundle({contents,projectDir}){
 absolute(contents);absolute(projectDir);
 const regular=file=>{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink())fail();return readFileSync(file)};
 // Validate both sources before making any candidate directory or file.
 const helper=pinned(regular(path.join(projectDir,'native/YNXIdentityReceiver')),helperPin);
 const plist=pinned(regular(path.resolve(projectDir,'../../apps/developer/helper/com.ynxweb4.developer.testnetpreview.identity-receiver.plist')),plistPin);
 const root=lstatSync(contents);if(!root.isDirectory()||root.isSymbolicLink())fail();
 const rows=[[R155_BUNDLE_HELPER,helper,0o755],[R155_BUNDLE_PLIST,plist,0o644]];
 for(const [name,body,mode] of rows){
  let directory=contents;for(const part of path.posix.dirname(name).split('/')){directory=path.join(directory,part);try{const s=lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink())fail()}catch(e){if(e.code!=='ENOENT')throw e;mkdirSync(directory,{mode:0o755})}}
  const target=path.join(contents,name);let exists=false;try{const s=lstatSync(target);if(!s.isFile()||s.isSymbolicLink())fail();if(!regular(target).equals(body)||(s.mode&0o777)!==mode)fail();exists=true}catch(e){if(e.code!=='ENOENT')throw e}
  if(!exists)writeFileSync(target,body,{flag:'wx',mode});
  if(!regular(target).equals(body))fail();
 }
 return {helper:{path:R155_BUNDLE_HELPER,...helperPin},plist:{path:R155_BUNDLE_PLIST,...plistPin},staged:true,notSignedByThisStep:true,serviceRegistered:false,executed:false,installed:false,nativeQualified:false};
}
export function verifyOriginalR155HelperBundle(contents){
 absolute(contents);
 for(const part of ['Library','Library/HelperTools','Library/LaunchDaemons']){const s=lstatSync(path.join(contents,part));if(!s.isDirectory()||s.isSymbolicLink())fail()}
 const rows=[[R155_BUNDLE_HELPER,helperPin,0o755],[R155_BUNDLE_PLIST,plistPin,0o644]];
 for(const [name,expected,mode] of rows){const p=path.join(contents,name),s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o777)!==mode)fail();pinned(readFileSync(p),expected)}
 return {helper:{path:R155_BUNDLE_HELPER,...helperPin},plist:{path:R155_BUNDLE_PLIST,...plistPin},bytesVerified:true,serviceRegistered:false,executed:false,installed:false,nativeQualified:false};
}

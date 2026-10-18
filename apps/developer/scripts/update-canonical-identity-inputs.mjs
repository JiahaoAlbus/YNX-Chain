// Mechanical custody update for the already-reviewed SDK314/R48 inputs.
// This inventories public source/build bytes; it never executes Native or grants rights.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const digest=b=>createHash('sha256').update(b).digest('hex');
const SDK='0ac968398a3ededeab11f78f5f41715788c74c38';
const TREE='e6c54fc67e2cc668ba01a2e6d05018bd9acb5b7b';
const BEFORE='c06d5497b9317a943b2f4a48bc1706c3b5a0640080161042f2c249f8e48e55bd';
const pins={sdkReadback:'e60b07266d66e4e3705b808fee0a36bd84fd772accbd98d1075efb568b17b456',nativeIntake:'94ef852bbdc1754def884d0334f24e5f9ca43f88118b3e6b0e053b3a31001a73',runtimeManifest:'564d1577fc8787054cc0261bfc5b9d3793fb63f6a5a31deb41651c9663e7dbba'};
async function fixed(path,hash){const b=await readFile(path);if(digest(b)!==hash)throw Error('Fixed supplier input differs: '+path);return JSON.parse(b);}
async function leaf(root,row){
 if(!/^[A-Za-z0-9_@./-]+$/.test(row.path)||row.path.startsWith('/')||row.path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe supplier leaf');
 let p=root;for(const name of row.path.split('/')){p=join(p,name);const s=await lstat(p);if(s.isSymbolicLink())throw Error('Supplier symlink');}
 const b=await readFile(p);if(b.length!==row.bytes||digest(b)!==row.sha256)throw Error('Supplier bytes differ: '+row.path);
 return {path:row.path,bytes:row.bytes,sha256:row.sha256};
}
export async function updateCanonicalIdentityInputs(options){
 for(const name of ['sdkRoot','nativeRoot','dependencyRoot'])if(typeof options[name]!=='string'||resolve(options[name])!==options[name]||(await lstat(options[name])).isSymbolicLink())throw Error('Exact regular supplier root required');
 const oldRaw=execFileSync('git',['show','08e164bb0adb7b11db193446a70e3b78e247eb02:apps/developer/scripts/canonical-identity-inputs.json'],{cwd:here});
 if(digest(oldRaw)!==BEFORE)throw Error('Reviewed predecessor differs');
 const old=JSON.parse(oldRaw),sdk=await fixed(options.sdkReadback,pins.sdkReadback),native=await fixed(options.nativeIntake,pins.nativeIntake),runtime=await fixed(options.runtimeManifest,pins.runtimeManifest);
 if(sdk.sourceCommit!==SDK||sdk.files.length!==243||sdk.allMembersMatchGit!==true||sdk.archive.sha256!=='976fe702e8cab1ee1feb1a035dfb994eff724961101c92c16c31ec38694bf938'||native.actualFiles.length!==41||native.sourceFragmentUsed!==false||native.allInheritedDependenciesRetained!==true||runtime.sdkCommit!==SDK||runtime.files.length!==316)throw Error('Fixed supplier selection differs');
 const files=await Promise.all(sdk.files.map(row=>leaf(options.sdkRoot,row)));
 const nativeSources=await Promise.all(native.actualFiles.map(row=>leaf(options.nativeRoot,{...row,path:row.relative})));
 const dependencies=await Promise.all(runtime.files.map(row=>leaf(options.dependencyRoot,row)));
 const receiptPath='apps/wallet-desktop/native/original-auth-identity-build.json';
 const receiptBytes=await readFile(join(options.nativeRoot,receiptPath));
 if(digest(receiptBytes)!=='cd45a4f65db0f6653e82a77c7d2f5d91e275903c86d8f8a0fcb8d2ae72c7ffaf')throw Error('R48 executed receipt differs');
 const receipt=JSON.parse(receiptBytes);if(receipt.inputFiles.length!==35||receipt.readbackOnly!==false||receipt.nativeQualified!==false||receipt.registrationAccepted!==false)throw Error('R48 receipt selection differs');
 await leaf(options.nativeRoot,{...receipt.output,path:receipt.output.relative});
 const before=new Map(old.nativeSources.map(x=>[x.path,x]));
 const nativeSourceUpdates=[...old.nativeSourceUpdates,...nativeSources.filter(x=>before.get(x.path)?.sha256!==x.sha256).map(x=>({handoff:'R48 SOURCE_INTAKE.json',handoffSha256:pins.nativeIntake,path:x.path,parentSha256:before.get(x.path)?.sha256??null,bytes:x.bytes,sha256:x.sha256}))];
 const record={...old,sdkCommit:SDK,sdkTree:TREE,predecessorManifestSha256:BEFORE,nativeSourceManifestSha256:native.supplier.sha256,
  supplierPins:pins,files:files.sort((a,b)=>a.path.localeCompare(b.path)),dependencies:dependencies.sort((a,b)=>a.path.localeCompare(b.path)),nativeSources:nativeSources.sort((a,b)=>a.path.localeCompare(b.path)),
  nativeBuildInputs:receipt.inputFiles.map(x=>({path:x.relative,bytes:x.bytes,sha256:x.sha256})),
  nativeComponent:{module:{path:receipt.output.relative,bytes:receipt.output.bytes,sha256:receipt.output.sha256},receipt:{path:receiptPath,bytes:receiptBytes.length,sha256:digest(receiptBytes)}},nativeSourceUpdates};
 const bytes=Buffer.from(JSON.stringify(record,null,2)+'\n');
 await writeFile(join(here,'canonical-identity-inputs.json'),bytes);
 const script=join(here,'package-identity-admission-source.mjs');let source=await readFile(script,'utf8');
 source=source.replace(/export const CANONICAL_IDENTITY_INPUTS_SHA256 = '[a-f0-9]{64}';/,"export const CANONICAL_IDENTITY_INPUTS_SHA256 = '"+digest(bytes)+"';");
 source=source.replace(/record.sdkCommit !== '[a-f0-9]{40}'/,"record.sdkCommit !== '"+SDK+"'").replace(/record.sdkTree !== '[a-f0-9]{40}'/,"record.sdkTree !== '"+TREE+"'");
 await writeFile(script,source);
 return {manifestSha256:digest(bytes),sdkFiles:files.length,dependencyFiles:dependencies.length,nativeSources:nativeSources.length,nativeBuildInputs:receipt.inputFiles.length,qualification:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [sdkRoot,nativeRoot,dependencyRoot,sdkReadback,nativeIntake,runtimeManifest]=process.argv.slice(2);
 console.log(JSON.stringify(await updateCanonicalIdentityInputs({sdkRoot,nativeRoot,dependencyRoot,sdkReadback,nativeIntake,runtimeManifest})));
}

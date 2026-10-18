// Mechanical custody update for the already-reviewed SDK316/R51 inputs.
// This inventories public source/build bytes; it never executes Native or grants rights.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const digest=b=>createHash('sha256').update(b).digest('hex');
const SDK='01d34dec80db7cf3b512e2aa9f70d7dd63575b86';
const TREE='29dae52112f59f3b5f1d5be673ee8063b1608225';
const BEFORE='7d432d27539a5bd511acc4006420281ab76544bcac44d0e5b7d3bb313a195d4d';
const pins={sdkReadback:'74afbde2c0d0e6d0f0a9309e2d399a231226c054a7bb736a4ea9e82dc5112a4e',nativeIntake:'534805f3e82c0069785b2bc059d9ef1af64fa1af578eb801fe1f913d612cd1f3',runtimeManifest:'5299c06749401ce9c867f4ff57391118c570b35f82ddf0a536fc107e06843aa9'};
async function fixed(path,hash){const b=await readFile(path);if(digest(b)!==hash)throw Error('Fixed supplier input differs: '+path);return JSON.parse(b);}
async function leaf(root,row){
 if(!/^[A-Za-z0-9_@./-]+$/.test(row.path)||row.path.startsWith('/')||row.path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe supplier leaf');
 let p=root;for(const name of row.path.split('/')){p=join(p,name);const s=await lstat(p);if(s.isSymbolicLink())throw Error('Supplier symlink');}
 const b=await readFile(p);if(b.length!==row.bytes||digest(b)!==row.sha256)throw Error('Supplier bytes differ: '+row.path);
 return {path:row.path,bytes:row.bytes,sha256:row.sha256};
}
export async function updateCanonicalIdentityInputs(options){
 for(const name of ['sdkRoot','nativeRoot','dependencyRoot'])if(typeof options[name]!=='string'||resolve(options[name])!==options[name]||(await lstat(options[name])).isSymbolicLink())throw Error('Exact regular supplier root required');
 const oldRaw=execFileSync('git',['show','e4e851befd0f2013f844b70332f9189ee8124edc:apps/developer/scripts/canonical-identity-inputs.json'],{cwd:here});
 if(digest(oldRaw)!==BEFORE)throw Error('Reviewed predecessor differs');
 const old=JSON.parse(oldRaw),sdk=await fixed(options.sdkReadback,pins.sdkReadback),native=await fixed(options.nativeIntake,pins.nativeIntake),runtime=await fixed(options.runtimeManifest,pins.runtimeManifest);
 if(sdk.sourceCommit!==SDK||sdk.files.length!==243||sdk.state!=='ALL_RECOVERED_TAR_MEMBERS_MATCH_FROZEN_GIT'||sdk.archive.sha256!=='fc93c25c5bbb92003dea336faa147314277b7b599ef17fdb07554a67ce9bc53d'||native.actualFiles.length!==41||native.sourceFragmentUsed!==false||native.allInheritedDependenciesRetained!==true||runtime.sdkCommit!==SDK||runtime.files.length!==316)throw Error('Fixed supplier selection differs');
 const files=await Promise.all(sdk.files.map(row=>leaf(options.sdkRoot,row)));
 const nativeSources=await Promise.all(native.actualFiles.map(row=>leaf(options.nativeRoot,{...row,path:row.relative})));
 const dependencies=await Promise.all(runtime.files.map(row=>leaf(options.dependencyRoot,row)));
 const receiptPath='apps/wallet-desktop/native/original-auth-identity-build.json';
 const receiptBytes=await readFile(join(options.nativeRoot,receiptPath));
 if(digest(receiptBytes)!=='10c87ef6bb922dac9dcd1c60747a998ebd6bbdd2d910218a7e7aa9eca07e1167')throw Error('R51 executed receipt differs');
 const receipt=JSON.parse(receiptBytes);if(receipt.inputFiles.length!==35||receipt.readbackOnly!==false||receipt.nativeQualified!==false||receipt.registrationAccepted!==false)throw Error('R51 receipt selection differs');
 await leaf(options.nativeRoot,{...receipt.output,path:receipt.output.relative});
 const before=new Map(old.nativeSources.map(x=>[x.path,x]));
 const nativeSourceUpdates=[...old.nativeSourceUpdates,...nativeSources.filter(x=>before.get(x.path)?.sha256!==x.sha256).map(x=>({handoff:'R51 SOURCE_INTAKE.json',handoffSha256:pins.nativeIntake,path:x.path,parentSha256:before.get(x.path)?.sha256??null,bytes:x.bytes,sha256:x.sha256}))];
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

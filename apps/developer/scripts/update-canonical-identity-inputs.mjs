// Mechanical custody update for the already-reviewed SDK312/R44 inputs.
// This inventories public source/build bytes; it never executes Native or grants rights.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const digest=b=>createHash('sha256').update(b).digest('hex');
const SDK='20499b17f3b0600ec6cf5316fd2a5d6c8e64cdf5';
const TREE='1c1e8e82576e6f73e954898106273a01fa0099e0';
const BEFORE='229c540471209feb7f60c8734f5dd25fee36202a620c424fad6aedcc018dd188';
const pins={sdkReadback:'fb8db16f7af9a7e04cb84c8760f3aa50418f43588d8864e94c3317f3b130415e',nativeIntake:'690c607b1ab960947ef8565b8e623d653501065830e945e7a8dc24aa08110f8e',runtimeManifest:'1a44ec7173e884254c9789f88acf372ef4dff1401eb7a12a4eecf6f123240915'};
async function fixed(path,hash){const b=await readFile(path);if(digest(b)!==hash)throw Error('Fixed supplier input differs: '+path);return JSON.parse(b);}
async function leaf(root,row){
 if(!/^[A-Za-z0-9_@./-]+$/.test(row.path)||row.path.startsWith('/')||row.path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe supplier leaf');
 let p=root;for(const name of row.path.split('/')){p=join(p,name);const s=await lstat(p);if(s.isSymbolicLink())throw Error('Supplier symlink');}
 const b=await readFile(p);if(b.length!==row.bytes||digest(b)!==row.sha256)throw Error('Supplier bytes differ: '+row.path);
 return {path:row.path,bytes:row.bytes,sha256:row.sha256};
}
export async function updateCanonicalIdentityInputs(options){
 for(const name of ['sdkRoot','nativeRoot','dependencyRoot'])if(typeof options[name]!=='string'||resolve(options[name])!==options[name]||(await lstat(options[name])).isSymbolicLink())throw Error('Exact regular supplier root required');
 const oldRaw=execFileSync('git',['show','aadb99587dc411e0c4a29cfa3ec6c4a8e0b4dcf7:apps/developer/scripts/canonical-identity-inputs.json'],{cwd:here});
 if(digest(oldRaw)!==BEFORE)throw Error('Reviewed predecessor differs');
 const old=JSON.parse(oldRaw),sdk=await fixed(options.sdkReadback,pins.sdkReadback),native=await fixed(options.nativeIntake,pins.nativeIntake),runtime=await fixed(options.runtimeManifest,pins.runtimeManifest);
 if(sdk.sourceCommit!==SDK||sdk.files.length!==243||sdk.sha256!=='ea3ce76882a7785183c685fd625a9a5b0809e6ad51da5a6bd94714f1eb979e6f'||native.actual38.length!==38||runtime.sdkCommit!==SDK||runtime.files.length!==316)throw Error('Fixed supplier selection differs');
 const files=await Promise.all(sdk.files.map(row=>leaf(options.sdkRoot,row)));
 const nativeSources=await Promise.all(native.actual38.map(row=>leaf(options.nativeRoot,{...row,path:row.relative})));
 const dependencies=await Promise.all(runtime.files.map(row=>leaf(options.dependencyRoot,row)));
 const receiptPath='apps/wallet-desktop/native/original-auth-identity-build.json';
 const receiptBytes=await readFile(join(options.nativeRoot,receiptPath));
 if(digest(receiptBytes)!=='1fd757d502c0eef116e9b27359be67df6a3b8230d1a1ebe41b411aefe7b0a324')throw Error('R44 executed receipt differs');
 const receipt=JSON.parse(receiptBytes);if(receipt.inputFiles.length!==32||receipt.readbackOnly!==false||receipt.nativeQualified!==false||receipt.registrationAccepted!==false)throw Error('R44 receipt selection differs');
 await leaf(options.nativeRoot,{...receipt.output,path:receipt.output.relative});
 const before=new Map(old.nativeSources.map(x=>[x.path,x]));
 const nativeSourceUpdates=[...old.nativeSourceUpdates,...nativeSources.filter(x=>before.get(x.path)?.sha256!==x.sha256).map(x=>({handoff:'R44-r2 SOURCE_INTAKE.json',handoffSha256:pins.nativeIntake,path:x.path,parentSha256:before.get(x.path)?.sha256??null,bytes:x.bytes,sha256:x.sha256}))];
 const record={...old,sdkCommit:SDK,sdkTree:TREE,predecessorManifestSha256:BEFORE,nativeSourceManifestSha256:native.selection.sha256,
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

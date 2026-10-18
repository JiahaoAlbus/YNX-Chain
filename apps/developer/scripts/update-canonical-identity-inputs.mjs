// Mechanical custody update for the already-reviewed SDK39/A33 inputs.
// This inventories public source/build bytes; it never executes Native or grants rights.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const digest=b=>createHash('sha256').update(b).digest('hex');
const SDK='cbf12aaaeae9ce3c93ceaed8f597b3c3e0c25c66';
const TREE='9f495298c028750e8c54f97b73ae615cd324f93b';
const BEFORE='99f9cdc00fd75c9900a454ca92839f6edf486177314abdc780873b7e086480d8';
const pins={sdkReadback:'539b4ecf135a7b45962a1c07e7e1fd39a23f27938a8ecbf972b4e79be9fede52',nativeIntake:'0b9f7640def9cd632830f352ccd8e707f2adaa7c0a34ce0779ec527b964bfbbf',runtimeManifest:'9f00e7b716b7f923ddad6c0e1c662cdf7558792c312632ba3b8f6a12800ca305'};
async function fixed(path,hash){const b=await readFile(path);if(digest(b)!==hash)throw Error('Fixed supplier input differs: '+path);return JSON.parse(b);}
async function leaf(root,row){
 if(!/^[A-Za-z0-9_@./-]+$/.test(row.path)||row.path.startsWith('/')||row.path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe supplier leaf');
 let p=root;for(const name of row.path.split('/')){p=join(p,name);const s=await lstat(p);if(s.isSymbolicLink())throw Error('Supplier symlink');}
 const b=await readFile(p);if(b.length!==row.bytes||digest(b)!==row.sha256)throw Error('Supplier bytes differ: '+row.path);
 return {path:row.path,bytes:row.bytes,sha256:row.sha256};
}
export async function updateCanonicalIdentityInputs(options){
 for(const name of ['sdkRoot','nativeRoot','dependencyRoot'])if(typeof options[name]!=='string'||resolve(options[name])!==options[name]||(await lstat(options[name])).isSymbolicLink())throw Error('Exact regular supplier root required');
 const oldRaw=execFileSync('git',['show','d129394b2b75b199a7eef523b22da8e2e5b27462:apps/developer/scripts/canonical-identity-inputs.json'],{cwd:here});
 if(digest(oldRaw)!==BEFORE)throw Error('Reviewed predecessor differs');
 const old=JSON.parse(oldRaw),sdk=await fixed(options.sdkReadback,pins.sdkReadback),native=await fixed(options.nativeIntake,pins.nativeIntake),runtime=await fixed(options.runtimeManifest,pins.runtimeManifest);
 if(sdk.sourceCommit!==SDK||sdk.files.length!==243||sdk.sha256!=='615373667052430fcb5ea4b837321d57bb3733efc7c7bec724a0604d55bbd26e'||native.actual38.length!==38||runtime.sdkCommit!==SDK||runtime.files.length!==316)throw Error('Fixed supplier selection differs');
 const files=await Promise.all(sdk.files.map(row=>leaf(options.sdkRoot,row)));
 const nativeSources=await Promise.all(native.actual38.map(row=>leaf(options.nativeRoot,{...row,path:row.relative})));
 const dependencies=await Promise.all(runtime.files.map(row=>leaf(options.dependencyRoot,row)));
 const receiptPath='apps/wallet-desktop/native/original-auth-identity-build.json';
 const receiptBytes=await readFile(join(options.nativeRoot,receiptPath));
 if(digest(receiptBytes)!=='445c0b0ab02a9e8321e6406dfab7669d995f4b1522bfc1e1c3e409fae2e4433c')throw Error('A33 executed receipt differs');
 const receipt=JSON.parse(receiptBytes);if(receipt.inputFiles.length!==32||receipt.readbackOnly!==false||receipt.nativeQualified!==false||receipt.registrationAccepted!==false)throw Error('A33 receipt selection differs');
 await leaf(options.nativeRoot,{...receipt.output,path:receipt.output.relative});
 const before=new Map(old.nativeSources.map(x=>[x.path,x]));
 const nativeSourceUpdates=[...old.nativeSourceUpdates,...nativeSources.filter(x=>before.get(x.path)?.sha256!==x.sha256).map(x=>({handoff:'A33 SOURCE_INTAKE.json',handoffSha256:pins.nativeIntake,path:x.path,parentSha256:before.get(x.path)?.sha256??null,bytes:x.bytes,sha256:x.sha256}))];
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

import test from'node:test';import assert from'node:assert/strict';import{readFile,mkdtemp,mkdir,copyFile,writeFile,rm}from'node:fs/promises';import{join,dirname}from'node:path';import{tmpdir}from'node:os';import{verifyCanonicalNativeSourceSelection}from'./package-identity-admission-source.mjs';
const i=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
test('selected source root must carry its own exact producer evidence, not borrow the global root',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-sdk37-evidence-root-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const row of [...i.nativeSources,i.nativeComponent.receipt,i.nativeComponent.module]){const path=join(root,row.path);await mkdir(dirname(path),{recursive:true});await copyFile(join(i.roots.native,row.path),path);}
 await assert.rejects(verifyCanonicalNativeSourceSelection(root,root),{code:'ENOENT'});
 for(const p of i.nativeComponent.producerEvidence.files){const target=join(root,p.path);await mkdir(dirname(target),{recursive:true});await copyFile(join(i.roots.native,p.path),target);}
 const selected=await verifyCanonicalNativeSourceSelection(root,root);assert.equal(selected.root,root);assert.equal(selected.nativeQualified,false);assert.equal(selected.registrationAccepted,false);
 const pin=i.nativeComponent.producerEvidence.files[0],path=join(root,pin.path),original=await readFile(path);await writeFile(path,Buffer.concat([original,Buffer.from('\n')]));
 await assert.rejects(verifyCanonicalNativeSourceSelection(root,root),/Canonical identity source leaf differs/);
 assert.deepEqual(await readFile(join(i.roots.native,pin.path)),original);
});

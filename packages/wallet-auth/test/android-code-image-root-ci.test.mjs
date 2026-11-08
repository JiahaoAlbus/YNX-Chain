import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyInputs,assertStrongNine,root,native} from '../../../scripts/ci/android-code-image-root-inputs.mjs';
const header=fs.readFileSync(path.join(native,'AndroidCodeImageRootPrivate.h'),'utf8');
const names=Array.from(header.matchAll(/\b(ynx_native_android_code_image_\w+_v1)\(/g),x=>x[1]);
test('normal host and Android C9 require strong definitions, never weak or public hooks',()=>{
 const elf=names.map(n=>'00000000 T '+n).join('\n'),mac=names.map(n=>'00000000 T _'+n).join('\n');
 assert.equal(assertStrongNine(elf,header).length,9);assert.equal(assertStrongNine(mac,header,true).length,9);
 assert.throws(()=>assertStrongNine(elf.replace(' T ',' W '),header),/STRONG_C9/);
 assert.throws(()=>assertStrongNine(elf+'\n00000000 T '+names[0],header),/STRONG_C9/);
 assert.throws(()=>assertStrongNine(elf+'\n00000000 T ynx_android_code_image_PUBLIC_close',header),/PUBLIC_HOOK/);
});
test('all original Native and canonical/SHA inputs are pinned',()=>{
 assert.equal(verifyInputs().files.length,11);
});
test('a modified dependency or aliased input cannot enter the normal CI stage',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ynx-code-image-inputs-'));
 try{
  const inputs=verifyInputs();for(const row of inputs.files){const p=path.join(temporary,row.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(root,row.path),p);}
  const target=path.join(temporary,inputs.files.at(-1).path);fs.appendFileSync(target,'\n');assert.throws(()=>verifyInputs(temporary),/INPUT_BYTES/);
  fs.unlinkSync(target);fs.symlinkSync(path.join(root,inputs.files.at(-1).path),target);assert.throws(()=>verifyInputs(temporary),/INPUT_PATH/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});

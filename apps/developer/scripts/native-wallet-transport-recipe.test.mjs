import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateCanonicalNativeBuildReceipt} from './package-identity-admission-source.mjs';

const inputs=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
// PUBLIC recipe mutations only. No changed component is compiled, loaded,
// selected or claimed by reusing this predecessor's output pin in a fixture.
const root=process.env.YNX_DEVELOPER_CANONICAL_NATIVE_ROOT;
const extra=['packages/wallet-auth/native/original-ide-wallet-identity-source.mm','packages/wallet-auth/native/original-ide-wallet-peer-launch.mm'];
async function fixture(){
  assert.ok(root,'Supply original selected Native root');
  const record=JSON.parse(await readFile(join(root,inputs.nativeComponent.receipt.path)));
  const next=structuredClone(inputs);
  for(const path of extra){
    if(!next.nativeBuildInputs.some(x=>x.path===path)){
      const row={path,bytes:1,sha256:'1'.repeat(64)};next.nativeBuildInputs.push(row);
      record.inputFiles.push({relative:path,bytes:row.bytes,sha256:row.sha256});
    }
  }
  for(const command of record.commands.filter(x=>x.tool==='/usr/bin/clang++')){
    if(!command.argv.includes('AppKit'))command.argv.push('-framework','AppKit');
    for(const path of extra)if(!command.argv.includes(join(record.sourceRoot,path)))command.argv.push(join(record.sourceRoot,path));
  }
  return {record,next};
}
test('already-selected matching receipt remains valid with its complete actual recipe',async()=>{
  assert.ok(root,'Supply original selected Native root');
  const record=JSON.parse(await readFile(join(root,inputs.nativeComponent.receipt.path)));
  assert.equal(validateCanonicalNativeBuildReceipt(record,inputs),record);
});
test('R114 selected sources cannot be recorded without compiling both transport units',async()=>{
  const {record,next}=await fixture();
  assert.equal(validateCanonicalNativeBuildReceipt(record,next),record);
  for(const path of extra){
    const changed=structuredClone(record);for(const command of changed.commands)command.argv=command.argv.filter(x=>x!==join(changed.sourceRoot,path));
    assert.throws(()=>validateCanonicalNativeBuildReceipt(changed,next),/compile command differs/);
  }
});
test('R114 OS bundle resolution requires AppKit in the actual compiler recipe',async()=>{
  const {record,next}=await fixture();for(const command of record.commands)command.argv=command.argv.filter(x=>x!=='AppKit');
  assert.throws(()=>validateCanonicalNativeBuildReceipt(record,next),/compile command differs/);
});
test('one selected transport unit cannot silently fall back to the old six-unit recipe',async()=>{
  const {record,next}=await fixture();next.nativeBuildInputs=next.nativeBuildInputs.filter(x=>x.path!==extra[1]);record.inputFiles=record.inputFiles.filter(x=>x.relative!==extra[1]);
  assert.throws(()=>validateCanonicalNativeBuildReceipt(record,next),/transport source closure differs/);
});

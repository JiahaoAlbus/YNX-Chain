import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateCanonicalNativeBuildReceipt} from './package-identity-admission-source.mjs';
import {nativeRecipeTestProfile} from './native-recipe-test-profile.mjs';

export function registerNativeWalletTransportRecipeTests({inputs,root}){
// PUBLIC recipe mutations only. No changed component is compiled, loaded,
// selected or claimed by reusing this predecessor's output pin in a fixture.
const profile=nativeRecipeTestProfile(inputs),isExecutedRecord=profile.executed;
// Test-only re-pin reaches recipe semantics after the immutable producer-record gate.
// Never changes production selection, on-disk producer bytes, or actual compile evidence.
function recipeControl(record,selection){const next=structuredClone(selection);if(isExecutedRecord)next.nativeComponent.executedRecordCanonicalSha256=createHash('sha256').update(JSON.stringify(record)).digest('hex');return next;}
const recipeError=new Error(profile.recipeError);
function assertRecipeFailure(record,selection,expected=recipeError){
  // The immutable producer hash must reject first without test-only re-pinning.
  // Then the independent recipe guard must still reject the exact mutation.
  if(profile.immutableHashFirst)assert.throws(()=>validateCanonicalNativeBuildReceipt(record,selection),new Error(profile.producerError));
  assert.throws(()=>validateCanonicalNativeBuildReceipt(record,recipeControl(record,selection)),expected);
}
const extra=['packages/wallet-auth/native/original-ide-wallet-identity-source.mm','packages/wallet-auth/native/original-ide-wallet-peer-launch.mm'];
async function fixture(){
  assert.ok(root,'Supply original selected Native root');
  const supplied=JSON.parse(await readFile(join(root,inputs.nativeComponent.receipt.path)));
  const record=validateCanonicalNativeBuildReceipt(supplied,inputs);
  const next=structuredClone(inputs);
  if(isExecutedRecord)return {record,next}; // Actual selected eighteen-TU producer; never apply SDK14 augmentation.
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
  const supplied=JSON.parse(await readFile(join(root,inputs.nativeComponent.receipt.path)));
  const record=validateCanonicalNativeBuildReceipt(supplied,inputs);
  assert.equal(validateCanonicalNativeBuildReceipt(record,inputs),record);
});
test('selected sources cannot be recorded without compiling both transport units',async()=>{
  const {record,next}=await fixture();
  assert.equal(validateCanonicalNativeBuildReceipt(record,next),record);
  for(const path of extra){
    const changed=structuredClone(record);for(const command of changed.commands)command.argv=command.argv.filter(x=>x!==join(changed.sourceRoot,path));
    assertRecipeFailure(changed,next);
  }
});
test('selected OS bundle resolution requires AppKit in the actual compiler recipe',async()=>{
  const {record,next}=await fixture();for(const command of record.commands)command.argv=command.argv.filter(x=>x!=='AppKit');
  assertRecipeFailure(record,next);
});
test('one selected transport unit cannot silently fall back to the old six-unit recipe',async()=>{
  const {record,next}=await fixture();next.nativeBuildInputs=next.nativeBuildInputs.filter(x=>x.path!==extra[1]);record.inputFiles=record.inputFiles.filter(x=>x.relative!==extra[1]);
  if(profile.paired){assert.throws(()=>validateCanonicalNativeBuildReceipt(record,next),new Error(profile.closureError));assert.throws(()=>validateCanonicalNativeBuildReceipt(record,recipeControl(record,next)),new Error(profile.closureError));}
  else assertRecipeFailure(record,next,new Error(profile.closureError));
});
test('selected helper, publication and relay units retain their full link recipe across legacy and selected normal SDK profiles',async()=>{
  const {record,next}=await fixture();
  for(const path of ['original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-ide-publication-artifact.mm','original-ide-contract-relay-owner.mm']){
    const changed=structuredClone(record);
    for(const command of changed.commands)command.argv=command.argv.filter(x=>x!==join(changed.sourceRoot,'packages/wallet-auth/native/'+path));
    assert.throws(()=>validateCanonicalNativeBuildReceipt(changed,recipeControl(changed,next)),recipeError);
  }
  const changed=structuredClone(record);for(const command of changed.commands)command.argv=command.argv.filter(x=>x!=='ServiceManagement');
  assert.throws(()=>validateCanonicalNativeBuildReceipt(changed,recipeControl(changed,next)),recipeError);
});
}

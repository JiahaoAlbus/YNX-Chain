import test from 'node:test';import assert from 'node:assert/strict';
import {nativeRecipeTestProfile} from './native-recipe-test-profile.mjs';
import {canonicalNormalProfileTestPath} from './canonical-normal-profile.mjs';
const entries=[
 [39,'74a44b86f27456685f4a153dfdd8f4e51aaa0cc8'],
 [46,'59a3797ea3421129171565e37870568e424ec085'],
 [47,'5763b31b0e8d595bf2ed2cae2d4adf7fc5cdcadf'],
 [48,'632af166d0b374c618bb226f63aefdcba223247c']
];
for(const [n,sdkCommit]of entries)test('normal preflight chooses exact SDK'+n+' profile and preserves immutable recipe checks',()=>{
 const input={sdkVersion:'1.3.0-pq.3.32-auth.'+n,sdkCommit},r=nativeRecipeTestProfile(input);
 assert.equal(canonicalNormalProfileTestPath(input),'scripts/sdk'+n+'-normal-profile.test.mjs');
 assert.equal(r.executed,true);assert.equal(r.immutableHashFirst,true);assert.equal(r.recipeError,'SDK'+n+' component Node command differs.');
 assert.equal(r.producerError,'SDK'+n+' component producer record differs.');
 if(n>=46){assert.equal(r.paired,true);assert.equal(r.closureError,'SDK'+n+' component SDK'+n+' paired source count differs.');}
 assert.throws(()=>canonicalNormalProfileTestPath({...input,sdkCommit:'0'.repeat(40)}),/No normal package profile/);
});
test('legacy recipe controls remain separate and cannot select a normal source profile',()=>{
 assert.equal(nativeRecipeTestProfile({sdkVersion:'PUBLIC-old-generic'}).executed,false);
 assert.throws(()=>canonicalNormalProfileTestPath({sdkVersion:'PUBLIC-old-generic',sdkCommit:'0'.repeat(40)}));
});

for(const n of [46,47,48])test('SDK'+n+' paired-source mutation still reaches the exact production component guard',async()=>{
 const {readFile}=await import('node:fs/promises');
 const path=n===48?'./canonical-identity-inputs.json':'./fixtures/sdk'+n+'-canonical-source.json';
 const input=JSON.parse(await readFile(new URL(path,import.meta.url)));
 input.nativeBuildQualification={state:'ACTUAL_EXECUTED_SDK'+n+'_RECORD',strictToolchainIdentityQualified:false,compileReuseAdmitted:false};
 input.requiredBuild.helperInputs=[];
 const validator=await import('./sdk'+n+'-native-component.mjs');
 assert.throws(()=>validator['validateSDK'+n+'NativeComponent']({},input),new Error(nativeRecipeTestProfile(input).closureError));
});

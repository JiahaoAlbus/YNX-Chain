import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{sdk36ProductLayout}from'./sdk36-product-layout.mjs';
const inputs=JSON.parse(await readFile(new URL('./canonical-identity-inputs.json',import.meta.url)));
test('official product rows differ from original full build without changing producer evidence',()=>{const before=JSON.stringify(inputs),p=sdk36ProductLayout(inputs);assert.equal(p.files.length+p.dependencies.length,9568);assert.equal(p.runtimeClosure.Auth.files,556);assert.equal(p.runtimeClosure.contractRelay.files,9417);assert.equal(inputs.runtimeClosure.contractRelay.files,9426);assert.equal(JSON.stringify(inputs),before);assert.equal([...p.files,...p.dependencies].filter(r=>/\.d\.[cm]?ts$/.test(r.path)).length>=2143,true);});
for(const[name,change]of[
 ['missing installed lock',i=>i.dependencies=i.dependencies.filter(p=>p.path!=='.package-lock.json')],
 ['changed leaf',i=>i.productProjection.files[0].sha256='0'.repeat(64)],
 ['product authority',i=>i.productProjection.NativeAdmission=true],
 ['missing generated manifest',i=>i.productProjection.generated=[]],
 ['test reintroduced',i=>i.productProjection.files[0]=i.buildOnlySDKFiles[0]]
])test('refuses '+name,()=>{const i=structuredClone(inputs);change(i);assert.throws(()=>sdk36ProductLayout(i),/SDK36/);});

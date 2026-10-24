import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as product from '../scripts/sdk36-product-runtime.mjs';
test('SDK36 product consumer rejects noncanonical manifest serialization before packaging; it never repairs supplied bytes',()=>{
 assert.equal(typeof product.assertSDK36CanonicalRuntimeManifest,'function');
 const canonical=Buffer.from(JSON.stringify({files:[],version:'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'}));
 assert.deepEqual(product.assertSDK36CanonicalRuntimeManifest(canonical),JSON.parse(canonical));
 for(const raw of [Buffer.concat([canonical,Buffer.from('\n')]),Buffer.from(' '+canonical),Buffer.from(JSON.stringify(JSON.parse(canonical),null,2)),Buffer.from('{"files":[],"files":[],"version":"YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1"}')]){
  const snapshot=Buffer.from(raw);assert.throws(()=>product.assertSDK36CanonicalRuntimeManifest(raw),{code:'SDK36_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS'});assert.deepEqual(raw,snapshot);
 }
});
test('actual frozen SDK36 r1 full and product manifest bytes all fail original canonical serialization contract',{skip:!process.env.WALLET_AUTH36_R1_SUPPLY},()=>{
 const supply=process.env.WALLET_AUTH36_R1_SUPPLY,h=JSON.parse(fs.readFileSync(path.join(supply,'SDK36_NORMAL_PREFIX_AND_PRODUCT_RUNTIME_HANDOFF.json')));
 for(const ref of[h.runtime.Auth.manifest,h.runtime.union.manifest,h.runtime.product.Auth,h.runtime.product.union]){
  const raw=fs.readFileSync(ref.path),snapshot=Buffer.from(raw);assert.equal(raw.at(-1),10);assert.throws(()=>product.assertSDK36CanonicalRuntimeManifest(raw),{code:'SDK36_PRODUCT_MANIFEST_SERIALIZATION_DIFFERS'});assert.deepEqual(raw,snapshot);
 }
});
test('actual formal SDK36 r2 four manifests satisfy unchanged canonical contract without mutating any supplied bytes',{skip:!process.env.WALLET_AUTH36_NORMAL_SUPPLY},()=>{
 const h=JSON.parse(fs.readFileSync(path.join(process.env.WALLET_AUTH36_NORMAL_SUPPLY,'SDK36_R2_CANONICAL_NORMAL_PREFIX_RUNTIME_HANDOFF.json')));
 for(const ref of[h.runtime.Auth.manifest,h.runtime.union.manifest,h.runtime.product.Auth,h.runtime.product.union]){const raw=fs.readFileSync(ref.path),snapshot=Buffer.from(raw);assert.equal(raw.at(-1),125);assert.deepEqual(product.assertSDK36CanonicalRuntimeManifest(raw),JSON.parse(raw));assert.deepEqual(raw,snapshot);}
});

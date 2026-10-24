import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {finalizeSDK37FiniteReceiptDATA as finalize,validateSDK37FiniteReceiptDATA as validate} from './auth37-projection-receipt.mjs';
const version='1.3.0-pq.3.32-auth.37',commit='7bb0e17d2bd1aa6d4bde96f45c14774fcc4ccff9';
const excluded=JSON.parse(fs.readFileSync(new URL('./fixtures/sdk35-product-runtime-policy.json',import.meta.url))).excluded;
// PUBLIC metadata rows only. No production bytes, provenance or grant fixture.
function fixture(){
 const files=[...structuredClone(excluded),...Array.from({length:9566},(_,i)=>({path:'PUBLIC/'+String(i).padStart(5,'0'),bytes:1,sha256:'a'.repeat(64)}))].sort((a,b)=>a.path<b.path?-1:1);
 const reference={path:'/PUBLIC/NOT_AUTHORITY',bytes:1,sha256:'a'.repeat(64)};
 const receipt={kind:'YNX_SDK37_PRODUCT_RUNTIME_METADATA_PROJECTION/v1',versionSDK:version,sourceCommit:commit,parentSupply:reference,completePrefixInventory:reference,Auth:reference,union:reference,selection:reference,staticSourceAnalysis:reference,fullPrefixFiles:9581,productFiles:9566,fullAuthFiles:566,productAuthFiles:556,fullUnionFiles:9426,productUnionFiles:9417,excludedFiles:15,installedLockRetained:true,NativeInputChanged:1,existingJSSourceGraphUnchanged:true,generatedRawCanonicalNoLF:true,SourceQualified:false,Root:false,NativeModuleBuilt:false,installed:false,published:false};
 return {receipt,inventory:{kind:'YNX_SDK37_COMPLETE_NORMAL_PREFIX_FILE_INVENTORY/v1',versionSDK:version,sourceCommit:commit,files},selection:{kind:'YNX_SDK37_PRODUCT_PACK_SELECTION/v1',versionSDK:version,files:structuredClone(files.filter(r=>r.path.startsWith('PUBLIC/')))},policy:{kind:'YNX_SDK37_FINITE_PRODUCT_EXCLUSION_POLICY/v1',versionSDK:version,oldSDK36IdentityOrAdmissionInherited:false,excluded:structuredClone(excluded)},policyRef:{path:'/PUBLIC/policy-data-only.json',bytes:3013,sha256:'55a2dece3fa0aa55290e0347deb2a7775ff4b28509fdb6130e892b72117ef8c6'}};
}
test('Auth37 count-only receipt reproduces the missing exact finite15 contract',()=>{
 assert.throws(()=>validate(fixture().receipt),{code:'AUTH37_RECEIPT_EXACT_EXCLUSIONS_REQUIRED'});
});
test('Auth37 producer emits complete independently pinned exclusion DATA without mutating parents or granting authority',()=>{
 const f=fixture(),before=JSON.stringify(f),result=finalize(f);assert.equal(validate(result),true);assert.deepEqual(result.excluded,excluded);assert.equal(JSON.stringify(f),before);
 for(const name of ['SourceQualified','Root','NativeModuleBuilt','installed','published','oldSDK36IdentityOrAdmissionInherited'])assert.equal(result[name],false);
});
test('Auth37 same-count altered policy or substituted product members refuse',()=>{
 const f=fixture();f.policy.excluded[0].sha256='b'.repeat(64);assert.throws(()=>finalize(f));
 const g=fixture();g.selection.files[0].sha256='b'.repeat(64);assert.throws(()=>finalize(g),{code:'AUTH37_RECEIPT_PRODUCT_MEMBER'});
 const h=fixture();h.inventory.files.find(r=>r.path===excluded[0].path).sha256='b'.repeat(64);assert.throws(()=>finalize(h),{code:'AUTH37_RECEIPT_EXCLUSION_MEMBER'});
});
test('Auth37 version rollback, authority promotion, unknown receipt fields and repinned policy refuse',()=>{
 for(const change of [f=>{f.policy.versionSDK='1.3.0-pq.3.32-auth.36';},f=>{f.receipt.SourceQualified=true;},f=>{f.receipt.SourceAdmission=true;},f=>{f.policyRef.sha256='b'.repeat(64);},f=>{f.selection.versionSDK='1.3.0-pq.3.32-auth.36';}]){const f=fixture();change(f);assert.throws(()=>finalize(f));}
});
test('Auth37 exact receipt revision refuses changed or coerced revision DATA',()=>{
 const original=finalize(fixture());assert.equal(validate(original),true);
 for(const revision of [1,3,'2',null,false])assert.throws(()=>validate({...original,projectionMetadataRevision:revision}),{code:'AUTH37_RECEIPT_REVISION'});
});

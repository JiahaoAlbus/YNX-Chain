import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalInputs,verifyCanonicalNativeSourceSelection} from './package-identity-admission-source.mjs';
const rows={
 '1.3.0-pq.3.32-auth.39':{sources:124,inputs:112},
 '1.3.0-pq.3.32-auth.46':{sources:125,inputs:113},
 '1.3.0-pq.3.32-auth.47':{sources:127,inputs:115},
 '1.3.0-pq.3.32-auth.48':{sources:127,inputs:115}
};
test('actual selected source preflight verifies its matching record/module and evidence without loading Native',async()=>{
 const i=await canonicalInputs(),expected=rows[i.sdkVersion];assert.ok(expected,'Exact selected SDK source profile required.');
 const r=await verifyCanonicalNativeSourceSelection(process.env.YNX_DEVELOPER_CANONICAL_NATIVE_ROOT||i.roots.native,process.env.YNX_DEVELOPER_CANONICAL_NATIVE_ROOT||i.roots.native);
 assert.equal(r.sourceLeaves,expected.sources);assert.equal(r.buildInputLeaves,expected.inputs);assert.equal(r.nativeQualified,false);assert.equal(r.registrationAccepted,false);
});

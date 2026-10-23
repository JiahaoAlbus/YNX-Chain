import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePublisherCustodyRecordData,decodePublisherCustodyRecordData} from '../src/artifact-publication/publisher-custody-record.mjs';
// PUBLIC structural bytes, deliberately NOT real keys, R13 or a grant. Actual
// SDK import/derivation and Source approval are separate integration gates.
const r=Buffer.from('PUBLIC original registered R stand-in');
const material=()=>({format:'YNX-BATCH/KEY-MATERIAL/v1',algorithmVersion:'YNX-BATCH/v0.1',suite:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',pkcs8A:Buffer.alloc(54,1),pkcs8B:Buffer.alloc(150,2),pkA:Buffer.alloc(2592,3),pkB:Buffer.alloc(64,4)});
test('record keeps full original R and exact seven-field material together without changing caller copies',()=>{
 const m=material(),plain=encodePublisherCustodyRecordData(r,m),restored=decodePublisherCustodyRecordData(plain,r);
 assert.deepEqual(restored.publicOriginal,r);assert.deepEqual(restored.keyMaterial,m);assert.equal(m.pkcs8A[0],1);assert.equal(m.pkcs8B[0],2);
 plain.fill(0);assert.equal(restored.keyMaterial.pkcs8A[0],1);restored.keyMaterial.pkcs8A.fill(0);restored.keyMaterial.pkcs8B.fill(0);
});
test('same material cannot restore under changed original R, including changed version/project bytes',()=>{
 const plain=encodePublisherCustodyRecordData(r,material());
 for(const expected of [Buffer.from('PUBLIC foreign R'),Buffer.concat([r,Buffer.from('new version')])])assert.throws(()=>decodePublisherCustodyRecordData(plain,expected),{code:'PUBLISHER_CUSTODY_RECORD_INVALID'});
 plain.fill(0);
});
test('truncation, appended material, invalid prefix and corrupted length reject',()=>{
 const plain=encodePublisherCustodyRecordData(r,material()),corrupt=Buffer.from(plain);corrupt.writeUInt32BE(0xffffffff,Buffer.byteLength('YNX-PUBLISHER-CUSTODY/v1\n'));
 for(const bad of [plain.subarray(0,plain.length-1),Buffer.concat([plain,Buffer.from([1])]),Buffer.alloc(plain.length),corrupt])assert.throws(()=>decodePublisherCustodyRecordData(bad,r));
 plain.fill(0);corrupt.fill(0);
});
test('non-original material ABI, missing branch or private-key length is not accepted',()=>{
 for(const patch of [{format:'other'},{suite:'single-signature'},{pkcs8A:Buffer.alloc(53)},{pkB:Buffer.alloc(0)},{extra:true}])assert.throws(()=>encodePublisherCustodyRecordData(r,{...material(),...patch}));
});
test('accessors, proxies, shared buffers and oversized R fail without executing getters',()=>{
 let calls=0;const m=material();Object.defineProperty(m,'pkcs8A',{enumerable:true,get(){calls++;throw Error('must not execute');}});
 assert.throws(()=>encodePublisherCustodyRecordData(r,m));assert.throws(()=>encodePublisherCustodyRecordData(r,new Proxy(material(),{})));
 assert.throws(()=>encodePublisherCustodyRecordData(new Uint8Array(new SharedArrayBuffer(3)),material()));assert.throws(()=>encodePublisherCustodyRecordData(Buffer.alloc(8193),material()));assert.equal(calls,0);
});

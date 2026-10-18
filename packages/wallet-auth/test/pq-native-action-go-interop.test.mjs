// Exact original Go CI output: run 39160053537 at source
// 9dc7bcc84ee1cff1a4d6197fe3f1cd1e4aa5c54a. DATA-only codec interop;
// no signature, membership, current policy, execution or permission is asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizePQNativeAction,encodePQNativeAction,decodePQNativeAction,encodePQNativeActionPayload,decodePQNativeActionPayload} from '../src/pq-native-action.js';
const raw=readFileSync(new URL('../testdata/pq-native-action-go-interop-9dc.json',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(raw.length,31342);
assert.equal(sha(raw),'1aa661eab331054cf249e2a8ca5c121cada9e879f80194efc10e1d44bc3375d2');
const original=JSON.parse(raw);
function boundedU32(text,max){
 assert.equal(typeof text,'string');assert.match(text,/^(0|[1-9][0-9]*)$/);
 const integer=BigInt(text);assert(integer<=BigInt(max));return Number(integer);
}
function inputFromGo(row){
 const payload=structuredClone(row.payload);
 if(row.kind==='dex_asset_create')payload.decimals=boundedU32(payload.decimals,18);
 if(row.kind==='dex_pool_create')payload.feeBps=boundedU32(payload.feeBps,1000);
 // All remaining Go U64 values, including constructorArgs, remain untouched
 // decimal strings. Only the two explicit bounded U32 codec fields use Number.
 const {chainId,nativeChainId,owner,nonce,fee,kind}=row;
 for(const value of [nativeChainId,nonce,fee])assert.equal(typeof value,'string');
 return {chainId,nativeChainId,owner,nonce,fee,kind,payload};
}
test('pinned Go artifact is exactly 18 rows / 16 kinds and explicitly DATA only',()=>{
 assert.deepEqual(Object.keys(original).sort(),['version','classification','codecOnly','signingPerformed','executionPerformed','authorizationGranted','feeSemantics','rowCount','kindCount','rows'].sort());
 assert.equal(original.version,'YNX-NATIVE-ACTION-PUBLIC-INTEROP/v1');assert.equal(original.classification,'data');
 assert.equal(original.codecOnly,true);assert.equal(original.signingPerformed,false);assert.equal(original.executionPerformed,false);assert.equal(original.authorizationGranted,false);
 assert.equal(original.rowCount,'18');assert.equal(original.rows.length,18);assert.equal(original.kindCount,'16');assert.equal(new Set(original.rows.map(row=>row.kind)).size,16);
 for(const invalid of ['01','1e1','-1','18.0','4294967296',9007199254740993])assert.throws(()=>boundedU32(invalid,18));
});
for(const [index,row]of original.rows.entries())test(`original Go runtime row ${index+1}: ${row.kind} ${row.payload.name??''}`,()=>{
 assert.deepEqual(Object.keys(row).sort(),['kind','payload','chainId','nativeChainId','owner','nonce','fee','payloadHex','signingBytesHex','sha256'].sort());
 const input=inputFromGo(row),normalized=normalizePQNativeAction(input),payload=Buffer.from(encodePQNativeActionPayload(input.kind,input.payload)),wire=Buffer.from(encodePQNativeAction(input));
 assert.equal(payload.toString('hex'),row.payloadHex);assert.equal(wire.toString('hex'),row.signingBytesHex);assert.equal(sha(wire),row.sha256);
 const goWire=Buffer.from(row.signingBytesHex,'hex'),goPayload=Buffer.from(row.payloadHex,'hex');
 assert.deepEqual(decodePQNativeAction(goWire),normalized);assert.deepEqual(decodePQNativeActionPayload(row.kind,goPayload),normalized.payload);
 assert.equal(Buffer.from(encodePQNativeAction(decodePQNativeAction(goWire))).toString('hex'),row.signingBytesHex);
 assert.equal(normalized.nonce,'18446744073709551615');assert.equal(normalized.nativeChainId,'9007199254740993');
 if(row.kind==='contract_deploy')assert.deepEqual(normalized.payload.constructorArgs,['18446744073709551615']);
 assert.equal(Object.hasOwn(normalized,'authorized'),false);assert.equal(Object.hasOwn(normalized,'signatureVerified'),false);
});

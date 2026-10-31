import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import{encodeFields,decodeFields,OPEN_CONTROL_MAX_BYTES as MAX}from'../src/framing.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/existing-context-vector.json',import.meta.url)));
const fromHex=s=>Uint8Array.from(Buffer.from(s,'hex')),hex=b=>Buffer.from(b).toString('hex');
test('T-OPEN-02 existing committed Go/JS context vector matches E bytes without inventing an OPEN profile',()=>{
 const fields=fixture.fieldsHex.map(fromHex),wire=encodeFields(fields);assert.equal(hex(wire),fixture.wireHex);assert.deepEqual(decodeFields(wire,8).map(hex),fixture.fieldsHex);assert.equal(hex(encodeFields([])),'00000000');assert.deepEqual(decodeFields(encodeFields([]),0),[]);
});
test('T-OPEN-02 framing rejects count, truncation, trailing bytes and oversized length before field copies',()=>{
 const good=fromHex(fixture.wireHex),cases=[new Uint8Array(),good.slice(0,-1),Uint8Array.of(...good,0)];
 for(const offset of [0,4]){const b=good.slice();new DataView(b.buffer).setUint32(offset,0xffffffff);cases.push(b)}
 for(const b of cases)assert.throws(()=>decodeFields(b,8));assert.throws(()=>decodeFields(good,7));assert.throws(()=>decodeFields(good,1025));assert.throws(()=>decodeFields(new Uint8Array(MAX+1),8));
});
test('T-OPEN-02 exact 1MiB and 1024 field boundaries, detached results and repeated positional values',()=>{
 const body=new Uint8Array(MAX-8);body[0]=7;assert.equal(encodeFields([body]).length,MAX);assert.throws(()=>encodeFields([new Uint8Array(MAX-7)]));
 assert.equal(decodeFields(encodeFields(Array.from({length:1024},()=>new Uint8Array())),1024).length,1024);assert.throws(()=>encodeFields(Array.from({length:1025},()=>new Uint8Array())));
 const a=Uint8Array.of(1,2),wire=encodeFields([a,a]);a.fill(9);const fields=decodeFields(wire,2);assert.equal(hex(fields[0]),'0102');wire.fill(0);fields[0][0]=5;assert.equal(hex(fields[1]),'0102');
});
test('T-OPEN-02 control inputs reject getters, sparse arrays, shared buffers and nonbytes',()=>{
 let calls=0;const fields=[];Object.defineProperty(fields,0,{get(){calls++;return Uint8Array.of(1)},enumerable:true});assert.throws(()=>encodeFields(fields));assert.equal(calls,0);assert.throws(()=>encodeFields(new Array(1)));assert.throws(()=>encodeFields(['not bytes']));assert.throws(()=>encodeFields([new Uint8Array(new SharedArrayBuffer(1))]));assert.throws(()=>decodeFields(new DataView(new ArrayBuffer(4)),0));
});
test('T-OPEN-02 byte capture bypasses custom iterators and own buffer getters and rejects disguised shared buffers',()=>{
 let iter=0,getter=0;const value=Uint8Array.of(1,2);value[Symbol.iterator]=function*(){iter++;yield 9;};Object.defineProperty(value,'buffer',{get(){getter++;throw Error('own buffer getter must not run')}});
 const wire=encodeFields([value]);assert.equal(hex(wire),'00000001000000020102');assert.equal(iter,0);assert.equal(getter,0);
 wire[Symbol.iterator]=function*(){iter++;yield 9;};Object.defineProperty(wire,'buffer',{get(){getter++;throw Error('own buffer getter must not run')}});assert.equal(hex(decodeFields(wire,1)[0]),'0102');assert.equal(iter,0);assert.equal(getter,0);
 const shared=new Uint8Array(new SharedArrayBuffer(2));Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(2)});assert.throws(()=>encodeFields([shared]),e=>e.code==='INVALID');
 const detached=Uint8Array.of(1);structuredClone(detached.buffer,{transfer:[detached.buffer]});assert.throws(()=>encodeFields([detached]),e=>e.code==='INVALID');
});

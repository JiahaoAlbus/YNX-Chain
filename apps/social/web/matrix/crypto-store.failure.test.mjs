import assert from 'node:assert/strict';
import test from 'node:test';
import {matrixCryptoStore} from './crypto-store.mjs';
const account=`ynx1${'a'.repeat(38)}`;
function fixture({encryptFailure=false,uuidFailure=false,decryptedLength=32}={}){
  const state={record:undefined,closed:false,secret:null,decrypted:null};
  const key={extractable:false,algorithm:{name:'AES-GCM'}};
  const db={close(){state.closed=true},transaction(){
    const tx={abort(){queueMicrotask(()=>tx.onabort?.())},objectStore(){return {
      get(){const request={};queueMicrotask(()=>{request.result=state.record;request.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.())});return request},
      add(record){state.record=record}
    }}};return tx;
  }};
  const environment={isSecureContext:true,location:{origin:'https://fixture.invalid'},indexedDB:{open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.()});return request}},crypto:{
    getRandomValues(bytes){bytes.fill(17);if(bytes.length===32)state.secret=bytes;return bytes},
    randomUUID(){if(uuidFailure)throw Error('fixture UUID failure');return 'fixture-id'},
    subtle:{async generateKey(){return key},async encrypt(){if(encryptFailure)throw Error('fixture encryption failure');return new ArrayBuffer(48)},async decrypt(){state.decrypted=new Uint8Array(decryptedLength).fill(23);return state.decrypted.buffer}}
  }};
  return {state,environment};
}
test('wrapping failure wipes generated plaintext key and closes original database',async()=>{
  const {state,environment}=fixture({encryptFailure:true});
  await assert.rejects(matrixCryptoStore(account,{environment}),/original keys were retained/);
  assert.ok(state.secret.every(byte=>byte===0));assert.equal(state.record,undefined);assert.equal(state.closed,true);
});
test('metadata failure after key generation also wipes plaintext without inserting replacement',async()=>{
  const {state,environment}=fixture({uuidFailure:true});
  await assert.rejects(matrixCryptoStore(account,{environment}),/original keys were retained/);
  assert.ok(state.secret.every(byte=>byte===0));assert.equal(state.record,undefined);assert.equal(state.closed,true);
});
test('invalid decrypted key is wiped while original encrypted record is preserved',async()=>{
  const {state,environment}=fixture({decryptedLength:31});
  const original={version:1,key:{extractable:false,algorithm:{name:'AES-GCM'}},origin:environment.location.origin,deviceId:'original-device',iv:new Uint8Array(12),encrypted:new ArrayBuffer(48)};state.record=original;
  await assert.rejects(matrixCryptoStore(account,{environment}),/original keys were retained/);
  assert.ok(state.decrypted.every(byte=>byte===0));assert.equal(state.record,original);assert.equal(state.closed,true);
});
test('valid recovered key stays usable while temporary generated plaintext is wiped',async()=>{
  const {state,environment}=fixture();const result=await matrixCryptoStore(account,{environment});
  assert.equal(result.deviceId,'YNX-fixture-id');assert.equal(result.storageKey.length,32);assert.ok(result.storageKey.every(byte=>byte===23));assert.ok(state.secret.every(byte=>byte===0));assert.equal(state.closed,true);
});

async function realFixture(){
  const {webcrypto}=await import('node:crypto');const built=fixture();
  built.environment.crypto={subtle:webcrypto.subtle,randomUUID:()=>webcrypto.randomUUID(),getRandomValues(bytes){webcrypto.getRandomValues(bytes);if(bytes.length===32)built.state.secret=bytes;return bytes}};
  return built;
}
test('real WebCrypto preserves the original device and wrapped key across recovery',async()=>{
  const {state,environment}=await realFixture();const first=await matrixCryptoStore(account,{environment}),original=state.record;
  assert.ok(state.secret.every(byte=>byte===0));assert.equal(original.key.extractable,false);
  const restored=await matrixCryptoStore(account,{environment});assert.equal(restored.deviceId,first.deviceId);assert.deepEqual(restored.storageKey,first.storageKey);assert.equal(state.record,original);
  first.storageKey.fill(0);restored.storageKey.fill(0);
});
test('real WebCrypto rejects corrupted ciphertext without replacing the original record',async()=>{
  const {state,environment}=await realFixture();const first=await matrixCryptoStore(account,{environment});first.storageKey.fill(0);
  const original=state.record;new Uint8Array(original.encrypted)[0]^=1;
  await assert.rejects(matrixCryptoStore(account,{environment}),/original keys were retained/);assert.equal(state.record,original);assert.equal(state.closed,true);
});

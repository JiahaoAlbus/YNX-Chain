import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixSocialTransport} from './transport.mjs';
function fixture(type,wire){
 const state={decrypts:0,contentReads:0};const event={isEncrypted:()=>true,getWireType:()=>type,getWireContent:()=>wire,isDecryptionFailure:()=>false,getType:()=> 'm.room.message',getId:()=>'$original',getSender:()=> '@peer:test.invalid',getContent:()=>{state.contentReads++;return {body:'original historical text'}},status:null};
 const transport=new MatrixSocialTransport();transport.binding={userId:'@self:test.invalid'};transport.client={getRoom:()=>({getLiveTimeline:()=>({getEvents:()=>[event]})}),decryptEventIfNeeded:async()=>{state.decrypts++},getCrypto:()=>({getEncryptionInfoForEvent:async()=>({shieldColour:0})})};return {transport,state,event};
}
for(const [name,type,wire] of [
 ['new Veil v2','com.ynx.social.veil.encrypted.v2',{version:2,suite:'signal-session-0.104.0'}],
 ['unknown future Veil','com.ynx.social.veil.encrypted.v3',{version:3}],
 ['unknown legacy algorithm','m.room.encrypted',{algorithm:'unknown'}],
 ['custom XChaCha is not a Matrix SDK reader','m.room.encrypted',{algorithm:'x25519-hkdf-sha256-xchacha20poly1305'}]
])test(`${name} never enters the old SDK decrypt path or exposes plaintext`,async()=>{
 const {transport,state}=fixture(type,wire);const before=JSON.stringify(wire);const result=await transport.messages('!room:test.invalid');
 assert.equal(state.decrypts,0);assert.equal(state.contentReads,0);assert.equal(result.length,1);assert.match(result[0].content.body,/blocked/);assert.equal(JSON.stringify(wire),before);assert.equal(result[0].content.file,undefined);
});
test('original Olm and Megolm history is read through the original SDK without wire mutation',async()=>{
 for(const algorithm of ['m.olm.v1.curve25519-aes-sha2','m.megolm.v1.aes-sha2']){
 const wire={algorithm,ciphertext:'original opaque ciphertext'},before=JSON.stringify(wire),{transport,state}=fixture('m.room.encrypted',wire);const result=await transport.messages('!room:test.invalid');
 assert.equal(state.decrypts,1);assert.equal(result[0].content.body,'original historical text');assert.equal(JSON.stringify(wire),before);
 }
});

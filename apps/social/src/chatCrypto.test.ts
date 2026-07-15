import assert from "node:assert/strict";
import test from "node:test";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { createDeviceRotation, createEnvelopeSet, decryptAttachment, decryptDeviceMessage, encryptAttachment, verifyMessageSignature, type ChatDevice, type ChatMessage } from "./chatCrypto";

const accountA=`ynx1${"a".repeat(38)}`,accountB=`ynx1${"b".repeat(38)}`;
function raw(value:Uint8Array){return Buffer.from(value).toString("base64url").replace(/-/g,"+").replace(/_/g,"/")}

test("device-aware envelope set decrypts on every active device and verifies sender",()=>{
  const signingSeed=Uint8Array.from({length:32},(_,index)=>index+1),aliceEncryption=Uint8Array.from({length:32},(_,index)=>index+33),bobEncryption=Uint8Array.from({length:32},(_,index)=>index+65);
  const devices:ChatDevice[]=[
    {id:"device-alice",account:accountA,signingPublicKey:raw(ed25519.getPublicKey(signingSeed)),encryptionPublicKey:raw(x25519.getPublicKey(aliceEncryption)),status:"active",createdAt:"2026-07-15T00:00:00Z",updatedAt:"2026-07-15T00:00:00Z"},
    {id:"device-bob",account:accountB,signingPublicKey:raw(ed25519.getPublicKey(Uint8Array.from({length:32},()=>9))),encryptionPublicKey:raw(x25519.getPublicKey(bobEncryption)),status:"active",createdAt:"2026-07-15T00:00:00Z",updatedAt:"2026-07-15T00:00:00Z"},
  ];
  const request=createEnvelopeSet({signingSeed,senderAccount:accountA,senderDeviceId:"device-alice",conversationId:"conv_example",messageId:"message_example",plaintext:"private hello",devices,entropy:Uint8Array.from({length:32},(_,index)=>index+97)});
  const message:ChatMessage={...request,id:request.messageId,conversationId:"conv_example",sender:accountA,senderDeviceId:"device-alice",protocolVersion:2,envelopeSetHash:"0".repeat(64),createdAt:"2026-07-15T00:00:00Z"};
  assert.equal(request.envelopes.length,2);
  assert.equal(decryptDeviceMessage({encryptionSeed:aliceEncryption,deviceId:"device-alice",message}),"private hello");
  assert.equal(decryptDeviceMessage({encryptionSeed:bobEncryption,deviceId:"device-bob",message}),"private hello");
  assert.equal(verifyMessageSignature(message,devices[0]!),true);
});

test("tampered envelope is rejected",()=>{
  const signingSeed=new Uint8Array(32).fill(1),encryptionSeed=new Uint8Array(32).fill(2);
  const device:ChatDevice={id:"device-one",account:accountA,signingPublicKey:raw(ed25519.getPublicKey(signingSeed)),encryptionPublicKey:raw(x25519.getPublicKey(encryptionSeed)),status:"active",createdAt:"2026-07-15T00:00:00Z",updatedAt:"2026-07-15T00:00:00Z"};
  const request=createEnvelopeSet({signingSeed,senderAccount:accountA,senderDeviceId:device.id,conversationId:"conv_tamper",messageId:"message_tamper",plaintext:"secret",devices:[device],entropy:new Uint8Array(32).fill(3)});
  const envelope={...request.envelopes[0]!,ciphertext:`${request.envelopes[0]!.ciphertext.slice(0,-1)}A`};
  const message:ChatMessage={...request,envelopes:[envelope],id:request.messageId,conversationId:"conv_tamper",sender:accountA,senderDeviceId:device.id,protocolVersion:2,envelopeSetHash:"0".repeat(64),createdAt:"2026-07-15T00:00:00Z"};
  assert.throws(()=>decryptDeviceMessage({encryptionSeed,deviceId:device.id,message}),/integrity|authentication/);
});

test("attachment encryption enforces bounds and authentication",()=>{const key=new Uint8Array(32).fill(8),nonce=new Uint8Array(24).fill(9),bytes=new TextEncoder().encode("private attachment"),encrypted=encryptAttachment({bytes,key,nonce,conversationId:"conv_attachment",name:"proof.txt",mimeType:"text/plain"});assert.deepEqual(decryptAttachment({ciphertext:encrypted.ciphertext,key,nonce,conversationId:"conv_attachment",name:"proof.txt",mimeType:"text/plain"}),bytes);const tampered=encrypted.ciphertext.slice();tampered[0]=(tampered[0]??0)^1;assert.throws(()=>decryptAttachment({ciphertext:tampered,key,nonce,conversationId:"conv_attachment",name:"proof.txt",mimeType:"text/plain"}),/authentication/)});

test("device rotation is dual-authorized and exact-retry stable",()=>{const authorizer=new Uint8Array(32).fill(4),nextSigning=new Uint8Array(32).fill(5),nextEncryption=new Uint8Array(32).fill(6),input={account:accountA,authorizingDeviceId:"device-old",replacedDeviceId:"device-old",authorizingSigningSeed:authorizer,newSigningSeed:nextSigning,newEncryptionSeed:nextEncryption,idempotencyKey:"rotate-exact-retry",newDeviceId:"device-new"};const first=createDeviceRotation(input),retry=createDeviceRotation(input);assert.deepEqual(retry,first);assert.equal(first.authorizationSignature.length>80,true);assert.equal(first.newDeviceProofSignature.length>80,true);assert.notEqual(first.authorizationSignature,first.newDeviceProofSignature)});

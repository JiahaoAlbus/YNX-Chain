import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const CHAT_ALGORITHM="x25519-hkdf-sha256-xchacha20poly1305" as const;
const INFO=utf8ToBytes("YNX-NATIVE-WALLET-E2EE-V1");

export type ChatDevice=Readonly<{id:string;account:string;signingPublicKey:string;encryptionPublicKey:string;status:"active"|"revoked";createdAt:string;updatedAt:string}>;
export type ChatEnvelope=Readonly<{recipientAccount:string;recipientDeviceId:string;algorithm:typeof CHAT_ALGORITHM;ephemeralPublicKey:string;nonce:string;ciphertext:string;ciphertextHash:string}>;
export type ChatMessage=Readonly<{id:string;conversationId:string;sender:string;senderDeviceId:string;protocolVersion:number;envelopes:readonly ChatEnvelope[];senderSignature:string;envelopeSetHash:string;createdAt:string;deliveredAt?:Readonly<Record<string,string>>;readAt?:Readonly<Record<string,string>>}>;
export type SendMessageRequest=Readonly<{messageId:string;envelopes:readonly ChatEnvelope[];senderSignature:string}>;
export type AttachmentPayload=Readonly<{type:"attachment";name:string;mimeType:string;sizeBytes:number;mediaId:string;key:string;nonce:string}>;
export type DeviceRotationRequest=Readonly<{idempotencyKey:string;newDeviceId:string;signingPublicKey:string;encryptionPublicKey:string;authorizationSignature:string;newDeviceProofSignature:string}>;

export function createDeviceRotation(input:{account:string;authorizingDeviceId:string;replacedDeviceId:string;authorizingSigningSeed:Uint8Array;newSigningSeed:Uint8Array;newEncryptionSeed:Uint8Array;idempotencyKey:string;newDeviceId:string}):DeviceRotationRequest{
  const account=ynx(input.account),authorizingDeviceId=id(input.authorizingDeviceId),replacedDeviceId=id(input.replacedDeviceId),idempotencyKey=id(input.idempotencyKey),newDeviceId=id(input.newDeviceId);validSeed(input.authorizingSigningSeed,"authorizing signing seed");validSeed(input.newSigningSeed,"new signing seed");validSeed(input.newEncryptionSeed,"new encryption seed");if(newDeviceId===replacedDeviceId)throw new Error("Replacement Social device ID must be new");
  const request={idempotencyKey,newDeviceId,signingPublicKey:encode(ed25519.getPublicKey(input.newSigningSeed)),encryptionPublicKey:encode(x25519.getPublicKey(input.newEncryptionSeed))},document=JSON.stringify({account,authorizingDeviceId,replacedDeviceId,...request});
  return Object.freeze({...request,authorizationSignature:encode(ed25519.sign(utf8ToBytes(`ynx-chat-device-rotation-authorize-v1\n${document}`),input.authorizingSigningSeed)),newDeviceProofSignature:encode(ed25519.sign(utf8ToBytes(`ynx-chat-device-rotation-new-device-v1\n${document}`),input.newSigningSeed))});
}

export function createEnvelopeSet(input:{signingSeed:Uint8Array;senderAccount:string;senderDeviceId:string;conversationId:string;messageId:string;plaintext:string;devices:readonly ChatDevice[];entropy:Uint8Array}):SendMessageRequest{
  validSeed(input.signingSeed,"signing seed"); validSeed(input.entropy,"message entropy");
  const sender=ynx(input.senderAccount),senderDeviceId=id(input.senderDeviceId),conversationId=id(input.conversationId),messageId=id(input.messageId),plaintext=input.plaintext.trim();
  if(!plaintext||plaintext.length>16000)throw new Error("Message must contain 1 to 16000 characters");
  const devices=input.devices.filter((device)=>device.status==="active");
  if(devices.length<1||devices.length>32)throw new Error("Conversation requires 1 to 32 active device recipients");
  if(new Set(devices.map((device)=>device.id)).size!==devices.length)throw new Error("Duplicate Chat device recipient");
  const ephemeral=input.entropy.slice(),ephemeralPublicKey=encode(x25519.getPublicKey(ephemeral));
  const envelopes=devices.map((device):ChatEnvelope=>{
    const recipientAccount=ynx(device.account),recipientDeviceId=id(device.id);
    const nonce=sha256(concatBytes(utf8ToBytes("YNX_CHAT_ENVELOPE_NONCE_V2\n"),input.entropy,utf8ToBytes(`\n${recipientAccount}\n${recipientDeviceId}`))).slice(0,24);
    const aad=envelopeAAD(conversationId,messageId,senderDeviceId,recipientAccount,recipientDeviceId,ephemeralPublicKey);
    const key=derive(ephemeral.slice(),decode32(device.encryptionPublicKey,"recipient encryption key"));
    const ciphertext=xchacha20poly1305(key,nonce,aad).encrypt(utf8ToBytes(plaintext)); key.fill(0);
    return Object.freeze({recipientAccount,recipientDeviceId,algorithm:CHAT_ALGORITHM,ephemeralPublicKey,nonce:encode(nonce),ciphertext:encode(ciphertext),ciphertextHash:bytesToHex(sha256(ciphertext))});
  }).sort(compareEnvelope);
  ephemeral.fill(0);
  const unsigned={messageId,envelopes};
  const senderSignature=encode(ed25519.sign(signaturePayload(conversationId,messageId,sender,senderDeviceId,envelopes),input.signingSeed));
  return Object.freeze({...unsigned,envelopes:Object.freeze(envelopes),senderSignature});
}

export function decryptDeviceMessage(input:{encryptionSeed:Uint8Array;deviceId:string;message:ChatMessage}):string{
  validSeed(input.encryptionSeed,"encryption seed");
  if(input.message.protocolVersion!==2)throw new Error("Unsupported Chat message protocol");
  const envelope=input.message.envelopes.find((item)=>item.recipientDeviceId===input.deviceId);
  if(!envelope)throw new Error("Message has no envelope for this device");
  if(envelope.algorithm!==CHAT_ALGORITHM)throw new Error("Unsupported Chat encryption algorithm");
  const nonce=decode(envelope.nonce,"message nonce"),ciphertext=decode(envelope.ciphertext,"message ciphertext");
  if(nonce.length!==24||ciphertext.length<16||bytesToHex(sha256(ciphertext))!==envelope.ciphertextHash)throw new Error("Encrypted message integrity check failed");
  const key=derive(input.encryptionSeed.slice(),decode32(envelope.ephemeralPublicKey,"ephemeral public key"));
  try{return new TextDecoder("utf-8",{fatal:true}).decode(xchacha20poly1305(key,nonce,envelopeAAD(input.message.conversationId,input.message.id,input.message.senderDeviceId,envelope.recipientAccount,envelope.recipientDeviceId,envelope.ephemeralPublicKey)).decrypt(ciphertext))}
  catch{throw new Error("Encrypted message authentication failed")}
  finally{key.fill(0)}
}

export function verifyMessageSignature(message:ChatMessage,senderDevice:ChatDevice):boolean{
  const signature=decode(message.senderSignature,"sender signature");
  return signature.length===64&&ed25519.verify(signature,signaturePayload(message.conversationId,message.id,message.sender,message.senderDeviceId,message.envelopes),decode32(senderDevice.signingPublicKey,"sender signing key"));
}

export function encryptAttachment(input:{bytes:Uint8Array;key:Uint8Array;nonce:Uint8Array;conversationId:string;name:string;mimeType:string}){
  validSeed(input.key,"attachment key");if(input.nonce.length!==24)throw new Error("Attachment nonce must contain 24 bytes");if(input.bytes.length<1||input.bytes.length>25*1024*1024)throw new Error("Attachment must contain 1 byte to 25 MB");const aad=attachmentAAD(input.conversationId,input.name,input.mimeType),ciphertext=xchacha20poly1305(input.key,input.nonce,aad).encrypt(input.bytes);return Object.freeze({ciphertext,sha256:bytesToHex(sha256(ciphertext))})
}
export function decryptAttachment(input:{ciphertext:Uint8Array;key:Uint8Array;nonce:Uint8Array;conversationId:string;name:string;mimeType:string}){validSeed(input.key,"attachment key");if(input.nonce.length!==24)throw new Error("Attachment nonce must contain 24 bytes");try{return xchacha20poly1305(input.key,input.nonce,attachmentAAD(input.conversationId,input.name,input.mimeType)).decrypt(input.ciphertext)}catch{throw new Error("Encrypted attachment authentication failed")}}
export function encodeRawBase64(value:Uint8Array){return encode(value)}
export function decodeRawBase64(value:string,label="value"){return decode(value,label)}
function attachmentAAD(conversationId:string,name:string,mimeType:string){if(!name||name.length>255||!mimeType||mimeType.length>100)throw new Error("Attachment metadata is invalid");return utf8ToBytes(["ynx-social-attachment-v1",id(conversationId),name,mimeType].join("\n"))}

function signaturePayload(conversationId:string,messageId:string,sender:string,senderDeviceId:string,envelopes:readonly ChatEnvelope[]):Uint8Array{
  const canonical=envelopes.map((value)=>({recipientAccount:ynx(value.recipientAccount),recipientDeviceId:id(value.recipientDeviceId),algorithm:value.algorithm,ephemeralPublicKey:value.ephemeralPublicKey,nonce:value.nonce,ciphertext:value.ciphertext})).sort(compareEnvelope);
  return concatBytes(utf8ToBytes("ynx-chat-message-v2\n"),utf8ToBytes(JSON.stringify({protocolVersion:2,conversationId:id(conversationId),messageId:id(messageId),sender:ynx(sender),senderDeviceId:id(senderDeviceId),envelopes:canonical})));
}
function envelopeAAD(conversationId:string,messageId:string,senderDeviceId:string,recipientAccount:string,recipientDeviceId:string,ephemeralPublicKey:string){return utf8ToBytes(["ynx-chat-envelope-v2",id(conversationId),id(messageId),id(senderDeviceId),ynx(recipientAccount),id(recipientDeviceId),CHAT_ALGORITHM,ephemeralPublicKey].join("\n"))}
function derive(privateKey:Uint8Array,publicKey:Uint8Array){const shared=x25519.getSharedSecret(privateKey,publicKey);privateKey.fill(0);const key=hkdf(sha256,shared,undefined,INFO,32);shared.fill(0);return key}
function compareEnvelope(left:{recipientAccount:string;recipientDeviceId:string},right:{recipientAccount:string;recipientDeviceId:string}){return left.recipientAccount===right.recipientAccount?left.recipientDeviceId.localeCompare(right.recipientDeviceId):left.recipientAccount.localeCompare(right.recipientAccount)}
function validSeed(value:Uint8Array,label:string){if(!(value instanceof Uint8Array)||value.length!==32)throw new Error(`Chat ${label} must contain 32 bytes`)}
function id(value:string){if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value))throw new Error("Chat identifier is invalid");return value}
function ynx(value:string){if(!/^ynx1[0-9a-z]{38}$/.test(value))throw new Error("Chat account is invalid");return value}
function decode32(value:string,label:string){const bytes=decode(value,label);if(bytes.length!==32)throw new Error(`${label} must contain 32 bytes`);return bytes}
function encode(value:Uint8Array){const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let out="";for(let i=0;i<value.length;i+=3){const a=value[i]??0,b=value[i+1],c=value[i+2],n=(a<<16)|((b??0)<<8)|(c??0);out+=chars[(n>>>18)&63]!+chars[(n>>>12)&63]!+(b===undefined?"":chars[(n>>>6)&63]!)+(c===undefined?"":chars[n&63]!)}return out}
function decode(value:string,label:string){if(!/^[A-Za-z0-9+/_-]+$/.test(value))throw new Error(`${label} is not raw base64`);const normalized=value.replace(/-/g,"+").replace(/_/g,"/");const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",out:number[]=[];for(let i=0;i<normalized.length;i+=4){const chunk=normalized.slice(i,i+4),indexes=[...chunk].map((char)=>chars.indexOf(char));if(chunk.length===1||indexes.some((value)=>value<0))throw new Error(`${label} is not raw base64`);const n=((indexes[0]??0)<<18)|((indexes[1]??0)<<12)|((indexes[2]??0)<<6)|(indexes[3]??0);out.push((n>>>16)&255);if(chunk.length>2)out.push((n>>>8)&255);if(chunk.length>3)out.push(n&255)}return Uint8Array.from(out)}

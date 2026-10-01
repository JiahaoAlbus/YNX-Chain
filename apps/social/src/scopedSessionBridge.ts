import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { encodeRawBase64 } from "./chatCrypto";
import type { SocialAPI, Session } from "./api";

export const SOCIAL_CHAT_SCOPES = Object.freeze(["account:read", "profile:link", "social.messaging", "social.profile"]);
export type SessionProof = Readonly<{proof:Readonly<Record<string,unknown>>;proofHeader:string}>;
export type ScopedSessionClient = { proof(scopes:readonly string[]):Promise<SessionProof> };
export type StoredChatDevice = {deviceId:string;signingSeed:string;encryptionSeed:string;account?:string;[key:string]:unknown};

// Existing v1 keys are reused, not migrated or replaced. Callers persist a new
// device only after an explicit chat permission flow, never on guest loading.
export function parseStoredChatDevice(raw:string):StoredChatDevice {
  const value=JSON.parse(raw) as StoredChatDevice;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value.deviceId)||! /^[a-f0-9]{64}$/.test(value.signingSeed)||! /^[a-f0-9]{64}$/.test(value.encryptionSeed))throw new Error("Existing Social keys require recovery; nothing was replaced");
  return value;
}
export function deviceRegistration(proof:SessionProof,device:StoredChatDevice){
  const session=proof.proof;
  for(const key of ["account","sessionBinding","deviceId","deviceKey"])if(typeof session[key]!=="string")throw new Error("Shared Product Session proof is incomplete");
  const account=session.account as string,binding=session.sessionBinding as string;
  if(device.account&&device.account!==account)throw new Error("This Social device belongs to another account; its keys were preserved");
  const signing=hexToBytes(device.signingSeed),encryption=hexToBytes(device.encryptionSeed);
  try{
    const signingPublicKey=encodeRawBase64(ed25519.getPublicKey(signing)),encryptionPublicKey=encodeRawBase64(x25519.getPublicKey(encryption));
    const sign=(text:string)=>encodeRawBase64(ed25519.sign(utf8ToBytes(text),signing));
    const idempotency=(kind:string)=>`${kind}-${bytesToHex(sha256(utf8ToBytes(binding))).slice(0,24)}`;
    return {deviceId:device.deviceId,signingPublicKey,encryptionPublicKey,
      deviceProofSignature:sign(["ynx-social-session-device-v2",account,binding,session.deviceId,session.deviceKey,device.deviceId,signingPublicKey,encryptionPublicKey].join("\n")),
      chatRegistrationSignature:sign(["ynx-chat-device-register-v1",account,device.deviceId,signingPublicKey,encryptionPublicKey,idempotency("social-chat")].join("\n")),
      squareRegistrationSignature:sign(["ynx-square-device-register-v1",account,device.deviceId,signingPublicKey,idempotency("social-square")].join("\n"))};
  }finally{signing.fill(0);encryption.fill(0)}
}
export async function bindScopedSocialSession(api:SocialAPI,client:ScopedSessionClient,device:StoredChatDevice,csrf?:string):Promise<Session>{
  const proof=await client.proof(["social.messaging","social.profile"]);
  const account=proof.proof.account;
  if(typeof account!=="string")throw new Error("No verified shared account");
  api.useProductSession(scopes=>client.proof(scopes),account,csrf);
  const result=await api.bindDevice(deviceRegistration(proof,device),proof);
  if(result.session.account!==account||result.session.deviceId!==device.deviceId)throw new Error("Social device binding changed");
  return {...result,token:"",authMode:"product-session-v2"};
}

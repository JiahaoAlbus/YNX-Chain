import test from 'node:test';
import assert from 'node:assert/strict';
import {ed25519,x25519} from '@noble/curves/ed25519.js';
import {utf8ToBytes} from '@noble/hashes/utils.js';
import {SocialAPI} from './api';
import {deviceRegistration,parseStoredChatDevice,type SessionProof} from './scopedSessionBridge';
import {decodeRawBase64} from './chatCrypto';

const account=`ynx1${'a'.repeat(38)}`;
const device={deviceId:'social-existing-device',account,signingSeed:'07'.repeat(32),encryptionSeed:'08'.repeat(32),productSecret:'09'.repeat(32)};
const proof:SessionProof={proof:{account,sessionBinding:'a'.repeat(64),deviceId:'product-existing-device',deviceKey:'public-p256-key'},proofHeader:'synthetic-header'};
test('scoped registration signs exact session and existing chat keys without mutating legacy fields',()=>{
  const before=JSON.stringify(device),registration=deviceRegistration(proof,device);
  assert.equal(JSON.stringify(device),before);
  assert.equal(parseStoredChatDevice(before).productSecret,device.productSecret);
  assert.equal(registration.encryptionPublicKey,Buffer.from(x25519.getPublicKey(new Uint8Array(32).fill(8))).toString('base64').replace(/=+$/,''));
  assert.ok(ed25519.verify(decodeRawBase64(registration.deviceProofSignature),utf8ToBytes(['ynx-social-session-device-v2',account,proof.proof.sessionBinding,proof.proof.deviceId,proof.proof.deviceKey,device.deviceId,registration.signingPublicKey,registration.encryptionPublicKey].join('\n')),ed25519.getPublicKey(new Uint8Array(32).fill(7))));
  assert.throws(()=>deviceRegistration({...proof,proof:{...proof.proof,account:`ynx1${'b'.repeat(38)}`}},device),/another account/);
});
test('API uses a fresh exact route proof and never an old bearer for a scoped session',async()=>{
  const original=globalThis.fetch,calls:readonly string[][]=[] as string[][],headers:Headers[]=[];
  globalThis.fetch=async(_url,init)=>{headers.push(new Headers(init?.headers));return Response.json({record:{}})};
  try{const api=new SocialAPI('https://social.ynxweb4.com','legacy-token');api.useProductSession(async scopes=>{(calls as string[][]).push([...scopes]);return {...proof,proofHeader:`fresh-${calls.length}`}},account,'csrf');await api.profile();await api.conversations();assert.deepEqual(calls,[['social.profile'],['social.messaging']]);assert.equal(headers[0]!.get('Authorization'),null);assert.equal(headers[0]!.get('X-YNX-SSO-CSRF'),'csrf');assert.equal(headers[1]!.get('X-YNX-Product-Session-Proof-V2'),'fresh-2');api.setToken(null);await assert.rejects(api.profile(),/locked/)}finally{globalThis.fetch=original}
});
test('account changes and late responses cannot display the previous private workspace',async()=>{
  const original=globalThis.fetch;let finish:((response:Response)=>void)|undefined;
  globalThis.fetch=async()=>new Promise<Response>(resolve=>{finish=resolve});
  try{const api=new SocialAPI('https://social.ynxweb4.com');api.useProductSession(async()=>proof,account);const pending=api.profile();await new Promise(resolve=>setTimeout(resolve,0));api.setToken(null);finish!(Response.json({record:{id:account}}));await assert.rejects(pending,/response discarded/);api.useProductSession(async()=>({...proof,proof:{...proof.proof,account:'other-account'}}),account);await assert.rejects(api.profile(),/account changed/)}finally{globalThis.fetch=original}
});
test('live authority rejection invalidates Native/Web private access without deleting device records',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:'SESSION_REVOKED'},{status:401});
  try{let invalidations=0;const api=new SocialAPI('https://social.ynxweb4.com');api.onPrivateInvalidated=()=>{invalidations++};api.useProductSession(async()=>proof,account);await assert.rejects(api.profile(),/SESSION_REVOKED/);assert.equal(invalidations,1);await assert.rejects(api.profile(),/locked/);assert.equal(device.signingSeed,'07'.repeat(32))}finally{globalThis.fetch=original}
});
test('empty server profile enters explicit setup without inventing a profile or turning auth failure into setup',async()=>{
  const original=globalThis.fetch;const api=new SocialAPI('https://social.ynxweb4.com','legacy');
  try{globalThis.fetch=async()=>Response.json({record:{id:account,handle:'',displayName:'',bio:''}});assert.equal(await api.profileOrSetup(),null);globalThis.fetch=async()=>Response.json({error:'missing'},{status:404});assert.equal(await api.profileOrSetup(),null);globalThis.fetch=async()=>Response.json({error:'unauthorized'},{status:401});await assert.rejects(api.profileOrSetup(),/unauthorized/)}finally{globalThis.fetch=original}
});

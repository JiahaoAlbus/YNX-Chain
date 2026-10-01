import test from 'node:test';
import assert from 'node:assert/strict';
import {ed25519,x25519} from '@noble/curves/ed25519.js';
import {SocialAPI} from '../src/api';
import {DurableOutbox} from '../src/durableOutbox';
import {decryptDeviceMessage,type ChatDevice,type ChatMessage,type SendMessageRequest} from '../src/chatCrypto';
import {SocialWorkspace} from './chat-workspace';

const alice=`ynx1${'a'.repeat(38)}`,bob=`ynx1${'b'.repeat(38)}`;
const raw=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64').replace(/=+$/,'');
function fixture(){
  const device={account:alice,deviceId:'social-existing-device',signingSeed:'07'.repeat(32),encryptionSeed:'08'.repeat(32)};
  const devices:ChatDevice[]=[{id:device.deviceId,account:alice,signingPublicKey:raw(ed25519.getPublicKey(new Uint8Array(32).fill(7))),encryptionPublicKey:raw(x25519.getPublicKey(new Uint8Array(32).fill(8))),status:'active',createdAt:'',updatedAt:''},{id:'social-bob-device',account:bob,signingPublicKey:raw(ed25519.getPublicKey(new Uint8Array(32).fill(9))),encryptionPublicKey:raw(x25519.getPublicKey(new Uint8Array(32).fill(10))),status:'active',createdAt:'',updatedAt:''}];
  const slots=new Map<string,string>(),outbox=new DurableOutbox({read:key=>slots.get(key)??null,write:(key,value)=>{slots.set(key,value)},remove:key=>{slots.delete(key)}});
  let createCalls=0,proofs=0,sendFails=false,revoked=false,identityAccount=alice,disconnectStatus='disconnected';
  const sent:SendMessageRequest[]=[],messages:ChatMessage[]=[],views:any[]=[];
  const result={status:'connected',session:{account:alice,scopes:['account:read','profile:link','social.messaging','social.profile']}};
  const client={async proof(scopes:readonly string[]){if(revoked)throw new Error('SESSION_REVOKED');assert.ok(scopes.every(scope=>result.session.scopes.includes(scope)));proofs++;return {proof:{account:alice,sessionBinding:'a'.repeat(64),deviceId:'product-existing-device',deviceKey:'public-product-key'},proofHeader:`proof-${proofs}`}},async restore(){return result},async handleReturn(){return result},async begin(){return {status:'connecting'}},async disconnect(){revoked=true;return {status:disconnectStatus}}};
  const api=new SocialAPI('https://social.ynxweb4.com');
  const workspace=new SocialWorkspace(client,api,{async get(account,create){assert.equal(account,alice);if(create)createCalls++;return {...device}}},outbox,async()=>({account:identityAccount,csrfToken:'synthetic-csrf'}),view=>views.push(view),bytes=>{bytes.fill(11);return bytes});
  const fetch:typeof globalThis.fetch=async(input,init)=>{
    const path=new URL(String(input)).pathname,headers=new Headers(init?.headers);assert.match(headers.get('X-YNX-Product-Session-Proof-V2')??'',/^proof-/);assert.equal(headers.get('Authorization'),null);
    if(path.endsWith('/session/bind'))return Response.json({session:{id:'psv2-test',account:alice,deviceId:device.deviceId,scopes:result.session.scopes,createdAt:'',expiresAt:''},authMode:'product-session-v2'});
    if(path.endsWith('/profile'))return Response.json({record:{id:alice,handle:'alice',displayName:'Alice',bio:'Hello',privacy:{}}});
    if(path.endsWith('/conversations'))return Response.json({conversations:[{id:'conversation-test',title:'Bob',unread:0,lastMessage:'',e2ee:'verified',updatedAt:''}]});
    if(path.endsWith('/devices'))return Response.json({devices});
    if(path.endsWith('/messages')){
      if(init?.method==='POST'){const request=JSON.parse(String(init.body)) as SendMessageRequest;sent.push(request);if(sendFails)throw new Error('network unavailable');const record:ChatMessage={id:request.messageId,conversationId:'conversation-test',sender:alice,senderDeviceId:device.deviceId,protocolVersion:2,envelopes:request.envelopes,senderSignature:request.senderSignature,envelopeSetHash:'',createdAt:''};messages.push(record);return Response.json({record,replayed:false})}
      return Response.json({messages});
    }
    throw new Error(`Unexpected test route ${path}`);
  };
  return {workspace,client,api,outbox,device,fetch,sent,views,counts:()=>({createCalls,proofs}),failSend:(value:boolean)=>{sendFails=value},switchIdentity:()=>{identityAccount=bob},pendingRevocation:()=>{disconnectStatus='retry-required'}};
}
test('approved Web workspace restores profile/conversations with existing keys and no fresh consent',async()=>{
  const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;
  try{await f.workspace.restore();assert.equal(f.workspace.current.account,alice);assert.equal(f.workspace.current.profile?.displayName,'Alice');assert.equal(f.counts().createCalls,0);assert.ok(f.counts().proofs>=3);await f.workspace.select('conversation-test');assert.deepEqual(f.workspace.current.messages,[])}finally{globalThis.fetch=original}
});
test('Web encrypted send and retry reuse the existing engine and exact retained ciphertext',async()=>{
  const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;
  try{await f.workspace.restore();await f.workspace.select('conversation-test');f.failSend(true);await assert.rejects(f.workspace.send('Private original'),/network/);assert.equal(f.outbox.read().length,1);assert.equal(JSON.stringify(f.sent[0]).includes('Private original'),false);f.failSend(false);await f.workspace.retry();assert.deepEqual(f.sent[0],f.sent[1]);assert.equal(f.outbox.read().length,0);const item=f.workspace.current.messages![0]!;assert.equal(item.plaintext,'Private original');assert.equal(decryptDeviceMessage({deviceId:'social-bob-device',encryptionSeed:new Uint8Array(32).fill(10),message:item.record}),'Private original')}finally{globalThis.fetch=original}
});
test('switching shared identity locks old data and never remaps device keys',async()=>{
  const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;
  try{await f.workspace.restore();f.switchIdentity();await assert.rejects(f.workspace.restore(),/differ/);assert.equal(f.workspace.current.account,undefined);assert.equal(f.workspace.current.profile,undefined);assert.equal(f.counts().createCalls,0);await assert.rejects(f.workspace.refresh(),/approval/)}finally{globalThis.fetch=original}
});
test('pending revocation locks immediately without claiming success or deleting the outbox',async()=>{
  const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;
  try{await f.workspace.restore();await f.workspace.select('conversation-test');f.failSend(true);await assert.rejects(f.workspace.send('Retain me'));f.pendingRevocation();await assert.rejects(f.workspace.logout(),/pending/);assert.equal(f.workspace.current.account,undefined);assert.equal(f.outbox.read().length,1);await assert.rejects(f.api.profile(),/locked/)}finally{globalThis.fetch=original}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {ed25519,x25519} from '@noble/curves/ed25519.js';
import {SocialAPI} from '../src/api';
import {DurableOutbox} from '../src/durableOutbox';
import {decryptDeviceMessage,type ChatDevice,type ChatMessage,type SendMessageRequest} from '../src/chatCrypto';
import {SocialWorkspace} from './chat-workspace';
import type {InvitationIntent} from '../src/invitationIntent';

const alice=`ynx1${'a'.repeat(38)}`,bob=`ynx1${'b'.repeat(38)}`;
const raw=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64').replace(/=+$/,'');
function fixture(){
  const device={account:alice,deviceId:'social-existing-device',signingSeed:'07'.repeat(32),encryptionSeed:'08'.repeat(32)};
  const devices:ChatDevice[]=[{id:device.deviceId,account:alice,signingPublicKey:raw(ed25519.getPublicKey(new Uint8Array(32).fill(7))),encryptionPublicKey:raw(x25519.getPublicKey(new Uint8Array(32).fill(8))),status:'active',createdAt:'',updatedAt:''},{id:'social-bob-device',account:bob,signingPublicKey:raw(ed25519.getPublicKey(new Uint8Array(32).fill(9))),encryptionPublicKey:raw(x25519.getPublicKey(new Uint8Array(32).fill(10))),status:'active',createdAt:'',updatedAt:''}];
  const slots=new Map<string,string>(),outbox=new DurableOutbox({read:key=>slots.get(key)??null,write:(key,value)=>{slots.set(key,value)},remove:key=>{slots.delete(key)}});
  let createCalls=0,proofs=0,sendFails=false,revoked=false,identityAccount=alice,disconnectStatus='disconnected';
  const invitationIntents=new Map<string,InvitationIntent>(),invitationWrites:any[]=[],serverInvitations=new Map<string,any>();let invitationResponseLost=false;
  const intentStore={async load(account:string){return invitationIntents.get(account)??null},async reserve(candidate:InvitationIntent,guard:()=>void){guard();const original=invitationIntents.get(candidate.account);if(original)return original;invitationIntents.set(candidate.account,candidate);return candidate},async clear(account:string,key:string,guard:()=>void){guard();assert.equal(invitationIntents.get(account)?.key,key);return invitationIntents.delete(account)}};
  const sent:SendMessageRequest[]=[],messages:ChatMessage[]=[],views:any[]=[];let privacySaveFails=false;const privacyWrites:any[]=[];let privacy={account:alice,discoverableByHandle:true,contactsMatching:false,allowRecommendations:false,allowRequestsFrom:'everyone',avatarUrl:'https://example.test/original.png'};
  const result={status:'connected',session:{account:alice,scopes:['account:read','profile:link','social.contacts','social.messaging','social.profile']}};
  const client={async proof(scopes:readonly string[]){if(revoked)throw new Error('SESSION_REVOKED');assert.ok(scopes.every(scope=>result.session.scopes.includes(scope)));proofs++;return {proof:{account:alice,sessionBinding:'a'.repeat(64),deviceId:'product-existing-device',deviceKey:'public-product-key'},proofHeader:`proof-${proofs}`}},async restore(){return result},async handleReturn(){return result},async begin(){return {status:'connecting'}},async disconnect(){revoked=true;return {status:disconnectStatus}}};
  const api=new SocialAPI('https://social.ynxweb4.com');
  const workspace=new SocialWorkspace(client,api,{async get(account,create){assert.equal(account,alice);if(create)createCalls++;return {...device}}},outbox,async()=>({account:identityAccount,csrfToken:'synthetic-csrf'}),view=>views.push(view),bytes=>{bytes.fill(11);return bytes},intentStore);
  const fetch:typeof globalThis.fetch=async(input,init)=>{
    const path=new URL(String(input)).pathname,headers=new Headers(init?.headers);assert.match(headers.get('X-YNX-Product-Session-Proof-V2')??'',/^proof-/);assert.equal(headers.get('Authorization'),null);
    if(path.endsWith('/session/bind'))return Response.json({session:{id:'psv2-test',account:alice,deviceId:device.deviceId,scopes:result.session.scopes,createdAt:'',expiresAt:''},authMode:'product-session-v2'});
    if(path.endsWith('/invites')){if(init?.method==='POST'){const body=JSON.parse(String(init.body));invitationWrites.push(body);if(!serverInvitations.has(body.idempotencyKey))serverInvitations.set(body.idempotencyKey,{id:'invite_'+'c'.repeat(24),link:'https://social.ynxweb4.com/invite/'+'d'.repeat(32),status:'active',createdAt:'2026-10-02T00:00:00Z',expiresAt:'2026-10-03T00:00:00Z'});if(invitationResponseLost)throw new Error('invitation response lost');return Response.json({record:serverInvitations.get(body.idempotencyKey)})}const key=new URL(String(input)).searchParams.get('intent'),record=key?serverInvitations.get(key):null;return Response.json({invitations:[...serverInvitations.values()],operation:key?record?{confirmed:true,id:record.id}:{confirmed:false}:undefined})}
    if(path.endsWith('/settings')){if(init?.method==='PUT'){const body=JSON.parse(String(init.body));privacyWrites.push(body);if(privacySaveFails)throw new Error('privacy network unavailable');privacy={...privacy,...body};return Response.json({record:privacy,replayed:false})}return Response.json({record:privacy})}
    if(path.endsWith('/profile'))return Response.json({record:{id:alice,handle:'alice',displayName:'Alice',bio:'Hello',privacy:{}}});
    if(path.endsWith('/contacts'))return Response.json({contacts:[],requests:[]});
    if(path.endsWith('/conversations'))return Response.json({conversations:[{id:'conversation-test',title:'Bob',unread:0,lastMessage:'',e2ee:'verified',updatedAt:''}]});
    if(path.endsWith('/devices'))return Response.json({devices});
    if(path.endsWith('/messages')){
      if(init?.method==='POST'){const request=JSON.parse(String(init.body)) as SendMessageRequest;sent.push(request);if(sendFails)throw new Error('network unavailable');const record:ChatMessage={id:request.messageId,conversationId:'conversation-test',sender:alice,senderDeviceId:device.deviceId,protocolVersion:2,envelopes:request.envelopes,senderSignature:request.senderSignature,envelopeSetHash:'',createdAt:''};messages.push(record);return Response.json({record,replayed:false})}
      return Response.json({messages});
    }
    throw new Error(`Unexpected test route ${path}`);
  };
  return {workspace,client,api,outbox,device,fetch,sent,views,privacyWrites,invitationWrites,invitationIntents,loseInvitationResponse:(value:boolean)=>{invitationResponseLost=value},failPrivacy:(value:boolean)=>{privacySaveFails=value},counts:()=>({createCalls,proofs}),failSend:(value:boolean)=>{sendFails=value},switchIdentity:()=>{identityAccount=bob},pendingRevocation:()=>{disconnectStatus='retry-required'}};
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

test('normal privacy load/save and retry preserve original account, avatar and exact request identity without contact upload',async()=>{
 const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;const body={discoverableByHandle:false,contactsMatching:false,allowRecommendations:false,allowRequestsFrom:'nobody' as const};
 try{await f.workspace.restore();await f.workspace.loadPrivacy();assert.equal(f.workspace.current.settings?.contactsMatching,false);f.failPrivacy(true);await assert.rejects(f.workspace.savePrivacy(body),/network/);await assert.rejects(f.workspace.savePrivacy({...body,discoverableByHandle:true}),/unchanged/);f.failPrivacy(false);await f.workspace.savePrivacy(body);assert.deepEqual(f.privacyWrites[0],f.privacyWrites[1]);assert.equal(f.privacyWrites[1].avatarUrl,'https://example.test/original.png');assert.equal(f.workspace.current.settings?.allowRequestsFrom,'nobody');assert.equal(f.counts().createCalls,0)}finally{globalThis.fetch=original}
});

test('invitation response loss retains original nonce and exact retry confirms one server-owned link without new keys',async()=>{
 const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;try{await f.workspace.restore();f.loseInvitationResponse(true);await assert.rejects(f.workspace.createInvitation(),/lost/);assert.equal(f.invitationIntents.size,1);assert.equal(f.workspace.current.invitationPending,true);const key=f.invitationIntents.get(alice)?.key;f.loseInvitationResponse(false);await f.workspace.createInvitation();assert.equal(f.invitationWrites.length,2);assert.deepEqual(f.invitationWrites[0],f.invitationWrites[1]);assert.equal(f.invitationWrites[1].idempotencyKey,key);assert.equal(f.workspace.current.invitations?.length,1);assert.equal(f.invitationIntents.size,0);assert.equal(f.counts().createCalls,0)}finally{globalThis.fetch=original}
});
test('cold original invitation readback resolves a lost response without sending another POST',async()=>{
 const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetch;try{await f.workspace.restore();f.loseInvitationResponse(true);await assert.rejects(f.workspace.createInvitation(),/lost/);await f.workspace.restore();await f.workspace.loadInvitations();assert.equal(f.invitationWrites.length,1);assert.equal(f.workspace.current.invitations?.length,1);assert.equal(f.invitationIntents.size,0);assert.equal(f.workspace.current.invitationPending,false)}finally{globalThis.fetch=original}
});

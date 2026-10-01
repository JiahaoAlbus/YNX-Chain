import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SocialAPI} from '../src/api.ts';
import {SocialWorkspace} from './chat-workspace.ts';
import {protectedChatDevices} from './protected-chat-devices.ts';
import {DurableOutbox} from '../src/durableOutbox.ts';
import {createSocialPrivateSession,SOCIAL_CHAT_SCOPES} from './private-session.js';

// Node controller/API integration, not a real browser or installed Wallet claim.
const endpoint=process.env.SOCIAL_JOURNEY_ENDPOINT,origin='https://social.ynxweb4.com';
assert.match(endpoint??'',/^http:\/\/127\.0\.0\.1:\d+$/);
const realFetch=globalThis.fetch,registry=JSON.parse(await readFile(new URL('../src/vendor/product-session-registry.json',import.meta.url),'utf8'));
const people=new Map();
function receiveCookies(qa,response){for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],index=pair.indexOf('=');if(/Max-Age=-1|Max-Age=0/.test(value))qa.cookies.delete(pair.slice(0,index));else qa.cookies.set(pair.slice(0,index),pair.slice(index+1))}}
async function request(qa,path,options={}){const headers=new Headers(options.headers);headers.set('Origin',origin);headers.set('Cookie',[...qa.cookies].map(([key,value])=>`${key}=${value}`).join('; '));const response=await realFetch(endpoint+path,{...options,headers,redirect:'manual'});receiveCookies(qa,response);return response}
globalThis.fetch=async(input,options)=>{const url=new URL(String(input)),headers=new Headers(options?.headers),encoded=headers.get('X-YNX-Product-Session-Proof-V2');assert.equal(url.origin,endpoint);assert.ok(encoded,'private API requires a fresh route proof');const proof=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));const qa=people.get(proof.account);assert.ok(qa);return request(qa,url.pathname+url.search,options)};
function makeQA(account,code){
  const qa={account,code,cookies:new Map(),records:new Map(),slots:new Map(),status:'guest',session:null,proofCounter:0,lastProof:null,reject:false};people.set(account,qa);
  const storage={async load(account){const record=qa.records.get(account);return record?structuredClone(record):null},async insert(account,record){if(!qa.records.has(account))qa.records.set(account,structuredClone(record))},async legacy(){return null},async removeLegacy(){throw new Error('No legacy fixture exists')}};
  qa.devices=protectedChatDevices(storage,{crypto:globalThis.crypto,isSecureContext:true,location:{origin}});
  qa.client=createSocialPrivateSession({scopes:SOCIAL_CHAT_SCOPES,environment:{navigator:{onLine:true},fetch:async()=>Response.json(registry)},factory:async config=>{
    assert.deepEqual(config.scopes,['account:read','profile:link','social.contacts','social.messaging','social.profile']);assert.match(config.purpose,/contact requests/);
    const current=()=>qa.status==='connected'?{status:qa.status,session:qa.session}:{status:qa.status};
    return {storage:{get:async()=>null},client:{storageKey:'synthetic-approved-session',async beginExplicit(){qa.status='connecting';return current()},async restore(){return current()},async handleReturn(){assert.equal(qa.status,'connecting');if(qa.reject){qa.status='disconnected';return current()};const response=await request(qa,'/test/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account,scopes:config.scopes})});assert.equal(response.status,200);qa.session=await response.json();qa.status='connected';return current()},async disconnect(){qa.status='disconnected';const response=await request(qa,'/test/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account})});assert.equal(response.status,200);return current()}},async createIntrospectionProof(requiredScopes){assert.equal(qa.status,'connected');assert.ok(requiredScopes.every(scope=>qa.session.scopes.includes(scope)));const proof={...qa.session,requiredScopes,proofNonce:String(++qa.proofCounter)};qa.lastProof={proof,proofHeader:Buffer.from(JSON.stringify(proof)).toString('base64url')};return qa.lastProof}};
  }});
  qa.api=new SocialAPI(endpoint);
  qa.identity=async()=>{const response=await request(qa,'/sso/account');assert.equal(response.status,200);return response.json()};
  qa.outbox=new DurableOutbox({read:key=>qa.slots.get(key)??null,write:(key,value)=>qa.slots.set(key,value),remove:key=>qa.slots.delete(key)});
  qa.cold=()=>new SocialWorkspace(qa.client,qa.api,qa.devices,qa.outbox,qa.identity,()=>{});
  qa.workspace=qa.cold();return qa;
}
async function signIn(qa){const start=await request(qa,'/sso/start?target=conversations');assert.equal(start.status,303);const state=new URL(start.headers.get('Location')).searchParams.get('state');const callback=await request(qa,`/sso/callback?state=${encodeURIComponent(state)}&code=${qa.code.repeat(43)}`);assert.equal(callback.status,303);assert.equal((await qa.identity()).account,qa.account)}
async function authorize(qa){await qa.workspace.authorize();await qa.workspace.accept(origin+'/wallet-auth/callback?state=synthetic-approved-only')}
const a=makeQA(process.env.SOCIAL_JOURNEY_ACCOUNT_A,'a'),b=makeQA(process.env.SOCIAL_JOURNEY_ACCOUNT_B,'b');
try{
  await signIn(a);await signIn(b);
  // Explicit rejection creates no private actor or chat secret carrier.
  a.reject=true;await a.workspace.authorize();await assert.rejects(a.workspace.accept(origin+'/wallet-auth/callback?state=synthetic-rejected'),/explicit approval/);assert.equal(a.records.size,0);assert.equal(a.workspace.current.account,undefined);a.reject=false;
  await authorize(a);await authorize(b);
  for(const qa of [a,b]){assert.equal(qa.workspace.current.needsProfileSetup,true);assert.deepEqual(qa.workspace.current.contacts,[]);assert.deepEqual(qa.workspace.current.requests,[]);assert.deepEqual(qa.workspace.current.conversations,[])}
  await a.workspace.updateProfile({handle:'qa_alice',displayName:'QA Alice',bio:'First QA profile'});
  await b.workspace.updateProfile({handle:'qa_bob',displayName:'QA Bob',bio:'Second QA profile'});
  await a.workspace.requestContact('qa_bob');await b.workspace.refresh();
  let incoming=b.workspace.current.requests.find(item=>item.direction==='incoming'&&item.status==='pending');assert.ok(incoming);await b.workspace.transitionContact(incoming.id,'reject');await a.workspace.refresh();assert.equal(a.workspace.current.contacts.length,0);await assert.rejects(a.workspace.createConversation('qa_bob'),/accept/);
  await a.workspace.requestContact('qa_bob');let outgoing=a.workspace.current.requests.find(item=>item.direction==='outgoing'&&item.status==='pending');assert.ok(outgoing);await a.workspace.transitionContact(outgoing.id,'withdraw');await b.workspace.refresh();assert.equal(b.workspace.current.requests.filter(item=>item.status==='pending').length,0);
  await a.workspace.requestContact('qa_bob');await b.workspace.refresh();incoming=b.workspace.current.requests.find(item=>item.direction==='incoming'&&item.status==='pending');assert.ok(incoming);await b.workspace.transitionContact(incoming.id,'accept');await a.workspace.refresh();assert.equal(a.workspace.current.contacts[0].handle,'qa_bob');assert.equal(b.workspace.current.contacts[0].handle,'qa_alice');
  await a.workspace.createConversation('qa_bob');const conversation=a.workspace.current.conversationId;assert.ok(conversation);
  await a.workspace.send('First encrypted message from an empty QA journey');assert.equal(a.outbox.read().length,0);await b.workspace.refresh();assert.equal(b.workspace.current.conversations.length,1);await b.workspace.select(conversation);assert.equal(b.workspace.current.messages[0].plaintext,'First encrypted message from an empty QA journey');
  // Cold controller/crypto-key structured clone retains the original device/history.
  const previous=await b.devices.get(b.account,false),protectedBytes=Buffer.from(b.records.get(b.account).ciphertext).toString('hex');b.workspace=b.cold();await b.workspace.restore();await b.workspace.select(conversation);assert.equal(b.workspace.current.messages[0].plaintext,'First encrypted message from an empty QA journey');assert.deepEqual(await b.devices.get(b.account,false),previous);
  const identity=await b.identity(),oldProof=b.lastProof;await b.workspace.logout();assert.equal(b.workspace.current.account,undefined);await assert.rejects(b.workspace.restore(),/explicit approval/);
  const denied=await request(b,'/social/v1/conversations',{headers:{'X-YNX-Product-Session-Proof-V2':oldProof.proofHeader}});assert.equal(denied.status,401);
  const logout=await request(b,'/sso/logout',{method:'POST',headers:{'X-YNX-SSO-CSRF':identity.csrfToken}});assert.equal(logout.status,200);assert.equal((await request(b,'/sso/account')).status,401);assert.equal(Buffer.from(b.records.get(b.account).ciphertext).toString('hex'),protectedBytes);
  // A new explicit sign-in/approval reuses keys; it never resurrects old authority.
  await signIn(b);await authorize(b);await b.workspace.select(conversation);assert.equal(b.workspace.current.messages[0].plaintext,'First encrypted message from an empty QA journey');assert.deepEqual(await b.devices.get(b.account,false),previous);assert.equal(Buffer.from(b.records.get(b.account).ciphertext).toString('hex'),protectedBytes);
  process.stdout.write('PASS empty QA: explicit consent, profiles, reject, withdraw, accept, conversation, original encrypted send/read, cold restore, revoke, explicit reapproval\n');
}finally{globalThis.fetch=realFetch}

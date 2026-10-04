import {createBoundedOperation} from './bounded-operation.mjs';
import {validMatrixUserId} from './login.mjs';

const socialID=/^sp_[A-Za-z0-9_-]{32}$/;
const accountID=/^ynx1[0-9a-z]{38}$/;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};

export function acceptedContactProfiles(value){
 const contacts=value?.contacts;
 if(!Array.isArray(contacts)||contacts.length>10000)fail('MATRIX_CONTACTS_INVALID','Accepted contacts could not be verified');
 const seen=new Set();
 return Object.freeze(contacts.map(person=>{
  const {id,handle,displayName}=person??{};
  if(typeof id!=='string'||!socialID.test(id)||seen.has(id)||typeof handle!=='string'||typeof displayName!=='string'||handle.length>256||displayName.length>256)fail('MATRIX_CONTACTS_INVALID','Accepted contact identity could not be verified');
  seen.add(id);return Object.freeze({id,handle,displayName});
 }));
}

export function checkedContactBinding(value,personId){
 const {protocol,person,account,userId,serverName,homeserver}=value??{};
 if(typeof personId!=='string'||!socialID.test(personId)||protocol!=='ynx-social-matrix-peer/v1'||person!==personId||typeof account!=='string'||!accountID.test(account)||typeof userId!=='string'||typeof serverName!=='string'||!validMatrixUserId(userId,serverName)||typeof homeserver!=='string')fail('MATRIX_PEER_BINDING_REQUIRED','The selected contact has no matching existing chat identity');
 let url;try{url=new URL(homeserver)}catch{fail('MATRIX_PEER_BINDING_REQUIRED','The selected contact has no matching existing chat identity')}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)fail('MATRIX_PEER_BINDING_REQUIRED','The contact chat service could not be verified');
 return Object.freeze({protocol,person,account,userId,serverName,homeserver:url.href});
}

// All data is read through the existing approved browser session. No wallet
// request, device provisioning, new identity, grants or replacement keys.
export function createContactChat({identity,proof,guard,open,fetcher=globalThis.fetch}){
 let sequence=0;
 async function run(view,options,action){
  const bounded=createBoundedOperation({signal:options?.signal});
  const check=()=>{bounded.guard();guard(view);options?.assertCurrent?.()};
  const wait=async task=>{check();const result=await bounded.wait(task);check();return result};
  async function read(path,scopes){
   const verified=await wait(()=>identity(view));
   const authorization=await wait(()=>proof(scopes));
   const headers={'Accept':'application/json','X-YNX-Product-Session-Proof-V2':authorization.proofHeader};
   if(verified.csrfToken)headers['X-YNX-SSO-CSRF']=verified.csrfToken;
   const response=await wait(()=>fetcher(path,{credentials:'same-origin',cache:'no-store',redirect:'error',headers,signal:bounded.controller.signal}));
   if(!response.ok)fail([401,403].includes(response.status)?'MATRIX_CONTACT_PERMISSION_REQUIRED':'MATRIX_CONTACTS_UNAVAILABLE',response.status===409?'This contact needs their existing Matrix identity mapping. No new account was created.':'Current contacts or chat permissions could not be verified. Retry explicitly.');
   const result=await wait(()=>response.json());
   await wait(()=>identity(view));return result;
  }
  try{return await action({read,wait,check})}finally{bounded.dispose()}
 }
 return Object.freeze({
  cancel(){sequence++},
  async verifyPeer(userId,view,options){
   const split=typeof userId==='string'?userId.indexOf(':'):-1;
   if(split<0||!validMatrixUserId(userId,userId.slice(split+1)))fail('MATRIX_PEER_BINDING_REQUIRED','An existing conversation participant is required');
   return run(view,options,async({read,check})=>{
    const value=await read('/social/v3/matrix/peer?userId='+encodeURIComponent(userId),['social.contacts','social.messaging']);
    const binding=checkedContactBinding(value,value.person);
    if(binding.userId!==userId)fail('MATRIX_PEER_BINDING_REQUIRED','The existing conversation participant changed');
    const current=acceptedContactProfiles(await read('/social/v1/contacts',['social.contacts']));check();
    if(!current.some(person=>person.id===binding.person))fail('MATRIX_CONTACT_NO_LONGER_ACCEPTED','This conversation no longer has an accepted contact relationship. Original encrypted history is retained.');
    return binding;
   });
  },
  async load(view,options){
   const intent=++sequence;
   return run(view,options,async({read,check})=>{
    const profiles=acceptedContactProfiles(await read('/social/v1/contacts',['social.contacts']));
    check();if(intent!==sequence)fail('UI_STALE_VIEW','Previous contact selection was discarded');return profiles;
   });
  },
  async start(personId,view,options){
   if(typeof personId!=='string'||!socialID.test(personId))fail('MATRIX_CONTACT_SELECTION_REQUIRED','Choose an accepted contact first');
   const intent=++sequence;
   return run(view,options,async({read,wait,check})=>{
    const current=()=>{check();if(intent!==sequence)fail('UI_STALE_VIEW','Previous contact selection was discarded')};
    const profiles=acceptedContactProfiles(await read('/social/v1/contacts',['social.contacts']));current();
    const person=profiles.find(item=>item.id===personId);
    if(!person)fail('MATRIX_CONTACT_NO_LONGER_ACCEPTED','This person is no longer an accepted contact. Review your contacts before starting a chat.');
    const binding=checkedContactBinding(await read('/social/v3/matrix/peer?person='+encodeURIComponent(personId),['social.contacts','social.messaging']),personId);current();
    // A profile preview or old selection is not authorization. Recheck the
    // accepted relationship immediately before touching the mature transport.
    const final=acceptedContactProfiles(await read('/social/v1/contacts',['social.contacts']));current();
    if(!final.some(item=>item.id===personId))fail('MATRIX_CONTACT_NO_LONGER_ACCEPTED','The contact relationship changed. No conversation was started.');
    const room=await wait(()=>open(binding,{assertCurrent:current,signal:options?.signal}));current();
    return Object.freeze({room,person,binding});
   });
  }
 });
}

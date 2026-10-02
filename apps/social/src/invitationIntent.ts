import type {InvitationSnapshot} from './api';
export type InvitationIntent=Readonly<{schemaVersion:1;account:string;key:string;ttlSeconds:86400}>;
export interface InvitationIntentStore{
 load(account:string):Promise<InvitationIntent|null>;
 reserve(candidate:InvitationIntent,guard:()=>void,signal?:AbortSignal):Promise<InvitationIntent>;
 clear(account:string,key:string,guard:()=>void,signal?:AbortSignal):Promise<boolean>;
}
export function checkedInvitationIntent(value:unknown,account:string):InvitationIntent{
 const record=value as InvitationIntent;
 if(!/^ynx1[0-9a-z]{38}$/.test(account)||!record||Object.keys(record).sort().join(',')!=='account,key,schemaVersion,ttlSeconds'||record.schemaVersion!==1||record.account!==account||record.ttlSeconds!==86400||typeof record.key!=='string'||!/^invitation-[a-f0-9]{24}$/.test(record.key))throw new Error('Original invitation intent requires storage recovery; no replacement was created');
 return Object.freeze({...record});
}
export function checkedInvitationSnapshot(value:unknown):InvitationSnapshot{
 const result=value as InvitationSnapshot;
 if(!result||!Array.isArray(result.invitations)||result.invitations.length>10000)throw new Error('Invitation readback could not be verified');
 const seen=new Set<string>();
 const invitations=result.invitations.map(record=>{
  if(!record||!/^invite_[a-f0-9]{24}$/.test(record.id)||seen.has(record.id)||typeof record.link!=='string'||!/^https:\/\/social\.ynxweb4\.com\/invite\/[A-Za-z0-9_-]{32}$/.test(record.link)||!['active','expired','revoked'].includes(record.status)||!Number.isFinite(Date.parse(record.expiresAt))||!Number.isFinite(Date.parse(record.createdAt)))throw new Error('Invitation identity, route or status could not be verified');
  if(record.revokedAt!==undefined&&!Number.isFinite(Date.parse(record.revokedAt))||record.status==='revoked'&&!record.revokedAt||record.revokedAt&&record.status!=='revoked')throw new Error('Invitation revocation readback could not be verified');
  seen.add(record.id);return Object.freeze({...record});
 });
 if(result.operation&&(typeof result.operation.confirmed!=='boolean'||result.operation.confirmed&&!invitations.some(record=>record.id===result.operation!.id)||!result.operation.confirmed&&result.operation.id!==undefined))throw new Error('Original invitation operation was not confirmed');
 return Object.freeze({invitations,operation:result.operation?Object.freeze({...result.operation}):undefined});
}

// Stores only an account-bound request nonce, not invitation capabilities,
// keys, contact graph, scopes or receipts. Transactions coalesce same-account
// retries across tabs; originals are never replaced or wiped on failure.
export function indexedDBInvitationIntents(factory:IDBFactory=globalThis.indexedDB):InvitationIntentStore{
 const open=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  if(!factory){reject(new Error('Durable invitation storage is unavailable'));return}
  const request=factory.open('ynx-social-invitation-intents-v1',1);let settled=false;
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('pending'))request.result.createObjectStore('pending')};
  request.onerror=()=>{settled=true;reject(new Error('Original invitation storage could not be opened'))};
  request.onblocked=()=>{settled=true;reject(new Error('Original invitation storage is busy; no reset or replacement was made'))};
  request.onsuccess=()=>{if(settled){request.result.close();return}settled=true;resolve(request.result)};
 });
 async function access<T>(account:string,mode:IDBTransactionMode,operation:(current:unknown,store:IDBObjectStore)=>T,guard=()=>{},signal?:AbortSignal):Promise<T>{
  if(!/^ynx1[0-9a-z]{38}$/.test(account))throw new Error('Original invitation account is required');
  guard();if(signal?.aborted)throw new Error('Invitation operation cancelled');const database=await open();
  return new Promise<T>((resolve,reject)=>{
   let result:T,failure:unknown,transaction:IDBTransaction;
   try{guard();if(signal?.aborted)throw new Error('Invitation operation cancelled');transaction=database.transaction('pending',mode)}catch(error){database.close();reject(error);return}
   const abort=()=>{failure=new Error('Invitation operation cancelled; original intent retained');try{transaction.abort()}catch{}};
   signal?.addEventListener('abort',abort,{once:true});
   const close=()=>{signal?.removeEventListener('abort',abort);database.close()};
   transaction.onabort=transaction.onerror=()=>{close();reject(failure??new Error('Original invitation transaction failed; no replacement was made'))};
   transaction.oncomplete=()=>{close();try{guard();resolve(result)}catch(error){reject(error)}};
   const store=transaction.objectStore('pending'),request=store.get(account);
   request.onsuccess=()=>{try{guard();if(signal?.aborted)throw new Error('Invitation operation cancelled');result=operation(request.result,store)}catch(error){failure=error;transaction.abort()}};
   request.onerror=()=>{failure=new Error('Original invitation could not be read')};
  });
 }
 return {
  load:account=>access(account,'readonly',value=>value===undefined?null:checkedInvitationIntent(value,account)),
  reserve:(candidate,guard,signal)=>{candidate=checkedInvitationIntent(candidate,candidate.account);return access(candidate.account,'readwrite',(value,store)=>{if(value!==undefined)return checkedInvitationIntent(value,candidate.account);store.put(candidate,candidate.account);return candidate},guard,signal)},
  clear:(account,key,guard,signal)=>access(account,'readwrite',(value,store)=>{if(value===undefined)return false;const original=checkedInvitationIntent(value,account);if(original.key!==key)throw new Error('A different original invitation intent was retained');store.delete(account);return true},guard,signal)
 };
}

import {
  createApplicationActionRequest, parseApplicationActionRequest, applicationActionRequestDigest,
  encodeApplicationActionWalletURL, parseApplicationActionReturnURL, applicationActionHash,
  verifySignedApplicationAction, type NativeAction, type NativePayload, type NativeRequest,
} from './vendor/application-actions-browser.mjs';
import registry from './vendor/native-action-registry.json';
import { nativeLedgerAddress, parseNativeSnapshot } from './native-snapshot';

const ORIGIN='https://dex.ynxweb4.com';
const SDK='ff5b7d49dd515d31d567c352dd049ac7b79d4139';
const DB='ynx.dex.native-action.ff5b7d49.v1';
export type NativeDraft={version:1;sdk:typeof SDK;request:NativeRequest;digest:string;snapshotId:string;status:'pending'|'approved'|'rejected';signed:string|null;transactionHash:string|null};
type Draft=NativeDraft;
export interface NativeJournalStore {
  /** Must run synchronously inside one durable transaction; null deletes only this key. */
  update(key:string,change:(value:string|null)=>string|null):Promise<string|null>;
}
export class NativeActionJournalError extends Error {
  constructor(public code:string){super(code);}
}
function fail(code:string):never {throw new NativeActionJournalError(code);}
function requireOrigin(){if(globalThis.location?.origin!==ORIGIN)fail('NATIVE_ACTION_ORIGIN_UNAVAILABLE');}
function key(account:string){nativeLedgerAddress(account);return `${SDK}:${account}`;}
function unpack(raw:string,account:string):Draft {
  if(raw.length>48*1024)fail('NATIVE_DRAFT_INVALID');
  let value:Draft;try{value=JSON.parse(raw);}catch{fail('NATIVE_DRAFT_INVALID');}
  const fields=['version','sdk','request','digest','snapshotId','status','signed','transactionHash'];
  if(!value||typeof value!=='object'||Object.keys(value).sort().join()!==fields.sort().join()||value.version!==1||value.sdk!==SDK||!/^sha256:[0-9a-f]{64}$/.test(value.snapshotId))fail('NATIVE_DRAFT_INVALID');
  // Historical intent/signature must remain inspectable after expiry. Only the
  // launch and first callback use current time; expired intent never relaunches.
  const request=parseApplicationActionRequest(registry,value.request,new Date(value.request?.issuedAt));
  if(request.account!==account||request.origin!==ORIGIN||request.platform!=='web'||applicationActionRequestDigest(request)!==value.digest)fail('NATIVE_DRAFT_BINDING_MISMATCH');
  if(value.status==='approved'){
    if(typeof value.signed!=='string')fail('NATIVE_DRAFT_INVALID');
    verifySignedApplicationAction(value.signed,{account,action:request.action,payload:request.payload,nonce:request.nonce});
    if(applicationActionHash(value.signed)!==value.transactionHash)fail('NATIVE_DRAFT_BINDING_MISMATCH');
  }else if(!['pending','rejected'].includes(value.status)||value.signed!==null||value.transactionHash!==null)fail('NATIVE_DRAFT_INVALID');
  return {...value,request};
}
function readonlyDraft(draft:Draft){return Object.freeze({...draft,request:Object.freeze({...draft.request,payload:Object.freeze({...draft.request.payload})})});}

/** Product intent journal, not a signer, session, broadcaster or second SDK.
 * No fetch, provider request, navigation, key access, or automatic submission.
 * One unresolved intent per native account prevents a reload/second tab from
 * silently choosing a fresh nonce. Storage namespace never reads legacy keys.
 */
export function createNativeActionJournal(store:NativeJournalStore){
  async function read(account:string){
    requireOrigin();const raw=await store.update(key(account),value=>value);
    return raw===null?null:readonlyDraft(unpack(raw,account));
  }
  return Object.freeze({
    read,
    async prepare(input:{account:string;action:NativeAction;payload:NativePayload;snapshot:unknown}){
      const names=['account','action','payload','snapshot'];
      const descriptors=Object.getOwnPropertyDescriptors(input);
      if(Reflect.ownKeys(input).length!==names.length||names.some(name=>!descriptors[name]?.enumerable||!Object.hasOwn(descriptors[name],'value')))fail('NATIVE_REVIEW_INVALID');
      input=Object.fromEntries(names.map(name=>[name,descriptors[name].value])) as typeof input;
      requireOrigin();const now=new Date(),snapshot=parseNativeSnapshot(input.snapshot,input.account,now.getTime());
      if(now.getTime()-Date.parse(snapshot.asOf)>15_000||Date.parse(snapshot.asOf)>now.getTime())fail('NATIVE_REVIEW_SNAPSHOT_STALE');
      const pool=snapshot.pools.find(pool=>pool.id===input.payload.poolId);
      if(!pool)fail('NATIVE_REVIEW_POOL_MISMATCH');
      const asset=input.action==='dex_swap_exact_input'?input.payload.assetIn:input.action==='dex_swap_exact_output'?input.payload.assetOut:null;
      if(asset!==null&&asset!==pool.asset0&&asset!==pool.asset1)fail('NATIVE_REVIEW_ASSET_MISMATCH');
      const nonceText=snapshot.account?.nextNonce;
      if(nonceText===null||nonceText===undefined||BigInt(nonceText)>BigInt(Number.MAX_SAFE_INTEGER))fail('NATIVE_NONCE_UNSUPPORTED');
      const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
      const request=createApplicationActionRequest(registry,{productId:'dex',platform:'web',account:input.account,action:input.action,payload:input.payload,nonce:Number(nonceText),requestId:crypto.randomUUID(),state},now);
      const draft:Draft={version:1,sdk:SDK,request,digest:applicationActionRequestDigest(request),snapshotId:snapshot.snapshotId,status:'pending',signed:null,transactionHash:null};
      const serialized=JSON.stringify(draft);
      const saved=await store.update(key(input.account),existing=>{if(existing!==null)fail('NATIVE_INTENT_ALREADY_EXISTS');return serialized;});
      if(saved!==serialized)fail('NATIVE_DRAFT_PERSISTENCE_FAILED');
      // The request is returned only after transaction commit, never a URL.
      return readonlyDraft(unpack(saved,input.account));
    },
    async walletURL(account:string,expectedDigest:string){
      const draft=await read(account);
      if(!draft||draft.digest!==expectedDigest||draft.status!=='pending')fail('NATIVE_DRAFT_SUPERSEDED');
      return encodeApplicationActionWalletURL(registry,draft.request);
    },
    async acceptReturn(account:string,fullURL:string){
      requireOrigin();
      const saved=await store.update(key(account),raw=>{
        if(raw===null)fail('NATIVE_PENDING_REQUIRED');
        const draft=unpack(raw,account);
        const result=parseApplicationActionReturnURL(registry,fullURL,draft.request,draft.status==='pending'?new Date():new Date(draft.request.issuedAt));
        if(draft.status!=='pending'){
          if(result.status!==draft.status||(result.status==='approved'&&result.signed!==draft.signed))fail('NATIVE_CALLBACK_ALREADY_CONSUMED');
          return raw; // exact duplicate is idempotent, never broadcasts.
        }
        return JSON.stringify({...draft,status:result.status,signed:result.status==='approved'?result.signed:null,transactionHash:result.status==='approved'?applicationActionHash(result.signed):null});
      });
      if(saved===null)fail('NATIVE_DRAFT_PERSISTENCE_FAILED');
      return readonlyDraft(unpack(saved,account));
    },
    async discardUnsigned(account:string,expectedDigest:string){
      requireOrigin();await store.update(key(account),raw=>{
        if(raw===null)return null;const draft=unpack(raw,account);
        if(draft.digest!==expectedDigest)fail('NATIVE_DRAFT_SUPERSEDED');
        // Signed bytes/hash remain for receipt lookup. Losing HTTP acknowledgement
        // can never cause replacement by a newly signed nonce in this adapter.
        if(draft.status==='approved')fail('NATIVE_SIGNED_INTENT_MUST_BE_RETAINED');
        return null;
      });
    },
  });
}

/** IDB supplies cross-tab serializability and restart persistence. The journal
 * stores public intent/signature bytes only, never account or device secrets.
 * No memory/localStorage fallback when durable storage is blocked.
 */
export function openNativeActionStore():Promise<NativeJournalStore & {close():void}>{
  // Storage alone confers no authority; every journal operation separately
  // requires the registered product origin. This permits real localhost IDB QA
  // without impersonating or requesting the production domain.
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return reject(new NativeActionJournalError('NATIVE_DURABLE_STORAGE_UNAVAILABLE'));
    let blocked=false;
    const opening=indexedDB.open(DB,1);
    opening.onupgradeneeded=()=>opening.result.createObjectStore('intents');
    opening.onerror=()=>reject(new NativeActionJournalError('NATIVE_DURABLE_STORAGE_UNAVAILABLE'));
    opening.onblocked=()=>{blocked=true;reject(new NativeActionJournalError('NATIVE_DURABLE_STORAGE_BLOCKED'));};
    opening.onsuccess=()=>{
      const db=opening.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();
      resolve({close:()=>db.close(),update:(entry,change)=>new Promise((done,failed)=>{
        let result:string|null=null,cause:unknown;
        const tx=db.transaction('intents','readwrite',{durability:'strict'}),objects=tx.objectStore('intents'),get=objects.get(entry);
        get.onsuccess=()=>{
          try{
            const current=get.result===undefined?null:get.result;
            if(current!==null&&typeof current!=='string')fail('NATIVE_DRAFT_INVALID');
            result=change(current);
            if(result!==null&&(typeof result!=='string'||result.length>48*1024))fail('NATIVE_DRAFT_INVALID');
            if(result!==current){if(result===null)objects.delete(entry);else objects.put(result,entry);}
          }catch(error){cause=error;tx.abort();}
        };
        tx.oncomplete=()=>done(result);
        tx.onerror=tx.onabort=()=>failed(cause??new NativeActionJournalError('NATIVE_DRAFT_PERSISTENCE_FAILED'));
      })});
    };
  });
}

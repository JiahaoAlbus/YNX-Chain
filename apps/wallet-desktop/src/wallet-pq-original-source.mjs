import {types} from 'node:util';
import {exactData} from './features/pq-transaction/transfer-binding.mjs';
import {preparePQHostCatalogBinding} from './wallet-pq-host-selection.mjs';
// Fixed original Auth facade, lazily loaded only for proof-source acquisition.
// No configurable loader, fallback image, ENV, renderer path or role flag.
const loadOriginalPQHostCatalogSource=()=>import('../../../packages/wallet-auth/src/original-pq-host-catalog-source.js');
const fail=code=>{throw Object.assign(Error(code),{code});};
const names=['acquireOriginalPQHostCatalogSource','isOriginalPQHostCatalogSource','readOriginalPQHostCatalogHandoff','assertOriginalPQHostCatalogSourceCurrent','observeOriginalPQHostCatalogSourceRevocation','retireOriginalPQHostCatalogSource','joinOriginalPQHostCatalogSource','closeOriginalPQHostCatalogSource','readOriginalPQHostCatalogSourceStatus'];
/** Private normal Main consumer. The original Auth resource alone owns source
 * qualification and the independently pinned new Protocol callee. The returned
 * receipt is DATA; no Native object, FD or authorization crosses IPC/storage.
 */
export function createOriginalPQHostSource({original,binding,receiver}){
 const journal=preparePQHostCatalogBinding(original,binding);
 let methods=null,owner=null,entered=false,active=false,retired=false,closed=false,unknown=false,pair=null,work=null,identity=null,readEntered=false;
 let firstCause,firstPresent=false,cleanupCause,cleanupPresent=false;
 const remember=cause=>{if(!firstPresent){firstPresent=true;firstCause=cause;}};
 const cleanup=cause=>{if(!cleanupPresent){cleanupPresent=true;cleanupCause=cause;}};
 function recognized(){if(!owner||!methods||methods.isOriginalPQHostCatalogSource(owner)!==true)fail('PQ_HOST_ORIGINAL_SOURCE_OWNER_REQUIRED');}
 function current(guard){
  guard.assert();if(guard.account!==journal.account)fail('PQ_HOST_CONTEXT_MISMATCH');
  if(retired||closed||unknown)fail('PQ_HOST_ORIGINAL_SOURCE_RETIRED');recognized();
  try{
   if(methods.assertOriginalPQHostCatalogSourceCurrent(owner,journal)!==undefined)fail('PQ_HOST_ORIGINAL_SOURCE_CURRENT_INVALID');
   const seen=methods.observeOriginalPQHostCatalogSourceRevocation(owner);
   if(types.isProxy(seen))fail('PQ_HOST_ORIGINAL_SOURCE_CURRENT_INVALID');
   exactData(seen,['version','sourceId','instanceId','retired','revoked','current','unknown','dataOnly','authorized'],'PQ_HOST_ORIGINAL_SOURCE_CURRENT_INVALID');
   if(seen.version!=='YNX-PQ-HOST-CATALOG-SOURCE-OBSERVATION/v1'||typeof seen.sourceId!=='string'||!seen.sourceId||seen.sourceId.length>256||typeof seen.instanceId!=='string'||!seen.instanceId||seen.instanceId.length>256||seen.retired!==false||seen.revoked!==false||seen.current!==true||seen.unknown!==false||seen.dataOnly!==true||seen.authorized!==false)fail('PQ_HOST_ORIGINAL_SOURCE_CURRENT_INVALID');
   if(identity&&(identity.sourceId!==seen.sourceId||identity.instanceId!==seen.instanceId))fail('PQ_HOST_ORIGINAL_SOURCE_CURRENT_INVALID');
   identity??=Object.freeze({sourceId:seen.sourceId,instanceId:seen.instanceId});
   guard.assert();if(retired||closed)fail('PQ_HOST_ORIGINAL_SOURCE_RETIRED');
  }catch(cause){unknown=true;remember(cause);throw cause;}
 }
 const api=Object.freeze({
  async acquire(guard){
   if(entered)fail('PQ_HOST_ORIGINAL_SOURCE_ALREADY_ENTERED');entered=true;active=true;
   const job=(async()=>{
    try{
     guard.assert();if(guard.account!==journal.account||retired)fail('PQ_HOST_CONTEXT_MISMATCH');
     const native=await loadOriginalPQHostCatalogSource();
     if(names.some(name=>typeof native[name]!=='function'))fail('PQ_HOST_ORIGINAL_SOURCE_NOT_SUPPLIED');
     methods=Object.freeze(Object.fromEntries(names.map(name=>[name,native[name]])));
     guard.assert();if(retired)fail('PQ_HOST_ORIGINAL_SOURCE_RETIRED');
     // Capture actual partial custody before any status/current assertion.
     try{owner=methods.acquireOriginalPQHostCatalogSource();}
     catch(cause){const d=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'partial'):null;if(d&&Object.hasOwn(d,'value'))owner=d.value;throw cause;}
     recognized();current(guard);
     readEntered=true;const returned=await methods.readOriginalPQHostCatalogHandoff(owner,journal);
     // Preserve the original result even when lock/revocation arrived while the
     // registrar was completing. Retention is DATA, never a revived Host lease.
     if(types.isProxy(returned))fail('PQ_HOST_ORIGINAL_SOURCE_RECEIPT_INVALID');
     exactData(returned,['catalogPath','catalogSha256'],'PQ_HOST_ORIGINAL_SOURCE_RECEIPT_INVALID');
     pair=Object.freeze({...returned});receiver.receive(journal,pair);
     current(guard);const saved=receiver.select(journal);
     if(saved.catalogPath!==pair.catalogPath||saved.catalogSha256!==pair.catalogSha256)fail('PQ_HOST_REGISTRATION_CONFLICT');
     return undefined;
    }catch(cause){retired=true;if(readEntered&&!pair)unknown=true;remember(cause);throw cause;}finally{active=false;}
   })();work=job;return job;
  },
  assertCurrent:current,
  catalog(){if(active||!pair||unknown||retired||closed)fail('PQ_HOST_ORIGINAL_SOURCE_NOT_CURRENT');return receiver.select(journal);},
  retire(){
   if(closed)return;
   retired=true;
   if(owner&&methods)try{recognized();if(methods.retireOriginalPQHostCatalogSource(owner)!==undefined)fail('PQ_HOST_ORIGINAL_SOURCE_RETIRE_INCOMPLETE');}catch(cause){cleanup(cause);}
  },
  async join(){
   await work?.catch(()=>{});
   if(closed)return;
   try{if(owner){recognized();if(methods.joinOriginalPQHostCatalogSource(owner)!==undefined)fail('PQ_HOST_ORIGINAL_SOURCE_JOIN_INCOMPLETE');}}catch(cause){cleanup(cause);throw cause;}
  },
  async close(){
   if(closed)return;
   try{api.retire();await api.join();
    if(owner){recognized();if(methods.closeOriginalPQHostCatalogSource(owner)!==undefined)fail('PQ_HOST_ORIGINAL_SOURCE_CLOSE_INCOMPLETE');}
    if(cleanupPresent)throw cleanupCause;closed=true;
   }catch(cause){cleanup(cause);throw cause;}
  },
  // Explicit saving is only same-byte receiver reconciliation. No second
  // acquisition/registration/current/signature or transaction is performed.
  save(guard){guard.assert();if(guard.account!==journal.account||active)fail('PQ_HOST_CONTEXT_MISMATCH');if(readEntered&&!pair)fail('PQ_HOST_ORIGINAL_SOURCE_OUTCOME_UNKNOWN');if(receiver.pending())receiver.reconcile();receiver.assertSafeToClose();return Object.freeze({saved:true,nativeGrant:false,canRetry:false});},
  assertSafeToClose(){if(active||entered&&!closed||readEntered&&!pair)fail('PQ_HOST_ORIGINAL_SOURCE_UNCONFIRMED');receiver.assertSafeToClose();},
  status:()=>Object.freeze({entered,active,retired,closed,unknown,heldResult:pair!==null,firstCausePresent:firstPresent,cleanupCausePresent:cleanupPresent,nativeGrant:false})
 });return api;
}

const DATABASE='ynx-finance-endpoint-authority-v2';
const STORE='checkpoint';
const KEY='state';
const MARKER='ynx.finance.endpoint-authority-v2.initialized';
const SCHEMA='ynx-finance-endpoint-authority-checkpoint/v1';
const canonical=value=>`${value?.rootVersion}:${value?.sequence}:${value?.payloadSha256}`;
const clone=value=>structuredClone(value);
function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error('FINANCE_AUTHORITY_V2_INDEXEDDB'));});}
function transactionDone(transaction){return new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error??new Error('FINANCE_AUTHORITY_V2_INDEXEDDB'));transaction.onabort=()=>reject(transaction.error??new Error('FINANCE_AUTHORITY_V2_INDEXEDDB_ABORT'));});}
function openDatabase(indexedDB){return new Promise((resolve,reject)=>{const request=indexedDB.open(DATABASE,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??new Error('FINANCE_AUTHORITY_V2_INDEXEDDB'));request.onblocked=()=>reject(new Error('FINANCE_AUTHORITY_V2_INDEXEDDB_BLOCKED'));});}
function assertClock(clock,highWater=0){const value=clock();if(!Number.isSafeInteger(value)||value<0)throw new Error('AUTHORITY_V2_CLOCK_REQUIRED');if(value<highWater)throw new Error('AUTHORITY_V2_CLOCK_ROLLBACK');return value;}
export function createBrowserAuthorityCheckpointStore({indexedDB=globalThis.indexedDB,localStorage=globalThis.localStorage,anchor,clock,onCommit=()=>{}}={}){
  if(!indexedDB||!localStorage||typeof clock!=='function')throw new Error('AUTHORITY_V2_DURABLE_STORAGE_REQUIRED');
  let database;async function db(){if(!database)database=await openDatabase(indexedDB);return database;}
  async function state(mode='readonly'){const connection=await db(),transaction=connection.transaction(STORE,mode),store=transaction.objectStore(STORE),value=await requestResult(store.get(KEY));return {transaction,store,value};}
  return Object.freeze({
    async read(){const {transaction,value}=await state();await transactionDone(transaction);if(!value){if(localStorage.getItem(MARKER)==='yes')throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_LOST');assertClock(clock);return clone(anchor);}if(value.schemaVersion!==SCHEMA)throw new Error('FINANCE_AUTHORITY_V2_CHECKPOINT_INVALID');assertClock(clock,value.trustedClockHighWaterMs);return clone(value.checkpoint);},
    async compareAndSwap(previous,next){const {transaction,store,value}=await state('readwrite'),actual=value?.checkpoint??anchor,at=assertClock(clock,value?.trustedClockHighWaterMs??0);if(canonical(actual)!==canonical(previous)){transaction.abort();try{await transactionDone(transaction);}catch{}return false;}try{localStorage.setItem(MARKER,'yes');}catch(error){transaction.abort();try{await transactionDone(transaction);}catch{}throw error;}store.put({schemaVersion:SCHEMA,checkpoint:clone(next),trustedClockHighWaterMs:at},KEY);await transactionDone(transaction);if(canonical(previous)!==canonical(next))onCommit(clone(next));return true;},
    close(){database?.close();database=undefined;},
  });
}
export const FINANCE_AUTHORITY_CHECKPOINT_MARKER=MARKER;

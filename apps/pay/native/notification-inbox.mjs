import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const fail=code=>{throw Object.assign(Error(code),{code});};
const applicationId=0x594e504e;
const checkCurrent=current=>{if(typeof current!=='function'||current()!==undefined)fail('NATIVE_PAY_NOTIFICATION_SCOPE_UNAVAILABLE');};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
function scopeKey(scope){
 if(!scope||!hex(scope.genesis)||!hex(scope.bindingDigest)||!['source','principal'].every(k=>typeof scope[k]==='string'&&scope[k].length>0&&scope[k].length<=256&&scope[k].trim()===scope[k]&&!/[\u0000-\u001f]/.test(scope[k])))fail('NATIVE_PAY_NOTIFICATION_SCOPE_UNAVAILABLE');
 return hash([scope.source,scope.principal,scope.genesis,scope.bindingDigest]);
}
function reference(event,scope){
 const keys=['eventId','genesis','merchant','invoiceId','sessionId','sourceOrder','nativeHash','abciHash','memberIndex','eventIndex','executionHeight','kind','effectHash'];
 if(!event||!hex(event.eventId)||event.genesis!==scope.genesis||!hex(event.effectHash)||!/^0x[0-9a-f]{40}$/.test(event.merchant??'')||!['invoice_terms','invoice_settle','invoice_refund'].includes(event.kind)||!['nativeHash','abciHash'].every(k=>/^0x[0-9a-f]{64}$/.test(event[k]??''))||!['invoiceId','sessionId'].every(k=>/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(event[k]??''))||typeof event.sourceOrder!=='string'||event.sourceOrder.length>128||! /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(event.sourceOrder))fail('NATIVE_PAY_EVENT_REFERENCE_INVALID');
 for(const k of ['memberIndex','eventIndex','executionHeight'])if(typeof event[k]!=='string'||! /^(0|[1-9][0-9]{0,18})$/.test(event[k]))fail('NATIVE_PAY_EVENT_REFERENCE_INVALID');
 if(BigInt(event.executionHeight)===0n||BigInt(event.executionHeight)>(1n<<63n)-1n||BigInt(event.memberIndex)>0xffffffffn||BigInt(event.eventIndex)>0xffffffffn)fail('NATIVE_PAY_EVENT_REFERENCE_INVALID');
 return Object.fromEntries(keys.map(k=>[k,event[k]]));
}
function privateFile(file){
 try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)fail('NATIVE_PAY_NOTIFICATION_STORAGE_UNAVAILABLE');return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}

/** Durable notification references only. It never stores balances, Member,
 * keys, approval, a retryable spend or a Source grant. No input here can mark
 * an invoice paid. The current original Source is rechecked at each commit. */
export class NativePayNotificationInbox {
 #db;
 constructor(file){
  if(!path.isAbsolute(file??''))fail('NATIVE_PAY_NOTIFICATION_STORAGE_UNAVAILABLE');
  const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0)fail('NATIVE_PAY_NOTIFICATION_STORAGE_UNAVAILABLE');
  const exists=privateFile(file);privateFile(file+'-wal');privateFile(file+'-shm');
  if(!exists){const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd);}
  this.#db=new DatabaseSync(file);
  if(exists&&(this.#db.prepare('PRAGMA application_id').get().application_id!==applicationId||this.#db.prepare('PRAGMA user_version').get().user_version!==1)){this.#db.close();fail('NATIVE_PAY_NOTIFICATION_STORAGE_REQUIRES_RECOVERY');}
  if(exists){try{this.#db.prepare('SELECT scope,event_id,digest,reference,refreshed FROM notification_ref LIMIT 0').all();}catch{this.#db.close();fail('NATIVE_PAY_NOTIFICATION_STORAGE_REQUIRES_RECOVERY');}}
  this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;");
  if(!exists)this.#db.exec(`BEGIN IMMEDIATE; PRAGMA application_id=${applicationId}; PRAGMA user_version=1; CREATE TABLE notification_ref (scope TEXT NOT NULL, event_id TEXT NOT NULL, digest TEXT NOT NULL, reference TEXT NOT NULL, refreshed INTEGER NOT NULL DEFAULT 0 CHECK(refreshed IN (0,1)), PRIMARY KEY(scope,event_id)); COMMIT;`);
 }
 #transaction(current,work){checkCurrent(current);this.#db.exec('BEGIN IMMEDIATE');try{const result=work();checkCurrent(current);this.#db.exec('COMMIT');return result;}catch(error){try{this.#db.exec('ROLLBACK');}catch{}throw error;}}
 stage(scope,events,current){
  const partition=scopeKey(scope);if(!Array.isArray(events)||events.length>1024)fail('NATIVE_PAY_EVENT_REFERENCE_INVALID');
  const references=events.map(e=>reference(e,scope));
  return this.#transaction(current,()=>{
   let added=0;const total=this.#db.prepare('SELECT count(*) AS n FROM notification_ref').get().n;
   for(const r of references){
    const digest=hash(r),old=this.#db.prepare('SELECT digest FROM notification_ref WHERE scope=? AND event_id=?').get(partition,r.eventId);
    if(old){if(old.digest!==digest)fail('NATIVE_PAY_EVENT_REFERENCE_CONFLICT');continue;}
    if(total+added>=65536)fail('NATIVE_PAY_NOTIFICATION_STORAGE_FULL');
    this.#db.prepare('INSERT INTO notification_ref(scope,event_id,digest,reference) VALUES(?,?,?,?)').run(partition,r.eventId,digest,JSON.stringify(r));added++;
   }
   return {added};
  });
 }
 pending(scope,merchant,invoiceId,current){
  checkCurrent(current);const partition=scopeKey(scope);
  const rows=this.#db.prepare('SELECT digest,reference FROM notification_ref WHERE scope=? AND refreshed=0 ORDER BY rowid').all(partition);
  const out=[];
  for(const row of rows){const ref=reference(JSON.parse(row.reference),scope);if(hash(ref)!==row.digest)fail('NATIVE_PAY_EVENT_REFERENCE_CONFLICT');if(ref.merchant===merchant&&ref.invoiceId===invoiceId)out.push(ref);}
  checkCurrent(current);return out;
 }
 refreshed(scope,event,current){
  const partition=scopeKey(scope),ref=reference(event,scope),digest=hash(ref);
  return this.#transaction(current,()=>{
   const old=this.#db.prepare('SELECT digest FROM notification_ref WHERE scope=? AND event_id=?').get(partition,ref.eventId);
   if(!old||old.digest!==digest)fail('NATIVE_PAY_EVENT_REFERENCE_CONFLICT');
   this.#db.prepare('UPDATE notification_ref SET refreshed=1 WHERE scope=? AND event_id=? AND digest=?').run(partition,ref.eventId,digest);
  });
 }
 close(){this.#db.close();}
}

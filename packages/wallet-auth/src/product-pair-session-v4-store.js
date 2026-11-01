// Private issuer storage. Persistence is NOT Source/account authority.
import {DatabaseSync} from 'node:sqlite';
import {decodePendingPairOriginalQueryDATA,projectPendingPairOriginalQueryDATA} from './product-pair-pending-original-query-data.mjs';
import {constants as F,openSync,closeSync,lstatSync,fstatSync,readFileSync,realpathSync,fsyncSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const fail=c=>{throw Object.assign(Error(c),{code:c});};
export const pairV4Digest=raw=>createHash('sha256').update(raw).digest('hex');
const hex=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail('PAIR_V4_DIGEST');return v;};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(v))fail('PAIR_V4_ID');return v;};
const instant=v=>{if(!Number.isSafeInteger(v)||v<0)fail('PAIR_V4_TIME');return v;};
const raw=v=>{if(typeof v!=='string'||!v.length||Buffer.byteLength(v)>393216)fail('PAIR_V4_ORIGINAL');JSON.parse(v);return v;};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.gid===b.gid;
const tickets=new WeakMap();
export function openProductPairSessionV4Store({path,namespace},{existingOnly=false}={}){
 id(namespace);if(typeof path!=='string'||resolve(path)!==path)fail('PAIR_V4_PATH');
 const parent=dirname(path),ps=lstatSync(parent),uid=process.getuid();
 if(!ps.isDirectory()||ps.isSymbolicLink()||ps.uid!==uid||(ps.mode&511)!==448||realpathSync(parent)!==parent)fail('PAIR_V4_PARENT');
 // Private parent is a required preexisting service resource, not mkdir authority.
 let fd,created=false;
 try{if(existingOnly)fd=openSync(path,F.O_RDWR|F.O_NOFOLLOW);else{fd=openSync(path,F.O_RDWR|F.O_CREAT|F.O_EXCL|F.O_NOFOLLOW,384);created=true;fsyncSync(fd);const pfd=openSync(parent,F.O_RDONLY|F.O_DIRECTORY|F.O_NOFOLLOW);try{fsyncSync(pfd);}finally{closeSync(pfd);}}}
 catch(e){if(e.code!=='EEXIST')throw e;fd=openSync(path,F.O_RDWR|F.O_NOFOLLOW);}
 let original,db,closed=false,unknown=false,closeError,closeSelected=false;
 const closeStorage=()=>{if(closeSelected){if(closeError)throw closeError.cause;return;}closeSelected=true;closed=true;try{db?.close();}catch(cause){closeError={cause};throw cause;}try{closeSync(fd);}catch(cause){closeError={cause};throw cause;}};
 const identity=()=>{if(closed)fail('PAIR_V4_CLOSED');const p=lstatSync(parent),s=lstatSync(path);if(!same(p,ps)||!p.isDirectory()||realpathSync(parent)!==parent||(p.mode&511)!==448||!same(s,original)||!s.isFile()||s.nlink!==1||(s.mode&511)!==384)fail('PAIR_V4_FILE_CHANGED');};
 try{original=fstatSync(fd);if(!original.isFile()||original.uid!==uid||original.nlink!==1||(original.mode&511)!==384)fail('PAIR_V4_FILE');identity();db=new DatabaseSync(path);if(!created&&db.prepare('PRAGMA user_version').get().user_version!==4)fail('PAIR_V4_SCHEMA');if(existingOnly){if(db.prepare('SELECT schema_version FROM issuer_v4_meta WHERE namespace=?').get(namespace)?.schema_version!==4)fail('PAIR_V4_CURRENT_NAMESPACE');db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA synchronous=FULL;');}else{db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');db.exec(readFileSync(new URL('./product-pair-session-v4-schema.sql',import.meta.url),'utf8'));db.prepare('INSERT OR IGNORE INTO issuer_v4_meta VALUES(?,4,0)').run(namespace);}identity();}
 catch(cause){try{closeStorage();}catch(cleanupCause){throw Object.assign(Error('PAIR_V4_STORE_CONSTRUCTION_UNRESOLVED'),{code:'PAIR_V4_STORE_CONSTRUCTION_UNRESOLVED',cause,cleanupCause,partial:Object.freeze({close:closeStorage})});}throw cause;}
 const run=(sql,...a)=>db.prepare(sql).run(...a),get=(sql,...a)=>db.prepare(sql).get(...a);
 const transaction=(at,fn)=>{
  identity();if(unknown)fail('PAIR_V4_UNKNOWN_RECOVER_ONLY');instant(at);db.exec('BEGIN IMMEDIATE');let committing=false;
  try{const floor=get('SELECT clock_floor_ms FROM issuer_v4_meta WHERE namespace=?',namespace).clock_floor_ms;if(at<floor)fail('PAIR_V4_CLOCK_ROLLBACK');run('UPDATE issuer_v4_meta SET clock_floor_ms=? WHERE namespace=?',at,namespace);const out=fn();identity();committing=true;db.exec('COMMIT');return out;}
  catch(e){if(committing){unknown=true;throw Object.assign(Error('PAIR_V4_COMMIT_UNKNOWN'),{code:'PAIR_V4_COMMIT_UNKNOWN',cause:e});}try{db.exec('ROLLBACK');}catch{unknown=true;}throw e;}
 };
 function lookup(actor,op){const row=get('SELECT * FROM issuer_v4_operations WHERE namespace=? AND operation_id=?',namespace,hex(op));if(row&&row.actor_digest!==hex(actor))fail('PAIR_V4_ACTOR_MISMATCH');return row;}
 function readPair(actor,registration,at){const p=get('SELECT * FROM issuer_v4_pairs WHERE namespace=? AND registration_id=?',namespace,id(registration));if(!p||p.actor_digest!==actor||p.status!=='ACTIVE'||p.expires_ms<=at)fail('PAIR_V4_PAIR_INACTIVE');return p;}
 function terminal(ticket,kind,result,at,apply){
  const t=tickets.get(ticket);if(!t||t.store!==api||t.kind!==kind||t.used)fail('PAIR_V4_FRESH_TICKET_REQUIRED');raw(result);t.used=true;
  return transaction(at,()=>{const op=lookup(t.actor,t.op);if(!op||op.phase!=='ENTERED'||op.input_sha256!==t.digest)fail('PAIR_V4_OPERATION_NOT_ENTERED');apply(t.actor);const changed=run("UPDATE issuer_v4_operations SET phase='COMMITTED',result_original=?,terminal_ms=? WHERE namespace=? AND operation_id=? AND phase='ENTERED'",result,at,namespace,t.op);if(changed.changes!==1)fail('PAIR_V4_OPERATION_CAS');run('INSERT INTO issuer_v4_audit(namespace,operation_id,actor_digest,kind,result_sha256,at_ms) VALUES(?,?,?,?,?,?)',namespace,t.op,t.actor,kind,pairV4Digest(result),at);return result;});
 }
 const api=Object.freeze({
  reserve({actor,operation,kind,input,at}){hex(actor);hex(operation);raw(input);if(!['PAIR','CHALLENGE','COMPLETE','REVOKE','CANCEL'].includes(kind))fail('PAIR_V4_KIND');const digest=pairV4Digest(input);return transaction(at,()=>{const prior=lookup(actor,operation);if(prior){if(prior.input_sha256!==digest||prior.kind!==kind)fail('PAIR_V4_IDEMPOTENCY_MISMATCH');return Object.freeze({recoveryOnly:true,phase:prior.phase,original:prior.result_original??null});}run("INSERT INTO issuer_v4_operations VALUES(?,?,?,?,?,?,'ENTERED',NULL,?,NULL)",namespace,operation,actor,kind,digest,input,at);const ticket=Object.freeze({});tickets.set(ticket,{store:api,op:operation,actor,kind,digest,used:false});return Object.freeze({recoveryOnly:false,ticket});});},
  commitPairChallenge(ticket,{registrationId,registrationDigest,registrationOriginal,challengeId,challengeOriginal,requestDigest,nonce,state,pairExpiresMs,challengeExpiresMs,result},at){
   id(registrationId);hex(registrationDigest);id(challengeId);hex(requestDigest);id(nonce);id(state);raw(registrationOriginal);raw(challengeOriginal);instant(pairExpiresMs);instant(challengeExpiresMs);if(pairExpiresMs<=at||challengeExpiresMs<=at||challengeExpiresMs>pairExpiresMs)fail('PAIR_V4_EXPIRED');
   return terminal(ticket,'PAIR',result,at,actor=>{run("INSERT INTO issuer_v4_pairs VALUES(?,?,?,?,?,?,'ACTIVE')",namespace,registrationId,actor,registrationDigest,registrationOriginal,pairExpiresMs);run("INSERT INTO issuer_v4_challenges VALUES(?,?,?,?,?,?,?,?,?,'ISSUED')",namespace,challengeId,actor,requestDigest,nonce,state,registrationId,challengeOriginal,challengeExpiresMs);});
  },
  commitChallenge(ticket,{registrationId,registrationDigest,challengeId,challengeOriginal,requestDigest,nonce,state,challengeExpiresMs,result},at){
   hex(registrationDigest);id(challengeId);hex(requestDigest);id(nonce);id(state);raw(challengeOriginal);instant(challengeExpiresMs);return terminal(ticket,'CHALLENGE',result,at,actor=>{const p=readPair(actor,registrationId,at);if(p.registration_digest!==registrationDigest||challengeExpiresMs<=at||challengeExpiresMs>p.expires_ms)fail('PAIR_V4_PAIR_BINDING');run("INSERT INTO issuer_v4_challenges VALUES(?,?,?,?,?,?,?,?,?,'ISSUED')",namespace,challengeId,actor,requestDigest,nonce,state,registrationId,challengeOriginal,challengeExpiresMs);});
  },
  commitSession(ticket,{registrationId,registrationDigest,challengeId,challengeOriginal,sessionBinding,sessionOriginal,sessionExpiresMs,result},at){
   hex(registrationDigest);hex(sessionBinding);raw(sessionOriginal);raw(challengeOriginal);instant(sessionExpiresMs);return terminal(ticket,'COMPLETE',result,at,actor=>{const p=readPair(actor,registrationId,at),c=get('SELECT * FROM issuer_v4_challenges WHERE namespace=? AND challenge_id=?',namespace,id(challengeId));if(p.registration_digest!==registrationDigest||!c||c.actor_digest!==actor||c.registration_id!==registrationId||c.original!==challengeOriginal||c.status!=='ISSUED'||c.expires_ms<=at||sessionExpiresMs<=at||sessionExpiresMs>p.expires_ms)fail('PAIR_V4_CHALLENGE_BINDING');if(run("UPDATE issuer_v4_challenges SET status='CONSUMED' WHERE namespace=? AND challenge_id=? AND status='ISSUED'",namespace,challengeId).changes!==1)fail('PAIR_V4_CHALLENGE_CAS');run("INSERT INTO issuer_v4_sessions VALUES(?,?,?,?,?,?,?,'ACTIVE')",namespace,sessionBinding,actor,registrationId,challengeId,sessionOriginal,sessionExpiresMs);});
  },
  revoke(ticket,{registrationId,sessionBinding,result,expectedOriginal},at){if((registrationId===null)===(sessionBinding===null))fail('PAIR_V4_REVOKE_TARGET');if(registrationId!==null)id(registrationId);if(sessionBinding!==null)hex(sessionBinding);return terminal(ticket,'REVOKE',result,at,actor=>{const table=registrationId!==null?'issuer_v4_pairs':'issuer_v4_sessions',column=registrationId!==null?'registration_id':'session_binding',target=registrationId??sessionBinding;const row=get(`SELECT * FROM ${table} WHERE namespace=? AND ${column}=?`,namespace,target);if(!row||row.actor_digest!==actor)fail('PAIR_V4_ACTOR_MISMATCH');if(row.status!=='ACTIVE'||row.expires_ms<=at||expectedOriginal!==undefined&&row.original!==expectedOriginal)fail('PAIR_V4_REVOKE_PRESTATE_CHANGED');if(run(`UPDATE ${table} SET status='REVOKED' WHERE namespace=? AND ${column}=? AND status='ACTIVE'`,namespace,target).changes!==1)fail('PAIR_V4_REVOKE_CAS');if(registrationId!==null){run("UPDATE issuer_v4_sessions SET status='REVOKED' WHERE namespace=? AND registration_id=?",namespace,registrationId);run("UPDATE issuer_v4_challenges SET status='CANCELLED' WHERE namespace=? AND registration_id=? AND status='ISSUED'",namespace,registrationId);}});},
  cancel(ticket,{challengeId,result,expectedOriginal},at){id(challengeId);return terminal(ticket,'CANCEL',result,at,actor=>{const c=get('SELECT * FROM issuer_v4_challenges WHERE namespace=? AND challenge_id=?',namespace,challengeId);if(!c||c.actor_digest!==actor)fail('PAIR_V4_ACTOR_MISMATCH');if(c.status!=='ISSUED'||c.expires_ms<=at||expectedOriginal!==undefined&&c.original!==expectedOriginal)fail('PAIR_V4_CANCEL_PRESTATE_CHANGED');if(run("UPDATE issuer_v4_challenges SET status='CANCELLED' WHERE namespace=? AND challenge_id=? AND status='ISSUED'",namespace,challengeId).changes!==1)fail('PAIR_V4_CANCEL_CAS');run("UPDATE issuer_v4_sessions SET status='REVOKED' WHERE namespace=? AND challenge_id=?",namespace,challengeId);});},
  readPair({actor,registrationId,at}){return transaction(at,()=>Object.freeze({...readPair(hex(actor),registrationId,at)}));},
  readSession({actor,sessionBinding,at}){return transaction(at,()=>{const s=get('SELECT * FROM issuer_v4_sessions WHERE namespace=? AND session_binding=?',namespace,hex(sessionBinding));if(!s||s.actor_digest!==hex(actor)||s.status!=='ACTIVE'||s.expires_ms<=at)fail('PAIR_V4_SESSION_INACTIVE');readPair(actor,s.registration_id,at);return Object.freeze({...s});});},
  consumeHTTPNonce({actor,sessionBinding,replayKey,expiresMs,at}){hex(actor);hex(sessionBinding);hex(replayKey);instant(expiresMs);return transaction(at,()=>{const s=get("SELECT * FROM issuer_v4_sessions WHERE namespace=? AND session_binding=? AND status='ACTIVE'",namespace,sessionBinding);if(!s||s.actor_digest!==actor||s.expires_ms<=at||expiresMs<=at||expiresMs>s.expires_ms)fail('PAIR_V4_SESSION_INACTIVE');readPair(actor,s.registration_id,at);run('INSERT INTO issuer_v4_http_nonces VALUES(?,?,?,?,?)',namespace,replayKey,actor,sessionBinding,expiresMs);});},
  readPendingPairOriginalQueryDATA({queryOriginal,originalPairPost,actor}){
   identity();hex(actor);const q=decodePendingPairOriginalQueryDATA(queryOriginal);let reader;
   try{reader=new DatabaseSync(path,{readOnly:true});
    const row=reader.prepare('SELECT operation_id,actor_digest,kind,input_sha256,input_original,phase,result_original FROM issuer_v4_operations WHERE namespace=? AND operation_id=?').get(namespace,q.operationId);
    identity();
    if(row?.phase==='COMMITTED'){
     const audits=reader.prepare('SELECT actor_digest,kind,result_sha256 FROM issuer_v4_audit WHERE namespace=? AND operation_id=?').all(namespace,q.operationId);
     if(audits.length!==1||audits[0].actor_digest!==actor||audits[0].kind!=='PAIR'||typeof row.result_original!=='string'||audits[0].result_sha256!==pairV4Digest(row.result_original))fail('PAIR_V4_PENDING_QUERY_AUDIT');
    }
    const result=projectPendingPairOriginalQueryDATA(queryOriginal,originalPairPost,actor,row??null);identity();return result;
   }finally{reader?.close();}
  },
  recover({actor,operation}){identity();hex(actor);hex(operation);let reader;try{reader=new DatabaseSync(path,{readOnly:true});const row=reader.prepare('SELECT * FROM issuer_v4_operations WHERE namespace=? AND operation_id=?').get(namespace,operation);identity();if(row&&row.actor_digest!==actor)fail('PAIR_V4_ACTOR_MISMATCH');return row?Object.freeze({phase:row.phase==='ENTERED'?'UNKNOWN':row.phase,input:row.input_original,original:row.result_original??null}):null;}finally{reader?.close();}},
  close:closeStorage
 });return api;
}

// Original issuer namespace, existing-only read connection. No DDL, clock
// update, replay consume, reserve, registration or signing operation is exposed.
export function openProductPairSessionV4CurrentStore({path,namespace}){
 id(namespace);if(typeof path!=='string'||resolve(path)!==path)fail('PAIR_V4_PATH');
 const parent=dirname(path),ps=lstatSync(parent),uid=process.getuid();if(!ps.isDirectory()||ps.isSymbolicLink()||ps.uid!==uid||(ps.mode&511)!==448||realpathSync(parent)!==parent)fail('PAIR_V4_PARENT');
 const parents=[];for(let p=parent;;p=dirname(p)){const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.uid!==0&&s.uid!==uid)||(s.mode&0o022))fail('PAIR_V4_CURRENT_PARENT');parents.push([p,s]);if(p==='/')break;}
 let fd,db,closed=false,closeFailure;const sidecars=new Map();
 const identity=()=>{if(closed||fd===undefined)fail('PAIR_V4_CLOSED');const p=lstatSync(parent),s=lstatSync(path),held=fstatSync(fd);if(!same(p,ps)||!p.isDirectory()||realpathSync(parent)!==parent||(p.mode&511)!==448||!same(s,held)||!same(s,original)||!s.isFile()||s.nlink!==1||(s.mode&511)!==384)fail('PAIR_V4_FILE_CHANGED');for(const[n,old]of parents){const next=lstatSync(n);if(!same(old,next)||!next.isDirectory()||next.isSymbolicLink()||next.mode!==old.mode)fail('PAIR_V4_CURRENT_PARENT_CHANGED')}for(const suffix of['-wal','-shm']){let stat;try{stat=lstatSync(path+suffix)}catch(e){if(e.code!=='ENOENT')throw e;if(sidecars.has(suffix))fail('PAIR_V4_CURRENT_SIDECAR_CHANGED');continue}if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==uid||stat.nlink!==1||(stat.mode&511)!==384||sidecars.has(suffix)&&!same(sidecars.get(suffix),stat))fail('PAIR_V4_CURRENT_SIDECAR_CHANGED');sidecars.set(suffix,stat)}};
 // Child SQLite close precedes its held file parent. An ambiguous close is
 // sticky UNKNOWN: never retry it or close a parent merely to hide the debt.
 let original,closeSelected=false;const close=()=>{if(closeSelected){if(closeFailure)throw closeFailure.cause;return;}closeSelected=true;closed=true;try{db?.close();}catch(cause){closeFailure={cause};throw cause;}try{if(fd!==undefined)closeSync(fd);}catch(cause){closeFailure={cause};throw cause;}};
 try{fd=openSync(path,F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK);original=fstatSync(fd);if(!original.isFile()||original.uid!==uid||original.nlink!==1||(original.mode&511)!==384)fail('PAIR_V4_FILE');identity();db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000;');if(db.prepare('PRAGMA user_version').get().user_version!==4)fail('PAIR_V4_SCHEMA');const meta=db.prepare('SELECT schema_version FROM issuer_v4_meta WHERE namespace=?').get(namespace);if(meta?.schema_version!==4)fail('PAIR_V4_CURRENT_NAMESPACE');identity();}catch(cause){try{close()}catch(cleanupCause){throw Object.assign(Error('PAIR_V4_STORE_CONSTRUCTION_UNRESOLVED'),{code:'PAIR_V4_STORE_CONSTRUCTION_UNRESOLVED',cause,cleanupCause,partial:Object.freeze({close})});}throw cause;}
 const get=(sql,...a)=>db.prepare(sql).get(...a),all=(sql,...a)=>db.prepare(sql).all(...a);
 function originalOperation(row,actor,at){if(!row||row.namespace!==namespace||row.actor_digest!==actor||row.phase!=='COMMITTED'||row.input_sha256!==pairV4Digest(row.input_original)||row.created_ms>row.terminal_ms||row.terminal_ms>at)fail('PAIR_V4_CURRENT_PROVENANCE');hex(row.operation_id);raw(row.input_original);raw(row.result_original);const audits=all('SELECT * FROM issuer_v4_audit WHERE namespace=? AND operation_id=?',namespace,row.operation_id);if(audits.length!==1||audits[0].actor_digest!==actor||audits[0].kind!==row.kind||audits[0].result_sha256!==pairV4Digest(row.result_original)||audits[0].at_ms!==row.terminal_ms)fail('PAIR_V4_CURRENT_AUDIT');return Object.freeze({...row});}
 return Object.freeze({
  assertCurrent(){identity();},
  captureManagementOperationOriginalDATA({actor,operation,kind,allowAbsent=false}){
   hex(actor);hex(operation);if(!['COMPLETE','REVOKE','CANCEL'].includes(kind))fail('PAIR_V4_MANAGEMENT_OPERATION_KIND');identity();const version=get('PRAGMA data_version').data_version,row=get('SELECT * FROM issuer_v4_operations WHERE namespace=? AND operation_id=?',namespace,operation);
   if(!row&&allowAbsent===true){identity();return null;}
   if(!row||row.actor_digest!==actor||row.kind!==kind||row.input_sha256!==pairV4Digest(row.input_original))fail('PAIR_V4_MANAGEMENT_ORIGINAL_REQUIRED');raw(row.input_original);const audit=all('SELECT * FROM issuer_v4_audit WHERE namespace=? AND operation_id=?',namespace,operation);
   if(row.phase==='ENTERED'){if(row.result_original!==null||row.terminal_ms!==null||audit.length)fail('PAIR_V4_MANAGEMENT_UNKNOWN_SHAPE');}
   else if(row.phase==='COMMITTED'){raw(row.result_original);if(audit.length!==1||audit[0].actor_digest!==actor||audit[0].kind!==kind||audit[0].result_sha256!==pairV4Digest(row.result_original)||audit[0].at_ms!==row.terminal_ms||row.created_ms>row.terminal_ms)fail('PAIR_V4_MANAGEMENT_AUDIT');}
   else fail('PAIR_V4_MANAGEMENT_PHASE');
   const fingerprint=JSON.stringify([row,audit]),current=()=>{identity();if(get('PRAGMA data_version').data_version!==version||JSON.stringify([get('SELECT * FROM issuer_v4_operations WHERE namespace=? AND operation_id=?',namespace,operation),all('SELECT * FROM issuer_v4_audit WHERE namespace=? AND operation_id=?',namespace,operation)])!==fingerprint)fail('PAIR_V4_MANAGEMENT_ORIGINAL_CHANGED');};current();
   return Object.freeze({operationId:operation,kind,inputOriginal:row.input_original,inputDigest:row.input_sha256,phase:row.phase==='ENTERED'?'UNKNOWN':'COMMITTED',original:row.result_original,assertCurrent:current});
  },
  readManagementTargetCurrentDATA({actor,registrationId,sessionBinding,challengeId,at}){
   hex(actor);id(registrationId);instant(at);identity();const pair=get('SELECT * FROM issuer_v4_pairs WHERE namespace=? AND registration_id=?',namespace,registrationId);if(!pair||pair.actor_digest!==actor||pair.status!=='ACTIVE'||pair.expires_ms<=at)fail('PAIR_V4_MANAGEMENT_PAIR_INACTIVE');
   const target=challengeId!==null?get('SELECT * FROM issuer_v4_challenges WHERE namespace=? AND challenge_id=?',namespace,id(challengeId)):sessionBinding===null?pair:get('SELECT * FROM issuer_v4_sessions WHERE namespace=? AND session_binding=?',namespace,hex(sessionBinding));
   if(!target||target.actor_digest!==actor||target.registration_id!==registrationId||target.status!==(challengeId!==null?'ISSUED':'ACTIVE')||target.expires_ms<=at)fail('PAIR_V4_MANAGEMENT_TARGET_INACTIVE');raw(target.original);identity();return Object.freeze({original:target.original,expiresAtMs:target.expires_ms});
  },
  readManagementTerminalTargetDATA({actor,registrationId,sessionBinding,challengeId}){
   hex(actor);id(registrationId);identity();const target=challengeId!==null?get('SELECT * FROM issuer_v4_challenges WHERE namespace=? AND challenge_id=?',namespace,id(challengeId)):sessionBinding===null?get('SELECT * FROM issuer_v4_pairs WHERE namespace=? AND registration_id=?',namespace,registrationId):get('SELECT * FROM issuer_v4_sessions WHERE namespace=? AND session_binding=?',namespace,hex(sessionBinding));
   if(!target||target.actor_digest!==actor||target.registration_id!==registrationId||target.status!==(challengeId!==null?'CANCELLED':'REVOKED'))fail('PAIR_V4_MANAGEMENT_TERMINAL_TARGET');identity();return Object.freeze({original:target.original,status:target.status});
  },
  // PRIVATE readonly snapshot for the E13 stage→original-full verification
  // sequence. The normal caller must authenticate stage N1 BEFORE capture.
  // It must inspect the returned original PAIR with sole SDK full inspector
  // BEFORE calling projectResult. No result/public raw row is HTTP input.
  capturePendingPairOriginalQueryDATA({queryOriginal,actor}){
   hex(actor);queryOriginal=Buffer.from(queryOriginal);const q=decodePendingPairOriginalQueryDATA(queryOriginal);identity();let begun=false,version,row,audit=[];
   try{version=get('PRAGMA data_version').data_version;db.exec('BEGIN');begun=true;
    row=get('SELECT operation_id,actor_digest,kind,input_sha256,input_original,phase,result_original FROM issuer_v4_operations WHERE namespace=? AND operation_id=?',namespace,q.operationId);
    if(row&&(row.actor_digest!==actor||row.kind!=='PAIR'||row.input_sha256!==q.originalRequestBodyDigest||typeof row.input_original!=='string'||pairV4Digest(row.input_original)!==row.input_sha256))fail('PAIR_V4_PENDING_QUERY_ORIGINAL_BINDING');
    if(row?.phase==='COMMITTED'){audit=all('SELECT actor_digest,kind,result_sha256 FROM issuer_v4_audit WHERE namespace=? AND operation_id=?',namespace,q.operationId);if(audit.length!==1||audit[0].actor_digest!==actor||audit[0].kind!=='PAIR'||typeof row.result_original!=='string'||audit[0].result_sha256!==pairV4Digest(row.result_original))fail('PAIR_V4_PENDING_QUERY_AUDIT');}
    identity();db.exec('COMMIT');begun=false;
   }catch(error){if(begun)try{db.exec('ROLLBACK')}catch{}throw error;}
   const rowJSON=JSON.stringify(row??null),auditJSON=JSON.stringify(audit);
   const current=()=>{identity();if(get('PRAGMA data_version').data_version!==version)fail('PAIR_V4_PENDING_QUERY_CONCURRENT_CHANGE');const now=get('SELECT operation_id,actor_digest,kind,input_sha256,input_original,phase,result_original FROM issuer_v4_operations WHERE namespace=? AND operation_id=?',namespace,q.operationId);if(JSON.stringify(now??null)!==rowJSON)fail('PAIR_V4_PENDING_QUERY_ORIGINAL_CHANGED');if(row?.phase==='COMMITTED'&&JSON.stringify(all('SELECT actor_digest,kind,result_sha256 FROM issuer_v4_audit WHERE namespace=? AND operation_id=?',namespace,q.operationId))!==auditJSON)fail('PAIR_V4_PENDING_QUERY_AUDIT');identity();};
   current();
   return Object.freeze({get originalPairPost(){current();return row?Buffer.from(row.input_original,'utf8'):null;},assertCurrent:current,
    projectResult(){current();const result=row?projectPendingPairOriginalQueryDATA(queryOriginal,Buffer.from(row.input_original,'utf8'),actor,row):Object.freeze({version:'1',operationId:q.operationId,queryBodyDigest:q.queryBodyDigest,originalRequestBodyDigest:q.originalRequestBodyDigest,state:'NOT_FOUND',original:null,dataOnly:true,authorized:false,sourceAdmission:false,nativeAdmission:false,registered:false,connected:false,newSession:false,retryAuthorized:false});current();return result;}});
  },
  // Query-only existing store. No DDL, nonce/clock-floor update, reserve,
  // challenge, completion or session lookup. One actual read snapshot binds
  // the seven original columns and original single PAIR audit together.
  readPendingPairOriginalQueryDATA({queryOriginal,originalPairPost,actor}){
   hex(actor);const q=decodePendingPairOriginalQueryDATA(queryOriginal);identity();let begun=false;
   try{const version=get('PRAGMA data_version').data_version;db.exec('BEGIN');begun=true;
    const row=get('SELECT operation_id,actor_digest,kind,input_sha256,input_original,phase,result_original FROM issuer_v4_operations WHERE namespace=? AND operation_id=?',namespace,q.operationId);
    if(row?.phase==='COMMITTED'){
     const audit=all('SELECT actor_digest,kind,result_sha256 FROM issuer_v4_audit WHERE namespace=? AND operation_id=?',namespace,q.operationId);
     if(audit.length!==1||audit[0].actor_digest!==actor||audit[0].kind!=='PAIR'||typeof row.result_original!=='string'||audit[0].result_sha256!==pairV4Digest(row.result_original))fail('PAIR_V4_PENDING_QUERY_AUDIT');
    }
    const result=projectPendingPairOriginalQueryDATA(queryOriginal,originalPairPost,actor,row??null);identity();db.exec('COMMIT');begun=false;
    if(get('PRAGMA data_version').data_version!==version)fail('PAIR_V4_PENDING_QUERY_CONCURRENT_CHANGE');identity();return result;
   }catch(error){if(begun)try{db.exec('ROLLBACK')}catch{}throw error;}
  },
  readDeviceCurrent({actor,registrationId,sessionBinding,at}){hex(actor);id(registrationId);hex(sessionBinding);instant(at);identity();let begun=false;try{const version=get('PRAGMA data_version').data_version;db.exec('BEGIN');begun=true;const floor=get('SELECT clock_floor_ms FROM issuer_v4_meta WHERE namespace=?',namespace)?.clock_floor_ms;if(!Number.isSafeInteger(floor)||at<floor)fail('PAIR_V4_CLOCK_ROLLBACK');const pair=get('SELECT * FROM issuer_v4_pairs WHERE namespace=? AND registration_id=?',namespace,registrationId),session=get('SELECT * FROM issuer_v4_sessions WHERE namespace=? AND session_binding=?',namespace,sessionBinding);if(!pair||!session||pair.actor_digest!==actor||session.actor_digest!==actor||session.registration_id!==registrationId||pair.status!=='ACTIVE'||session.status!=='ACTIVE'||pair.expires_ms<=at||session.expires_ms<=at)fail('PAIR_V4_CURRENT_INACTIVE');raw(pair.original);raw(session.original);if(pair.registration_digest!==pairV4Digest(pair.original))fail('PAIR_V4_CURRENT_REGISTRATION_HASH');const challenge=get('SELECT * FROM issuer_v4_challenges WHERE namespace=? AND challenge_id=?',namespace,session.challenge_id);if(!challenge||challenge.actor_digest!==actor||challenge.registration_id!==registrationId||challenge.status!=='CONSUMED')fail('PAIR_V4_CURRENT_CHALLENGE');raw(challenge.original);
   const pairRows=all("SELECT * FROM issuer_v4_operations WHERE namespace=? AND actor_digest=? AND kind='PAIR' AND json_extract(input_original,'$.registrationOriginal')=? LIMIT 2",namespace,actor,pair.original),completeRows=all("SELECT * FROM issuer_v4_operations WHERE namespace=? AND actor_digest=? AND kind='COMPLETE' AND result_original=? LIMIT 2",namespace,actor,session.original);if(pairRows.length!==1||completeRows.length!==1)fail('PAIR_V4_CURRENT_PROVENANCE');const pairOperation=originalOperation(pairRows[0],actor,at),completeOperation=originalOperation(completeRows[0],actor,at),pairResult=JSON.parse(pairOperation.result_original);if(pairResult.registrationOriginal!==pair.original)fail('PAIR_V4_CURRENT_PROVENANCE');let challengeOperation;if(pairResult.challenge&&pairV4Digest(JSON.stringify(pairResult.challenge))===pairV4Digest(challenge.original))challengeOperation=pairOperation;else{const rows=all("SELECT * FROM issuer_v4_operations WHERE namespace=? AND actor_digest=? AND kind='CHALLENGE' AND result_original=? LIMIT 2",namespace,actor,challenge.original);if(rows.length!==1)fail('PAIR_V4_CURRENT_PROVENANCE');challengeOperation=originalOperation(rows[0],actor,at)}
   const completion=JSON.parse(completeOperation.input_original);if(completion.registrationOriginal!==pair.original||JSON.stringify(completion.completion?.challenge)!==challenge.original||session.expires_ms!==Date.parse(JSON.parse(session.original).expiresAt)||pair.expires_ms!==Date.parse(JSON.parse(pair.original).expiresAt))fail('PAIR_V4_CURRENT_PROVENANCE');identity();db.exec('COMMIT');begun=false;if(get('PRAGMA data_version').data_version!==version)fail('PAIR_V4_CURRENT_CONCURRENT_CHANGE');identity();return Object.freeze({pair:Object.freeze({...pair}),session:Object.freeze({...session}),challenge:Object.freeze({...challenge}),pairOperation,completeOperation,challengeOperation});
  }catch(error){if(begun)try{db.exec('ROLLBACK')}catch{}throw error;}},
  close
 });
}

// Private issuer storage. Persistence is NOT Source/account authority.
import {DatabaseSync} from 'node:sqlite';
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
export function openProductPairSessionV4Store({path,namespace}){
 id(namespace);if(typeof path!=='string'||resolve(path)!==path)fail('PAIR_V4_PATH');
 const parent=dirname(path),ps=lstatSync(parent),uid=process.getuid();
 if(!ps.isDirectory()||ps.isSymbolicLink()||ps.uid!==uid||(ps.mode&511)!==448||realpathSync(parent)!==parent)fail('PAIR_V4_PARENT');
 // Private parent is a required preexisting service resource, not mkdir authority.
 let fd,created=false;
 try{fd=openSync(path,F.O_RDWR|F.O_CREAT|F.O_EXCL|F.O_NOFOLLOW,384);created=true;fsyncSync(fd);const pfd=openSync(parent,F.O_RDONLY|F.O_DIRECTORY|F.O_NOFOLLOW);try{fsyncSync(pfd);}finally{closeSync(pfd);}}
 catch(e){if(e.code!=='EEXIST')throw e;fd=openSync(path,F.O_RDWR|F.O_NOFOLLOW);}
 const original=fstatSync(fd);if(!original.isFile()||original.uid!==uid||original.nlink!==1||(original.mode&511)!==384){closeSync(fd);fail('PAIR_V4_FILE');}
 let db,closed=false,unknown=false,closeError;
 const identity=()=>{if(closed)fail('PAIR_V4_CLOSED');const p=lstatSync(parent),s=lstatSync(path);if(!same(p,ps)||!p.isDirectory()||realpathSync(parent)!==parent||(p.mode&511)!==448||!same(s,original)||!s.isFile()||s.nlink!==1||(s.mode&511)!==384)fail('PAIR_V4_FILE_CHANGED');};
 try{identity();db=new DatabaseSync(path);if(!created&&db.prepare('PRAGMA user_version').get().user_version!==4)fail('PAIR_V4_SCHEMA');db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');db.exec(readFileSync(new URL('./product-pair-session-v4-schema.sql',import.meta.url),'utf8'));db.prepare('INSERT OR IGNORE INTO issuer_v4_meta VALUES(?,4,0)').run(namespace);identity();}
 catch(e){db?.close();closeSync(fd);throw e;}
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
  revoke(ticket,{registrationId,sessionBinding,result},at){if((registrationId===null)===(sessionBinding===null))fail('PAIR_V4_REVOKE_TARGET');if(registrationId!==null)id(registrationId);if(sessionBinding!==null)hex(sessionBinding);return terminal(ticket,'REVOKE',result,at,actor=>{const table=registrationId!==null?'issuer_v4_pairs':'issuer_v4_sessions',column=registrationId!==null?'registration_id':'session_binding',target=registrationId??sessionBinding;const row=get(`SELECT actor_digest FROM ${table} WHERE namespace=? AND ${column}=?`,namespace,target);if(!row||row.actor_digest!==actor)fail('PAIR_V4_ACTOR_MISMATCH');run(`UPDATE ${table} SET status='REVOKED' WHERE namespace=? AND ${column}=?`,namespace,target);if(registrationId!==null){run("UPDATE issuer_v4_sessions SET status='REVOKED' WHERE namespace=? AND registration_id=?",namespace,registrationId);run("UPDATE issuer_v4_challenges SET status='CANCELLED' WHERE namespace=? AND registration_id=? AND status='ISSUED'",namespace,registrationId);}});},
  cancel(ticket,{challengeId,result},at){id(challengeId);return terminal(ticket,'CANCEL',result,at,actor=>{const c=get('SELECT * FROM issuer_v4_challenges WHERE namespace=? AND challenge_id=?',namespace,challengeId);if(!c||c.actor_digest!==actor)fail('PAIR_V4_ACTOR_MISMATCH');run("UPDATE issuer_v4_challenges SET status='CANCELLED' WHERE namespace=? AND challenge_id=? AND status='ISSUED'",namespace,challengeId);run("UPDATE issuer_v4_sessions SET status='REVOKED' WHERE namespace=? AND challenge_id=?",namespace,challengeId);});},
  readPair({actor,registrationId,at}){return transaction(at,()=>Object.freeze({...readPair(hex(actor),registrationId,at)}));},
  readSession({actor,sessionBinding,at}){return transaction(at,()=>{const s=get('SELECT * FROM issuer_v4_sessions WHERE namespace=? AND session_binding=?',namespace,hex(sessionBinding));if(!s||s.actor_digest!==hex(actor)||s.status!=='ACTIVE'||s.expires_ms<=at)fail('PAIR_V4_SESSION_INACTIVE');readPair(actor,s.registration_id,at);return Object.freeze({...s});});},
  consumeHTTPNonce({actor,sessionBinding,replayKey,expiresMs,at}){hex(actor);hex(sessionBinding);hex(replayKey);instant(expiresMs);return transaction(at,()=>{const s=get("SELECT * FROM issuer_v4_sessions WHERE namespace=? AND session_binding=? AND status='ACTIVE'",namespace,sessionBinding);if(!s||s.actor_digest!==actor||s.expires_ms<=at||expiresMs<=at||expiresMs>s.expires_ms)fail('PAIR_V4_SESSION_INACTIVE');readPair(actor,s.registration_id,at);run('INSERT INTO issuer_v4_http_nonces VALUES(?,?,?,?,?)',namespace,replayKey,actor,sessionBinding,expiresMs);});},
  recover({actor,operation}){identity();hex(actor);hex(operation);let reader;try{reader=new DatabaseSync(path,{readOnly:true});const row=reader.prepare('SELECT * FROM issuer_v4_operations WHERE namespace=? AND operation_id=?').get(namespace,operation);identity();if(row&&row.actor_digest!==actor)fail('PAIR_V4_ACTOR_MISMATCH');return row?Object.freeze({phase:row.phase==='ENTERED'?'UNKNOWN':row.phase,input:row.input_original,original:row.result_original??null}):null;}finally{reader?.close();}},
  close(){if(!closed){closed=true;try{db.close();}catch(e){closeError=e;}try{closeSync(fd);}catch(e){closeError=closeError?new AggregateError([closeError,e],'PAIR_V4_CLOSE'):e;}}if(closeError)throw closeError;}
 });return api;
}

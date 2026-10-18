const outcomes=new Set(['not-started','pending','fulfilled','rejected']);
const fields=['scope','attempt','stage','connection','initialization','inFlight','draining','cancelled','cleanup','firstCause','remoteCleanup','remoteCleanupUnconfirmed'];
function values(input,keys){
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw Error('INVALID_OBSERVATION');
 const descriptors=Object.getOwnPropertyDescriptors(input),names=Reflect.ownKeys(descriptors);
 if(names.length!==keys.length||names.some(key=>!keys.includes(key)||!Object.hasOwn(descriptors[key],'value')))throw Error('INVALID_OBSERVATION');
 return Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
}
/** The formally supplied SDK313 getter on the ORIGINAL object only. This
 * never constructs a connection or calls initialize/restore/cancel/disconnect.
 * Its contract has no positive remote-cleanup proof or retry authority. */
export function readOriginalAddressObservation(connection,safeCode){
 const result=(availability,value=null)=>Object.freeze({availability,value});
 if(!connection)return result('not-started');
 let snapshot;
 try{
  if(typeof connection.cleanupSnapshot!=='function')return result('not-supplied');
  snapshot=connection.cleanupSnapshot();
 }catch{return result('unavailable');}
 try{
  const s=values(snapshot,fields),cause=values(s.firstCause,['present','code']);
  if(s.scope!=='local-only'||!Number.isSafeInteger(s.attempt)||s.attempt<0||!['idle','initialization','relay','approval'].includes(s.stage)||!outcomes.has(s.connection)||!outcomes.has(s.initialization)||
    typeof s.inFlight!=='boolean'||typeof s.draining!=='boolean'||typeof s.cancelled!=='boolean'||!['unobserved','unknown','transport-paused','shared-preserved'].includes(s.cleanup)||
    typeof cause.present!=='boolean'||(cause.code!==null&&typeof cause.code!=='string')||(!cause.present&&cause.code!==null)||s.remoteCleanup!=='not-proven'||s.remoteCleanupUnconfirmed!==true||
    ((s.draining||s.connection==='pending'||s.initialization==='pending')&&!s.inFlight))return result('invalid');
  const firstCause=Object.freeze({present:cause.present,code:cause.code===null?null:safeCode({code:cause.code})});
  return result('available',Object.freeze({...s,firstCause}));
 }catch{return result('invalid');}
}

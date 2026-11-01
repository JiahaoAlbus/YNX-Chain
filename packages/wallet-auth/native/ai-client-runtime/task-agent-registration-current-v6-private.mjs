// PRIVATE protected-record DATA owner. Only the original RootCurrent composes
// this with Source mathematics; this helper cannot mint Source or Task rights.
import {createHash} from 'node:crypto';
import {holdOriginalAITaskPublicFile} from './task-action-protected-image-private.mjs';
import {canonicalJSON} from './inherited/canonical.js';
const fail=code=>{throw Object.assign(Error(code),{code});};
const fields=['version','purpose','networkId','canonicalOwner','registrationId','keyEpoch','pkA','pkB','sourceId','instanceId','resourceKey','protectedResourceRef','registeredAtMs','expiresAtMs'];
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const sha=b=>createHash('sha256').update(b).digest('hex');

// releaseResource is exclusively from the independently registered normal
// release, never HTTP, an SDK DTO, a member, or a user-selected file path.
export function holdOriginalAITaskV6AgentRegistration(releaseResource,rootDigest){
 let held,record,raw,first,closed=false,closeSelected=false,closeFailure;
 const remember=cause=>{first??={cause};throw first.cause;};
 const physical=()=>{if(first)throw first.cause;if(closed||closeSelected)fail('AI_TASK_AGENT_RECORD_CLOSED');try{if(!held||!record)fail('AI_TASK_AGENT_RECORD_NOT_SUPPLIED');held.current();}catch(cause){remember(cause);}};
 const owner=Object.freeze({
  currentPhysical:physical,
  assertExpectedDATA(expected,scope,profile,at){
   physical();try{
    if(!exact(expected,[...fields,'registrationDigest'])||!scope?.agentRegistration||canonicalJSON(expected)!==canonicalJSON(scope.agentRegistration))fail('AI_TASK_AGENT_SIGNED_BINDING_REQUIRED');
    if(expected.registrationDigest!==sha(raw))fail('AI_TASK_AGENT_RECORD_DIGEST');
    for(const key of fields)if(expected[key]!==record[key])fail('AI_TASK_AGENT_RECORD_BINDING');
    if(expected.protectedResourceRef!==releaseResource.protectedResourceRef||record.rootDigest!==rootDigest||record.state!=='active')fail('AI_TASK_AGENT_RECORD_NOT_CURRENT');
    for(const key of ['sourceId','instanceId','resourceKey'])if(expected[key]!==scope.currentSelector?.[key])fail('AI_TASK_AGENT_RECORD_SELECTOR');
    if(expected.version!=='1'||expected.purpose!=='PRODUCT-SESSION-AI-TASK-ACTION'||!/^[1-9][0-9]{0,19}$/.test(expected.keyEpoch)||BigInt(expected.keyEpoch)>18446744073709551615n)fail('AI_TASK_AGENT_RECORD_EPOCH_PURPOSE');
    if(![record.registeredAtMs,record.expiresAtMs,profile.issuedAtMs,profile.expiresAtMs,at].every(Number.isSafeInteger)||record.registeredAtMs<0||record.registeredAtMs>profile.issuedAtMs||profile.issuedAtMs>=profile.expiresAtMs||profile.expiresAtMs>record.expiresAtMs||at<profile.issuedAtMs||at>=profile.expiresAtMs)fail('AI_TASK_AGENT_RECORD_WINDOW');
    held.current();
   }catch(cause){remember(cause);}
  },
  readOriginalDATA(){physical();return Object.freeze({original:Buffer.from(raw),dataOnly:true,SourceAdmission:false});},
  // Synchronous held-file child: no async task/join debt. A close failure is
  // sticky and is never reissued against a potentially reused descriptor.
  close(){if(closeSelected){if(closeFailure)throw closeFailure.cause;return;}closeSelected=true;try{held?.close();closed=true;}catch(cause){closeFailure={cause};throw cause;}}
 });
 try{
  if(!exact(releaseResource,['protectedResourceRef','original'])||typeof releaseResource.protectedResourceRef!=='string'||!releaseResource.protectedResourceRef||!/^[a-f0-9]{64}$/.test(rootDigest))fail('AI_TASK_AGENT_PROTECTED_RESOURCE_NOT_SUPPLIED');
  const result=holdOriginalAITaskPublicFile(releaseResource.original,{cap:16384});held=result.owner;if(result.errorPresent)throw result.error;
  raw=held.readOriginal();record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!exact(record,[...fields,'state','rootDigest'])||!raw.equals(Buffer.from(canonicalJSON(record))))fail('AI_TASK_AGENT_RECORD_FORMAT');
  physical();return Object.freeze({owner,errorPresent:false});
 }catch(cause){first??={cause};return Object.freeze({owner,errorPresent:true,error:first.cause});}
}

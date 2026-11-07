// PRIVATE ordinary JS snapshot DATA; getters/Proxy traps MAY execute. No brand.
import {captureOriginalAITaskV6MobileBytesDATA} from './original-ai-task-action-v6-mobile-data.mjs';
import {canonicalJSON} from './canonical.js';import {encodeBase64url} from './base64url.js';
const keys=['operationId','action','method','path','taskId','taskRevision','generation','stepId','runId','creationBinding','bodyOriginal','abortContext'];
const actions=['task.create','task.prepare','task.approve','task.cancel','task.dispatch','task.run-start','task.run-resume','task.list','task.read','task.step-result','task.run-read','task.reconcile','task.propose-tool-step','task.complete'];
const bad=c=>{throw Object.assign(Error(c),{code:c});};
function exact(v,names){if(!v||typeof v!=='object'||Array.isArray(v))bad('AI_V6_MOBILE_INTENT_DATA');const own=Reflect.ownKeys(v);if(own.length!==names.length||own.some(k=>typeof k!=='string'||!names.includes(k)))bad('AI_V6_MOBILE_INTENT_DATA');const out={};for(const key of names)out[key]=v[key];return out;}
function utf8Length(s){let n=0;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const lo=s.charCodeAt(++i);if(!(lo>=0xdc00&&lo<=0xdfff))bad('AI_V6_MOBILE_INTENT_TEXT');n+=4;}else if(c>=0xdc00&&c<=0xdfff)bad('AI_V6_MOBILE_INTENT_TEXT');else n+=c<128?1:c<2048?2:3;}return n;}
function id(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);}
function decimal(v){return typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;}
export function captureOriginalAITaskV6MobileAbortDATA(value){
 if(!value||typeof value!=='object'||!Object.isFrozen(value))bad('AI_V6_MOBILE_ORIGINAL_CONTEXT');
 const c=exact(value,['signal']),signal=c.signal;if(!signal||(typeof signal!=='object'&&typeof signal!=='function'))bad('AI_V6_MOBILE_ORIGINAL_CONTEXT');
 // Captured before any Native context/request. These are lifecycle functions,
 // not Source, provider, signer or native pointers. Ordinary getters may run.
 const add=signal.addEventListener,remove=signal.removeEventListener,aborted=signal.aborted;
 if(typeof add!=='function'||typeof remove!=='function'||typeof aborted!=='boolean')bad('AI_V6_MOBILE_ORIGINAL_CONTEXT');
 if(aborted)throw signal.reason;
 return Object.freeze({original:value,signal,add,remove});
}
export function captureOriginalAITaskV6MobileIntentDATA(value){
 const v=exact(value,keys); // EACH top-level field is read ONCE, no later input reads.
 const body=captureOriginalAITaskV6MobileBytesDATA(v.bodyOriginal,'body');
 if(!id(v.operationId)||!actions.includes(v.action)||!['GET','POST'].includes(v.method)||typeof v.path!=='string'||!/^\/api\/tasks(?:[/?]|$)/.test(v.path)||/[\x00-\x1f\x7f#\\]/.test(v.path)||utf8Length(v.path)>2048)bad('AI_V6_MOBILE_INTENT_DATA');
 const noTask=['task.create','task.list'].includes(v.action),step=['task.approve','task.dispatch','task.reconcile','task.step-result'].includes(v.action),run=['task.run-start','task.run-resume','task.run-read','task.complete'].includes(v.action);
 if(noTask?[v.taskId,v.taskRevision,v.generation,v.stepId,v.runId].some(x=>x!==null):!id(v.taskId)||!decimal(v.taskRevision)||!decimal(v.generation))bad('AI_V6_MOBILE_INTENT_DATA');
 if(step?!id(v.stepId)||v.runId!==null:v.stepId!==null)bad('AI_V6_MOBILE_INTENT_DATA');if(run?!id(v.runId):v.runId!==null)bad('AI_V6_MOBILE_INTENT_DATA');
 let creation=null;if(v.action==='task.create'){const c=exact(v.creationBinding,['conversationId']);if(!id(c.conversationId))bad('AI_V6_MOBILE_INTENT_DATA');creation=Object.freeze(c);}else if(v.creationBinding!==null)bad('AI_V6_MOBILE_INTENT_DATA');
 if(v.method==='GET'&&body.length!==0)bad('AI_V6_MOBILE_INTENT_DATA');
 const abort=captureOriginalAITaskV6MobileAbortDATA(v.abortContext),metadata=Object.freeze({operationId:v.operationId,action:v.action,method:v.method,path:v.path,taskId:v.taskId,taskRevision:v.taskRevision,generation:v.generation,stepId:v.stepId,runId:v.runId,creationBinding:creation});
 if(utf8Length(canonicalJSON(metadata))>16384)bad('AI_V6_MOBILE_INTENT_DATA');
 const snapshotString=canonicalJSON({...metadata,bodyOriginalBase64url:encodeBase64url(body)});if(utf8Length(snapshotString)>2097152)bad('AI_V6_MOBILE_INTENT_DATA');
 return Object.freeze({snapshotString,operationId:v.operationId,abort,dataOnly:true,SourceAdmission:false,NativeAdmission:false});
}

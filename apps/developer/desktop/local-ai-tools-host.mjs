import {randomUUID} from 'node:crypto';
import channel from '../runtime/ynx-workbench/lib/local-ai-tools-channel.js';
function waitForReply(start, signal, code = 'AI_UNKNOWN') {
 return new Promise((resolve, reject) => {
  const abort = () => reject(channel.failure(code));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); return; }
  Promise.resolve().then(() => { if (signal.aborted) throw channel.failure(code); return start(); }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
 });
}
function publicReceipt(operation) {
 if (!operation || typeof operation !== 'object') return undefined;
 const result = {};
 for (const key of ['requestId','sessionId','model','modelConfidence','usageConfidence','costConfidence','delivery','remoteOutcome','cancellation']) {
  if (operation[key] === null || typeof operation[key] === 'string' && operation[key].length <= 256) result[key] = operation[key];
 }
 if (operation.usage && typeof operation.usage === 'object') {
  result.usage = {}; for (const key of ['inputTokens','outputTokens']) { const value = operation.usage[key]; if (value === null || Number.isSafeInteger(value) && value >= 0) result.usage[key] = value; }
 }
 return result;
}
// The client is supplied by the original admitted native-tools owner.
// No project identity or generation permission is created by this adapter.
export function createLocalAIToolsHost(context,{client=null,assertPathCurrent=async()=>{}}={}){
 const launch=randomUUID(),pending=new Set(),proposals=new Map();let retired=false;
 const prune = () => { for (const [id, proposal] of proposals) if (proposal.expiresAt <= Date.now()) proposals.delete(id); };
 const binding={projectId:context.id,workspace:context.workspace,launch};
 async function current(signal){
  signal?.throwIfAborted();if(retired)throw channel.failure('AI_RETIRED');await assertPathCurrent();
  if(!client)return false;
  if(typeof client.request!=='function'||typeof client.assertCurrent!=='function')throw channel.failure();
  const value=await client.assertCurrent(binding,signal);
  if(value?.localProjectId!==context.id||value.workspace!==context.workspace||typeof value.sessionId!=='string'||!/^[a-f0-9-]{36}$/.test(value.sessionId)||typeof value.generation!=='string'||!value.generation||!Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now())throw channel.failure('AI_RETIRED');
  signal?.throwIfAborted();if(retired)throw channel.failure('AI_RETIRED');return value;
 }
 const stamp=b=>JSON.stringify([b.sessionId,b.generation,b.expiresAt]);
 return {async call(action,body,signal){
  if(!channel.valid(action,body))throw channel.failure('AI_INVALID');prune();const admission=await current(signal);
  if(action==='proposals'&&proposals.size>=8)throw channel.failure('AI_UNAVAILABLE');
  if(!admission){if(action!=='context')throw channel.failure('AI_NOT_SUPPLIED');return {...binding,available:false,code:'AI_NOT_SUPPLIED'};}
  let proposal;
  if(action==='approve'){
   proposal=proposals.get(body.proposalId);proposals.delete(body.proposalId);
   if(!proposal||proposal.csrf!==body.csrf||proposal.expiresAt<=Date.now()||proposal.binding!==stamp(admission))throw channel.failure('AI_RETIRED');
  }
  const controller=new AbortController();pending.add(controller);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const timer=setTimeout(abort,Math.max(1,Math.min(120000,admission.expiresAt-Date.now())));timer.unref?.();
  try{
   if(controller.signal.aborted)throw channel.failure('AI_RETIRED');
   const result=await waitForReply(() => client.request(action,body,{signal:controller.signal}),controller.signal,action==='approve'?'AI_UNKNOWN':'AI_RETIRED');
   if(controller.signal.aborted)throw channel.failure(action==='approve'?'AI_UNKNOWN':'AI_RETIRED');
   const next=await current(signal);if(stamp(next)!==stamp(admission))throw channel.failure(action==='approve'?'AI_UNKNOWN':'AI_RETIRED');
   if(!result||typeof result!=='object'||Buffer.byteLength(JSON.stringify(result))>128*1024)throw channel.failure();
   if(action==='context'){
    if(typeof result.csrf!=='string'||result.csrf.length>256||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now())throw channel.failure();
    return {...binding,available:true,sessionId:admission.sessionId,csrf:result.csrf,expiresAt:Math.min(admission.expiresAt,result.expiresAt),configuredModel:typeof result.configuredModel==='string'?result.configuredModel:null};
   }
   if(action==='proposals'){
    prune();
    if(result.prompt!==body.prompt||result.context!==body.context||typeof result.proposalId!=='string'||result.proposalId.length>256||typeof result.csrf!=='string'||result.csrf.length>256||typeof result.model!=='string'||typeof result.wirePrompt!=='string'||Buffer.byteLength(result.wirePrompt)>8000||result.requestBytes!==Buffer.byteLength(result.wirePrompt)||result.contextBytes!==Buffer.byteLength(body.context)||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now()||result.expiresAt>admission.expiresAt||proposals.size>=8||proposals.has(result.proposalId))throw channel.failure();
    if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(result.model))throw channel.failure();
    const filtered={proposalId:result.proposalId,csrf:result.csrf,prompt:body.prompt,context:body.context,model:result.model,wirePrompt:result.wirePrompt,requestBytes:result.requestBytes,contextBytes:result.contextBytes,expiresAt:result.expiresAt,mode:body.mode||'plan'};
    proposals.set(filtered.proposalId,{...filtered,binding:stamp(admission)});return {...binding,...filtered};
   }
   if(result.model!==proposal.model||typeof result.text!=='string'||Buffer.byteLength(result.text)>65536||typeof result.conversationId!=='string'||!/^[a-f0-9-]{36}$/.test(result.conversationId)||result.applied!==false||result.signed!==false)throw channel.failure('AI_UNKNOWN');
   return {...binding,text:result.text,model:result.model,conversationId:result.conversationId,saved:result.saved===true,applied:false,signed:false,...(result.operation?{operation:publicReceipt(result.operation)}:{}),...(result.edit?{edit:result.edit}:{})};
  }catch(e){if(e.code==='AI_NOT_SUPPLIED'||e.code==='AI_RETIRED'||e.code==='AI_UNKNOWN')throw e;throw channel.failure(action==='approve'?'AI_UNKNOWN':'AI_UNAVAILABLE');}
  finally{clearTimeout(timer);pending.delete(controller);signal?.removeEventListener('abort',abort);}
 },close(){retired=true;proposals.clear();for(const c of pending)c.abort();pending.clear();}};
}

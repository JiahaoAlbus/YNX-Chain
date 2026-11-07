// Fixed preload consumer. No caller-selected transport, URL, Source or account.
// Missing APIs are unavailable; an IPC failure throws and is never an empty list.
export function createDesktopAgentDelegationsRenderer(api){
 const names={readProjection:'agentDelegationsRead',reviewDraft:'agentDelegationsDraft',reviewAction:'agentDelegationsAction',recoverOperation:'agentDelegationsRecover',cancelView:'agentDelegationsCancel'};
 const call=async(method,value)=>{const fn=api?.[names[method]];if(typeof fn!=='function'){if(method==='cancelView')return false;return {state:'unavailable'};}const reply=await (method==='readProjection'||method==='cancelView'?fn():fn(value));if(reply?.ok!==true)throw Object.assign(Error('Original Agent management request failed.'),{code:typeof reply?.error?.code==='string'?reply.error.code:'AGENT_MANAGEMENT_IPC_FAILED'});return reply.value;};
 return Object.freeze({readProjection:()=>call('readProjection'),reviewDraft:d=>call('reviewDraft',d),reviewAction:r=>call('reviewAction',r),recoverOperation:id=>call('recoverOperation',id),cancelView:()=>call('cancelView')});
}

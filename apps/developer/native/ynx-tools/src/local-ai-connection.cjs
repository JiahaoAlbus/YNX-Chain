const {randomUUID}=require('node:crypto');
function createLocalAIConnection(api,context,environment){
 let retired=false,launch;const active=new Set();
 const stopped=action=>Object.assign(Error(action==='approve'?'The remote outcome is unknown. This request will not be resent.':'The AI connection request has stopped.'),{code:action==='approve'?'AI_UNKNOWN':'AI_RETIRED'});
 context.subscriptions.push({dispose(){if(retired)return;retired=true;for(const cancel of [...active])cancel();}});
 function request(id,action,body,signal){
  return new Promise((resolve,reject)=>{
   let settled=false,dispatched=false;
   const finish=(failed,value)=>{if(settled)return;settled=true;active.delete(cancel);signal?.removeEventListener('abort',cancel);failed?reject(value):resolve(value);};
   const cancel=()=>{
    if(settled)return;finish(true,stopped(dispatched?action:'context'));
    // The original RPC may have lost its acknowledgement. Cancel that exact
    // request once, settle local waiting, and observe any late RPC outcome.
    if(dispatched)try{Promise.resolve(api.commands.executeCommand('ynx.internal.localAICancel',id)).catch(()=>{});}catch{}
   };
   active.add(cancel);signal?.addEventListener('abort',cancel,{once:true});
   if(retired||signal?.aborted){cancel();return;}
   dispatched=true;
   let reply;try{reply=api.commands.executeCommand('ynx.internal.localAICall',id,action,body);}catch(error){finish(true,error);return;}
   Promise.resolve(reply).then(value=>finish(false,value),error=>finish(true,error));
  });
 }
 return async function call(action,body={},signal){
  if(retired)throw Error('The AI connection has stopped.');signal?.throwIfAborted();
  const id=randomUUID();
  try{const value=await request(id,action,body,signal);signal?.throwIfAborted();
   if(retired||environment.YNX_WORKSPACE_MODE!=='local'||value?.projectId!==environment.YNX_LOCAL_PROJECT_ID||value.workspace!==environment.YNX_LOCAL_WORKSPACE||!/^[a-f0-9-]{36}$/.test(value.launch||'')||launch&&launch!==value.launch)throw Error('The AI project connection changed. Review again.');
   launch=value.launch;return value;
  }catch(error){ if(action==='approve')throw Object.assign(Error('The remote outcome is unknown. This request will not be resent.'),{code:'AI_UNKNOWN'}); throw error; }
 };
}
module.exports={createLocalAIConnection};

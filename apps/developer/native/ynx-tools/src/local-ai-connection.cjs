const {randomUUID}=require('node:crypto');
function createLocalAIConnection(api,context,environment){
 let retired=false,launch;context.subscriptions.push({dispose(){retired=true;}});
 return async function call(action,body={},signal){
  if(retired)throw Error('The AI connection has stopped.');signal?.throwIfAborted();
  const id=randomUUID(),abort=()=>{void api.commands.executeCommand('ynx.internal.localAICancel',id).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{const value=await api.commands.executeCommand('ynx.internal.localAICall',id,action,body);signal?.throwIfAborted();
   if(retired||environment.YNX_WORKSPACE_MODE!=='local'||value?.projectId!==environment.YNX_LOCAL_PROJECT_ID||value.workspace!==environment.YNX_LOCAL_WORKSPACE||!/^[a-f0-9-]{36}$/.test(value.launch||'')||launch&&launch!==value.launch)throw Error('The AI project connection changed. Review again.');
   launch=value.launch;return value;
  }catch(error){ if(action==='approve')throw Object.assign(Error('The remote outcome is unknown. This request will not be resent.'),{code:'AI_UNKNOWN'}); throw error; }finally{signal?.removeEventListener('abort',abort);}
 };
}
module.exports={createLocalAIConnection};

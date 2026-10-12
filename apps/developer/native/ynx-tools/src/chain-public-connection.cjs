const {randomUUID}=require('node:crypto');
const PUBLIC='ynx-code-chain-public/v1';
function createPublicConnection(api,context){
 let disposed=false;context.subscriptions.push({dispose(){disposed=true;}});
 async function call(action,params=[],signal){
  if(disposed)throw Error('Public Chain connection has stopped.');signal?.throwIfAborted();
  const id=randomUUID(),abort=()=>{void api.commands.executeCommand('ynx.internal.publicChainCancel',id).catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{const result=await api.commands.executeCommand('ynx.internal.publicChainRead',id,action,params);signal?.throwIfAborted();if(disposed)throw Error('Public Chain connection has stopped.');return result;}
  finally{signal?.removeEventListener('abort',abort);}
 }
 return async(project,{signal}={})=>{
  const binding=await call('current',[],signal);
  function valid(value){return value?.protocolVersion===PUBLIC&&value.projectId===project.projectId&&value.workspace===project.workspace&&typeof value.launch==='string'&&/^[a-f0-9-]{36}$/.test(value.launch)&&typeof value.sourceVersion==='string'&&value.sourceVersion.length>0&&value.sourceVersion.length<=160;}
  if(!valid(binding))throw Error('Public Chain host does not match this project.');
  return {protocolVersion:PUBLIC,access:'public-read',projectId:binding.projectId,workspace:binding.workspace,service:'https://developer.ynxweb4.com/runtime/chain',sourceVersion:binding.sourceVersion,
   async assertCurrent(){const next=await call('current',[],signal);if(!valid(next)||next.launch!==binding.launch||next.sourceVersion!==binding.sourceVersion)throw Error('Public Chain host changed.');},
   reader:{status:options=>call('status',[],options?.signal),compiler:options=>call('compiler',[],options?.signal),transaction:(hash,options)=>call('transaction',[hash],options?.signal),block:(id,options)=>call('block',[id],options?.signal),rpc(method,params,options){if(method!=='eth_getBalance'||!Array.isArray(params)||params.length!==2||params[1]!=='latest')throw Error('This public Chain operation is not allowed.');return call('balance',[params[0]],options?.signal);}}
  };
 };
}
module.exports={createPublicConnection};

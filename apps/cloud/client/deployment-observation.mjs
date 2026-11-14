import {YNXCloudDeploymentUnknownError,originalDeploymentReadSignal} from '../sdk/index.js';

const bind = b => b && [b.bytes,b.sha3_512,b.sha512];
const identity = op => JSON.stringify([op.requestId,op.deploymentId,op.resourceId,op.slotRevision,bind(op.contentBinding),bind(op.manifestBinding),op.manifestSHA256,op.approvalSHA256,op.runtimeUrl,op.runtimeKind,op.state,op.exitCode]);
export function assertSameDeploymentObservation(before,after){
  if(!before?.deploymentId||identity(before)!==identity(after))throw new YNXCloudDeploymentUnknownError(before?.requestId);
  return after;
}
export function assertOriginalDeploymentLogs(op,logs){
  if(!op.deploymentId||logs?.requestId!==op.requestId||logs.deploymentId!==op.deploymentId||logs.resourceId!==op.resourceId||logs.slotRevision!==op.slotRevision||JSON.stringify(bind(logs.contentBinding))!==JSON.stringify(bind(op.contentBinding)))throw new YNXCloudDeploymentUnknownError(op.requestId);
  return logs;
}
export async function readOriginalDeploymentRuntime(original,selection,check,{signal,originalRequestContext}={}){
  signal=originalDeploymentReadSignal(signal,originalRequestContext);
  if(signal?.aborted)throw signal.reason;
  const path=`/ide/deployments/${selection.requestId}/runtime`;
  const headers=await original.deploymentHeaders('GET',path,selection.requestId,{},signal,undefined,originalRequestContext);
  const op=check(await original.request(path,{headers,originalAuthorizationHeaders:headers,signal,retry:1,redirect:'error'}),selection);
  // This is a fresh control-plane observation of the original resource. It
  // neither fetches an untrusted project URL nor asserts public/DNS readiness.
  if(!op.deploymentId||!['running','completed','failed'].includes(op.state))throw new YNXCloudDeploymentUnknownError(selection.requestId);
  if(op.state==='completed'&&op.exitCode!==0)throw new YNXCloudDeploymentUnknownError(selection.requestId);
  if(op.state==='running'||op.state==='completed'){
    let url;try{url=new URL(op.runtimeUrl);}catch{throw new YNXCloudDeploymentUnknownError(selection.requestId);}
    if(!['https:','http:'].includes(url.protocol)||!url.host||url.username||url.password||url.search||url.hash)throw new YNXCloudDeploymentUnknownError(selection.requestId);
  }
  if(signal?.aborted)throw signal.reason;
  return op;
}
export async function inspectOriginalDeployment(client,selection,{signal,originalRequestContext}={}){
  signal=originalDeploymentReadSignal(signal,originalRequestContext);
  if(signal?.aborted)throw signal.reason;
  const runtime=await client.runtime(selection,{signal,originalRequestContext});
  const logs=await client.logs(selection,{signal,originalRequestContext});
  const usage=await client.usage(selection,{signal,originalRequestContext,observe:false});
  const final=await client.runtime(selection,{signal,originalRequestContext});
  assertSameDeploymentObservation(runtime,final);
  assertOriginalDeploymentLogs(final,logs);
  if(usage.instanceId!==final.deploymentId)throw new YNXCloudDeploymentUnknownError(selection.requestId);
  if(signal?.aborted)throw signal.reason;
  return {requestId:selection.requestId,operation:final,logs,usage,observation:'original-resource',publicReadiness:'NOT_ASSERTED',SourceAdmission:false};
}

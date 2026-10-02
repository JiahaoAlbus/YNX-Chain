import type { WalletConnectSessionApproval } from "@ynx-chain/wallet-auth";

type ApprovalStore=Readonly<{saveSession(approval:WalletConnectSessionApproval):Promise<void>;removeSession(topic:string):Promise<void>}>;
type ApprovalRuntime=Readonly<{refreshSessions():void;disconnect(topic:string):Promise<void>}>;
type RevocationStore=Readonly<{removeSession(topic:string):Promise<void>}>;

/** Persists local authorization before publishing the SDK session to UI. */
export async function persistAndPublishWalletConnectSession(runtime:ApprovalRuntime,store:ApprovalStore,approval:WalletConnectSessionApproval):Promise<void>{
  try{await store.saveSession(approval);runtime.refreshSessions()}
  catch(caught){await store.removeSession(approval.topic).catch(()=>{});await runtime.disconnect(approval.topic).catch(()=>{});throw caught}
}

/** Closes an SDK-approved session if its local authorization cannot be constructed. */
export async function createPersistAndPublishWalletConnectSession(runtime:ApprovalRuntime,store:ApprovalStore,topic:string,createApproval:()=>WalletConnectSessionApproval):Promise<void>{
  let approval:WalletConnectSessionApproval;
  try{approval=createApproval()}
  catch(caught){await runtime.disconnect(topic).catch(()=>{});throw caught}
  await persistAndPublishWalletConnectSession(runtime,store,approval);
}

/** Removes local authorization first and still attempts the remote disconnect. */
export async function revokeAndDisconnectWalletConnectSession(runtime:Pick<ApprovalRuntime,"disconnect">,store:RevocationStore,topic:string):Promise<void>{
  let failure:unknown=null;
  try{await store.removeSession(topic)}catch(caught){failure=caught}
  try{await runtime.disconnect(topic)}catch(caught){failure??=caught}
  if(failure)throw failure;
}

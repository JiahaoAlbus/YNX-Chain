import type { WalletConnectSessionApproval,WalletConnectSessionReview } from "@ynx-chain/wallet-auth";
import type { SessionTypes } from "@walletconnect/types";

type ApprovalStore=Readonly<{saveSession(approval:WalletConnectSessionApproval):Promise<void>;removeSession(topic:string):Promise<void>}>;
type ApprovalRuntime=Readonly<{refreshSessions():void;disconnect(topic:string):Promise<void>;quarantineSession(topic:string):void;releaseQuarantinedSession(topic:string):void;quarantinedTopics():readonly string[]}>;
type RevocationStore=Readonly<{removeSession(topic:string):Promise<void>}>;

/** Persists local authorization before publishing the SDK session to UI. */
export async function persistAndPublishWalletConnectSession(runtime:ApprovalRuntime,store:ApprovalStore,approval:WalletConnectSessionApproval,assertCurrent:()=>void=()=>{}):Promise<void>{
  try{assertCurrent();await store.saveSession(approval);assertCurrent();runtime.refreshSessions();assertCurrent()}
  catch(caught){await abortApprovedWalletConnectSession(runtime,store,approval.topic,caught)}
}

/** Closes an SDK-approved session if its local authorization cannot be constructed. */
export async function createPersistAndPublishWalletConnectSession(runtime:ApprovalRuntime,store:ApprovalStore,topic:string,createApproval:()=>WalletConnectSessionApproval,assertCurrent:()=>void=()=>{}):Promise<void>{
  let approval!:WalletConnectSessionApproval;
  try{approval=createApproval()}
  catch(caught){await abortApprovedWalletConnectSession(runtime,store,topic,caught)}
  await persistAndPublishWalletConnectSession(runtime,store,approval,assertCurrent);
}

/** Also used when the UI's final account-lease check fails after publication. */
export async function abortApprovedWalletConnectSession(runtime:ApprovalRuntime,store:ApprovalStore,topic:string,cause:unknown):Promise<never>{
  runtime.quarantineSession(topic);
  const failures=await cleanupFailedApproval(runtime,store,topic);
  if(failures.length)throw new AggregateError([cause,...failures],"WalletConnect approval failed and session cleanup is pending. Reopen WalletConnect to retry.");
  throw cause;
}

async function cleanupFailedApproval(runtime:ApprovalRuntime,store:ApprovalStore,topic:string):Promise<unknown[]>{
  const failures:unknown[]=[];
  try{await store.removeSession(topic)}catch(error){failures.push(error)}
  try{await runtime.disconnect(topic)}catch(error){failures.push(error)}
  if(!failures.length)runtime.releaseQuarantinedSession(topic);
  return failures;
}

/** A failed cleanup stays quarantined until both the local grant and SDK
 * session have been removed; closing/reopening the sheet cannot reauthorize it. */
export async function retryQuarantinedWalletConnectSession(runtime:ApprovalRuntime,store:ApprovalStore,topic:string):Promise<void>{
  if(!runtime.quarantinedTopics().includes(topic))throw new Error("WalletConnect session is not awaiting cleanup.");
  const failures=await cleanupFailedApproval(runtime,store,topic);
  if(failures.length)throw new AggregateError(failures,"WalletConnect session cleanup is still pending. Retry when secure storage and Relay are available.");
}

/** The SDK session is untrusted until it matches the exact peer and namespace
 * whose digest the user saw. Call before writing any local authorization. */
export function assertWalletConnectSessionMatchesReview(session:SessionTypes.Struct,review:WalletConnectSessionReview):void{
  const peer=session.peer;
  if(!/^[0-9a-f]{64}$/.test(session.topic)||!peer||peer.publicKey!==review.peer.publicKey||
    peer.metadata.name!==review.peer.metadata.name||peer.metadata.description!==review.peer.metadata.description||
    canonicalURL(peer.metadata.url)!==review.peer.metadata.url||
    JSON.stringify(peer.metadata.icons.map(canonicalURL))!==JSON.stringify(review.peer.metadata.icons))
    throw new Error("WalletConnect approved session peer differs from the reviewed proposal.");
  const canonical=(namespaces:SessionTypes.Namespaces)=>Object.fromEntries(Object.entries(namespaces).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,{
    accounts:[...(value.accounts??[])].sort(),chains:[...(value.chains??[])].sort(),
    methods:[...(value.methods??[])].sort(),events:[...(value.events??[])].sort(),
  }]));
  if(JSON.stringify(canonical(session.namespaces))!==JSON.stringify(canonical(review.namespaces as unknown as SessionTypes.Namespaces)))
    throw new Error("WalletConnect approved session permissions differ from the reviewed proposal.");
}

function canonicalURL(value:string):string{try{const parsed=new URL(value);if(parsed.protocol!=="https:"||parsed.username||parsed.password)return"";return parsed.href}catch{return""}}

/** Removes local authorization first and still attempts the remote disconnect. */
export async function revokeAndDisconnectWalletConnectSession(runtime:Pick<ApprovalRuntime,"disconnect">,store:RevocationStore,topic:string):Promise<void>{
  let failure:unknown=null;
  try{await store.removeSession(topic)}catch(caught){failure=caught}
  try{await runtime.disconnect(topic)}catch(caught){failure??=caught}
  if(failure)throw failure;
}

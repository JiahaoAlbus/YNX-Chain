import type { WalletConnectRuntime } from "./runtime";
import type { WalletConnectResponseRecord, WalletConnectSecurityStore } from "./securityStore";

type Runtime = Pick<WalletConnectRuntime,"snapshot">;
type Store = Pick<WalletConnectSecurityStore,"session"|"reconcileSession">;

export async function currentWalletConnectDelivery(runtime:Runtime,store:Store,record:WalletConnectResponseRecord,account:string,expectedPending:ReturnType<Runtime["snapshot"]>["request"]=null):Promise<boolean>{
  const approved=await store.session(record.topic);
  if(!approved||approved.sessionBinding!==record.sessionBinding||approved.account!==account)return false;
  const before=runtime.snapshot(),live=before.sessions.find(item=>item.topic===record.topic);
  if(before.phase!=="ready"||!live)return false;
  if(await store.reconcileSession(record.topic,live.namespaces,account)!=="current")return false;
  const after=runtime.snapshot();
  if(expectedPending&&after.request!==expectedPending)return false;
  if(!expectedPending&&after.request?.topic===record.topic&&after.request.id===record.requestId)return false;
  return after.phase==="ready"&&after.sessions===before.sessions&&after.sessionEvent?.revision===before.sessionEvent?.revision;
}

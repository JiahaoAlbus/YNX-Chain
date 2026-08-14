import { type AuthorizationRequest } from "@ynx-chain/wallet-auth";
import { PersistentAuthorizationCallbackStore } from "../protocol/authorizationCallbackStore";

export async function completePersistentAuthorizationCallbackHandoff(
  store:PersistentAuthorizationCallbackStore,request:AuthorizationRequest,account:string,now:()=>Date,assertActive:()=>void,
  createResponse:()=>Promise<string>,ensureApprovalIntent:()=>Promise<unknown>,openCallback:(url:string)=>Promise<unknown>,
  ensureReturnedAudit:()=>Promise<unknown>,complete:()=>void,
):Promise<void>{
  const responseURL=await store.prepare(request,account,createResponse,now,assertActive);
  await ensureApprovalIntent();assertActive();await openCallback(responseURL);
  await ensureReturnedAudit();await store.complete(request,responseURL);complete();
}

export async function rejectPersistentAuthorizationRequest(
  store:PersistentAuthorizationCallbackStore,request:AuthorizationRequest,account:string,now:()=>Date,assertActive:()=>void,
  ensureRejectedAudit:()=>Promise<unknown>,complete:()=>void,
):Promise<void>{await store.reject(request,account,now,assertActive);await ensureRejectedAudit();complete()}

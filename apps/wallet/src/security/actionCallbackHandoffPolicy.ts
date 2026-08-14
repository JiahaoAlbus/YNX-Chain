import { type ActionCallbackBinding, PersistentActionCallbackStore } from "../protocol/actionCallbackStore";

export async function completePersistentActionCallbackHandoff(
  store:PersistentActionCallbackStore,
  binding:ActionCallbackBinding,
  now:()=>Date,
  assertBeforeHandoff:()=>void,
  createResponse:()=>Promise<string>,
  openCallback:(responseURL:string)=>Promise<unknown>,
  complete:()=>void,
):Promise<void>{
  const responseURL=await store.prepare(binding,createResponse,now,assertBeforeHandoff);
  assertBeforeHandoff();
  await openCallback(responseURL);
  await store.complete(binding.key,responseURL);
  complete();
}

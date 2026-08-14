export async function completeAuthorizationCallbackHandoff(
  assertBeforeHandoff:()=>void,
  openCallback:()=>Promise<unknown>,
  recordSuccessfulHandoff:()=>Promise<unknown>,
  complete:()=>void,
):Promise<void>{
  assertBeforeHandoff();
  await openCallback();
  await recordSuccessfulHandoff();
  complete();
}

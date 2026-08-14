export async function unlockAccountFailClosed(
  reviewedAccount:string,
  authorizeBiometric:()=>Promise<void>,
  verifyAccountSecret:(account:string)=>Promise<void>,
  currentSelectedAccount:()=>string|null,
  assertActive:()=>void,
  unlock:(account:string)=>void,
):Promise<void>{
  await authorizeBiometric();
  assertActive();
  if(currentSelectedAccount()!==reviewedAccount)throw new Error("Selected Wallet account changed during unlock");
  await verifyAccountSecret(reviewedAccount);
  assertActive();
  if(currentSelectedAccount()!==reviewedAccount)throw new Error("Selected Wallet account changed before unlock completed");
  unlock(reviewedAccount);
}

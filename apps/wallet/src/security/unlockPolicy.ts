export async function unlockAccountFailClosed(
  reviewedAccount:string,
  authorizeBiometric:()=>Promise<void>,
  verifyAccountSecret:(account:string)=>Promise<void>,
  currentSelectedAccount:()=>string|null,
  unlock:(account:string)=>void,
):Promise<void>{
  await authorizeBiometric();
  if(currentSelectedAccount()!==reviewedAccount)throw new Error("Selected Wallet account changed during unlock");
  await verifyAccountSecret(reviewedAccount);
  if(currentSelectedAccount()!==reviewedAccount)throw new Error("Selected Wallet account changed before unlock completed");
  unlock(reviewedAccount);
}

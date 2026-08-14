export async function prepareRecoveryKeyDisplayFailClosed(
  protectScreen:()=>Promise<void>,
  assertActive:()=>void,
):Promise<void>{
  await protectScreen();
  assertActive();
}

export async function revealRecoverySecretFailClosed(
  protectScreen:()=>Promise<void>,
  authorizeBiometric:()=>Promise<void>,
  readSecret:()=>Promise<string>,
  assertActive:()=>void,
):Promise<string>{
  await protectScreen();
  assertActive();
  await authorizeBiometric();
  assertActive();
  const secret=await readSecret();
  assertActive();
  if(!/^[0-9a-f]{64}$/.test(secret))throw new Error("Wallet recovery key is invalid");
  return secret;
}

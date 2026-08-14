import { bytesToHex } from "@noble/hashes/utils.js";

export async function generateRecoveryKeyFailClosed(generate:()=>Promise<Uint8Array>,assertActive:()=>void):Promise<string>{
  const bytes=await generate();
  try{
    if(!(bytes instanceof Uint8Array)||bytes.length!==32)throw new Error("Wallet recovery-key entropy is invalid");
    assertActive();
    const recoveryKey=bytesToHex(bytes);
    assertActive();
    return recoveryKey;
  }finally{if(bytes instanceof Uint8Array)bytes.fill(0)}
}

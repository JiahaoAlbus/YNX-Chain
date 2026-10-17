import { walletIdentity } from "@ynx-chain/wallet-auth";
import type { WalletAccount } from "../storage/walletRepository";

export type RecoveryReview = Readonly<{kind:"invalid"}> | Readonly<{kind:"new";account:string}> | Readonly<{kind:"existing";account:WalletAccount}>;

/** Returns only public identity. The offline key never becomes review state. */
export function reviewRecoveryKey(secret:string,accounts:readonly WalletAccount[]):RecoveryReview {
  if(!/^[0-9a-fA-F]{64}$/.test(secret.trim()))return {kind:"invalid"};
  try{
    const identity=walletIdentity(secret.trim().toLowerCase());
    const existing=accounts.find(account=>account.account===identity.account&&account.accountPublicKey===identity.accountPublicKey);
    return existing?{kind:"existing",account:existing}:{kind:"new",account:identity.account};
  }catch{return {kind:"invalid"}}
}

export function needsOfflineKeyRecovery(error:string):boolean {
  return error.includes("This account's protected key is unavailable or biometric enrollment changed.")||error.includes("Protected Wallet key has no verified protection record; explicit offline recovery is required");
}

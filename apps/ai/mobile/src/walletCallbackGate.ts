// Check local custody before asking the server to consume the original Wallet
// response. Neither this gate nor local state creates a Wallet authorization.
export async function requireWalletCallbackReady(bootReady:Promise<void>,readDeviceSecret:()=>string,hasPendingRevocation:()=>Promise<boolean>){
 await bootReady;
 const deviceSecret=readDeviceSecret();
 if(!deviceSecret)throw Error('PRODUCT_DEVICE_KEY_NOT_READY');
 if(await hasPendingRevocation())throw Error('ORIGINAL_WALLET_REVOCATION_PENDING');
 return deviceSecret;
}

// Process-local duplicate suppression only. A digest is not an authority or
// durable outcome. Never evict a claim to make a lost response retryable.
export class OriginalWalletCallbackClaims{
 private seen=new Set<string>();
 reserve(digest:string){
  if(!/^[0-9a-f]{64}$/.test(digest))throw Error('WALLET_CALLBACK_DIGEST_INVALID');
  if(this.seen.has(digest))return false;
  if(this.seen.size>=64)throw Error('WALLET_CALLBACK_CLAIMS_FULL');
  this.seen.add(digest);return true;
 }
}

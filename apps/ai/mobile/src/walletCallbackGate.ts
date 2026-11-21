// Check local custody before asking the server to consume the original Wallet
// response. Neither this gate nor local state creates a Wallet authorization.
export async function requireWalletCallbackReady(bootReady:Promise<void>,readDeviceSecret:()=>string,hasPendingRevocation:()=>Promise<boolean>){
 await bootReady;
 const deviceSecret=readDeviceSecret();
 if(!deviceSecret)throw Error('PRODUCT_DEVICE_KEY_NOT_READY');
 if(await hasPendingRevocation())throw Error('ORIGINAL_WALLET_REVOCATION_PENDING');
 return deviceSecret;
}

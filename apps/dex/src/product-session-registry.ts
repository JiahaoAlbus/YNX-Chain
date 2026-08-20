// DEX-owned projection of Wallet/Auth registry 203be5e108be468350591615a64d5d36ab87a8f1.
// The root factory validates this binding and derives callbacks/routes itself.
export const dexProductSessionRegistry={
  schemaVersion:2,
  chainId:'ynx_6423-1',
  wallet:{authorizeCallback:'ynxwallet://authorize',downloadUrl:'https://www.ynxweb4.com/dapp/download',metaMaskDownloadUrl:'https://metamask.io/download'},
  products:[{
    productId:'dex',clientId:'ynx-dex-v1',displayName:'YNX DEX',applicationId:'com.ynxweb4.dex',webOrigin:'https://dex.ynxweb4.com',
    nativeCallback:'ynxdex://wallet-auth/callback',legacyCallbacks:['ynxdex','ynxdex://wallet-auth/callback'],
    scopes:['dex:account','dex:orders','dex:trade'],evmCompatible:true,sessionDurationSeconds:180,
  }],
} as const;

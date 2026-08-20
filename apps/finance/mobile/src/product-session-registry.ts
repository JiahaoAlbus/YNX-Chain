// Finance-owned, source-pinned projection of Wallet/Auth registry 203be5e108be468350591615a64d5d36ab87a8f1.
// The root factory validates every binding and derives callbacks/routes itself.
export const financeProductSessionRegistry={
  schemaVersion:2,
  chainId:'ynx_6423-1',
  wallet:{authorizeCallback:'ynxwallet://authorize',downloadUrl:'https://www.ynxweb4.com/dapp/download',metaMaskDownloadUrl:'https://metamask.io/download'},
  products:[{
    productId:'finance',clientId:'ynx-finance-v1',displayName:'YNX Finance',applicationId:'com.ynxweb4.finance',webOrigin:'https://finance.ynxweb4.com',
    nativeCallback:'ynxfinance://wallet-auth/callback',legacyCallbacks:['ynxfinance','ynxfinance://wallet-auth/callback'],
    scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],evmCompatible:true,sessionDurationSeconds:240,
  }],
} as const;

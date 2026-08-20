// Pay-owned source-pinned projection of Wallet/Auth 203be5e108be468350591615a64d5d36ab87a8f1.
// The accepted root factory owns the origin, routes, callback validation and session lifecycle.
export const payProductSessionRegistry={
  schemaVersion:2,
  chainId:'ynx_6423-1',
  wallet:{authorizeCallback:'ynxwallet://authorize',downloadUrl:'https://www.ynxweb4.com/dapp/download',metaMaskDownloadUrl:'https://metamask.io/download'},
  products:[{
    productId:'pay',clientId:'ynx-pay-v1',displayName:'YNX Pay',applicationId:'com.ynxweb4.pay',webOrigin:'https://pay.ynxweb4.com',
    nativeCallback:'ynxpay://wallet-auth/callback',legacyCallbacks:['ynxpay','ynxpay://wallet-auth/callback'],
    scopes:['account:read','pay:case:create','pay:route:select','pay:settlement:submit','pay:sponsorship:request'],evmCompatible:true,sessionDurationSeconds:180,
  }],
} as const;

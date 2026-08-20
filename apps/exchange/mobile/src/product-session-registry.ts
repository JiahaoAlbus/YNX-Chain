// Exchange-owned projection of Wallet/Auth registry 203be5e108be468350591615a64d5d36ab87a8f1.
// The root factory validates this binding and derives the callback and v2 routes.
export const exchangeProductSessionRegistry={
  schemaVersion:2,
  chainId:'ynx_6423-1',
  wallet:{authorizeCallback:'ynxwallet://authorize',downloadUrl:'https://www.ynxweb4.com/dapp/download',metaMaskDownloadUrl:'https://metamask.io/download'},
  products:[{
    productId:'exchange',clientId:'ynx-exchange-v1',displayName:'YNX Exchange',applicationId:'com.ynxweb4.exchange',webOrigin:'https://exchange.ynxweb4.com',
    nativeCallback:'ynxexchange://wallet-auth/callback',legacyCallbacks:['ynxexchange','ynxexchange://wallet-auth/callback'],
    scopes:['exchange:ai','exchange:deposit','exchange:read','exchange:trade','exchange:withdrawal-review'],evmCompatible:true,sessionDurationSeconds:180,
  }],
} as const;

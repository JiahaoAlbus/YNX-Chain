import {WALLET_AUTHORIZE_ROUTE} from '@ynx-chain/wallet-auth';

// Finance-owned, source-pinned projection of accepted Wallet/Auth source 46386ae8eeaa7633923ae762a5a9634b5eac98d9.
// The root factory validates every binding and derives callbacks/routes itself.
export const financeProductSessionRegistry={
  schemaVersion:3,
  chainId:'ynx_6423-1',
  wallet:{authorizeCallback:WALLET_AUTHORIZE_ROUTE,downloadUrl:'https://www.ynxweb4.com/dapp/download',metaMaskDownloadUrl:'https://metamask.io/download'},
  products:[{
    productId:'finance',clientId:'ynx-finance-v1',displayName:'YNX Finance',applicationId:'com.ynxweb4.finance',webOrigin:'https://finance.ynxweb4.com',
    platforms:['android','ios','macos','web','windows'],webApplicationId:'com.ynxweb4.finance.web',webCallback:'https://finance.ynxweb4.com/wallet-auth/callback',
    nativeCallback:'ynxfinance://wallet-auth/callback',legacyCallbacks:['ynxfinance','ynxfinance://wallet-auth/callback'],
    scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],evmCompatible:true,sessionDurationSeconds:240,retiredClients:[],
  }],
} as const;

/**
 * Finance's registered projection for canonical Wallet authorization.  This is
 * data for the accepted Wallet/Auth parser, not a second authorization
 * protocol and not a caller-configurable callback/origin surface.
 */
export const financeCanonicalAuthorizationRegistry={
  'ynx-finance-v1':{
    requestingProduct:'finance',
    bundleId:'com.ynxweb4.finance',
    callbacks:['ynxfinance://wallet-auth/callback'],
    scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],
    maxScopes:4,
  },
} as const;

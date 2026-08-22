import {WALLET_AUTHORIZE_ROUTE} from '@ynx-chain/wallet-auth';

// Exchange-owned projection of accepted Wallet/Auth source 46386ae8eeaa7633923ae762a5a9634b5eac98d9.
// The root factory validates this binding and derives the callback and v2 routes.
export const exchangeProductSessionRegistry={
  schemaVersion:3,
  chainId:'ynx_6423-1',
  wallet:{authorizeCallback:WALLET_AUTHORIZE_ROUTE,downloadUrl:'https://www.ynxweb4.com/dapp/download',metaMaskDownloadUrl:'https://metamask.io/download'},
  products:[{
    productId:'exchange',clientId:'ynx-exchange-v1',displayName:'YNX Exchange',applicationId:'com.ynxweb4.exchange',webOrigin:'https://exchange.ynxweb4.com',
    platforms:['android','ios','macos','web','windows'],webApplicationId:'com.ynxweb4.exchange.web',webCallback:'https://exchange.ynxweb4.com/wallet-auth/callback',
    nativeCallback:'ynxexchange://wallet-auth/callback',legacyCallbacks:['ynxexchange','ynxexchange://wallet-auth/callback'],
    scopes:['exchange:ai','exchange:deposit','exchange:read','exchange:trade','exchange:withdrawal-review'],evmCompatible:true,sessionDurationSeconds:180,retiredClients:[],
  }],
} as const;

/** Registered data supplied to the accepted canonical Wallet/Auth parser. */
export const exchangeCanonicalAuthorizationRegistry={
  'ynx-exchange-v1':{
    requestingProduct:'exchange',bundleId:'com.ynxweb4.exchange',callbacks:['ynxexchange://wallet-auth/callback'],
    scopes:['exchange:ai','exchange:deposit','exchange:read','exchange:trade','exchange:withdrawal-review'],maxScopes:5,
  },
} as const;

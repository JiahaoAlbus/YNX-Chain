/** DEX binding supplied only to the accepted canonical Wallet/Auth request parser. */
export const dexCanonicalAuthorizationRegistry={
  'ynx-dex-v1':{
    requestingProduct:'dex',bundleId:'com.ynxweb4.dex',origins:['https://dex.ynxweb4.com'],callbacks:['https://dex.ynxweb4.com/wallet-auth/callback'],
    scopes:['dex:account','dex:orders','dex:trade'],maxScopes:3,
  },
} as const;

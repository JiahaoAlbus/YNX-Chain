/** Registered data supplied to the accepted canonical Wallet/Auth parser. */
export const payCanonicalAuthorizationRegistry={
  'ynx-pay-v1':{
    requestingProduct:'pay',bundleId:'com.ynxweb4.pay',origins:['https://pay.ynxweb4.com'],callbacks:['ynxpay://wallet-auth/callback'],
    scopes:['account:read','pay:case:create','pay:route:select','pay:settlement:submit','pay:sponsorship:request'],maxScopes:5,
  },
} as const;

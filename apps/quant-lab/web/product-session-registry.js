// Quant-owned projection of accepted canonicalWalletAuthorize@1.0.0-p0.0.
// This is a parser allowlist, not a URI constructor or a Product Session registry.
export const quantWalletAuthorizationRegistry = Object.freeze({
  'ynx-quant-v1': Object.freeze({
    requestingProduct: 'quant',
    bundleId: 'com.ynxweb4.quant',
    origins: Object.freeze(['https://quant.ynxweb4.com']),
    callbacks: Object.freeze(['https://quant.ynxweb4.com/wallet-auth/callback']),
    scopes: Object.freeze(['quant:account', 'quant:mandate:create', 'quant:mandate:execute', 'quant:mandate:revoke']),
    maxScopes: 4,
  }),
});

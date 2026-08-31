# Quant Standard Wallet listener lifecycle checkpoint — 2026-08-31

## Change

Quant now removes `accountsChanged`, `chainChanged`, and `disconnect` handlers
when the user disconnects or switches providers.  Each handler also ignores a
provider that is no longer selected.  A stale injected provider therefore
cannot restore, change, or revoke Quant's Standard Wallet display after the
user chose disconnect.

The helper in `web/wallet-provider-lifecycle.js` owns listener lifetime only;
Provider discovery, connection state, chain validation and Product Session
boundaries remain consumed from the accepted Wallet/Auth package.

## Verification

```sh
npm test                         # 9/9
npm run test:browser             # 4/4 boundary tests
npm run build:wallet
npm run verify:canonical-authorize
```

Generated `web/wallet-auth.js` SHA-256:
`ebba4bb70e270327159d7d8db3bcc50e0ebc05456025edb318054cab69c4041b`.

## Truth boundary

This is source/build and local browser-boundary evidence only.  No public
runtime is source-bound and no actual Wallet approval/rejection, callback,
signature, EIP-712 request, Testnet order, strategy execution, WalletConnect
relay, installed-app flow, ComputerControl proof, or Product Session v2
lifecycle is claimed.

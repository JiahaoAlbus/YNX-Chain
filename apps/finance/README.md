# YNX Finance

YNX Finance is a read-only YNXT personal-finance product. It is not a bank, custodian, broker, adviser, lender, insurer, card product, or yield product.

## P0 Wallet Connectivity

Finance now consumes only the accepted standard Wallet Connection SDK and public endpoint manifest:

- Wallet transport/error contract: `p0-wallet-connection-v1`
- SDK: `@ynx/dapp-connect-sdk@0.1.0-p0.0`
- Endpoint manifest: `1.0.0-p0.2`, source `fa0ffd9bbbcc831438078be8e19cebff51b07e5e`
- Bundled manifest payload SHA-256: `3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5`

The Finance runtime does not generate a device key, handle the legacy Wallet authorization callback, call Gateway completion, mint a Product Session, or send an unaccepted Finance product API request. The manifest currently marks Finance as `PENDING`; the app preserves a successful standard wallet connection and reports private services as unavailable.

Old Wallet Auth vectors remain only as historical recovery evidence under `integration/wallet-auth/`; they are not a runtime integration path.

## Verification

```bash
npm test --prefix apps/finance
npm run security --prefix apps/finance
npm run smoke --prefix apps/finance
npm run check --prefix apps/finance/mobile
```

Do not describe local tests, unsigned/debug-signed builds, candidate artifacts, or a central handoff as a public deployment, hosted download, production signature, or store release. See `product-release.json` for current truthful state.

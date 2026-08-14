# Wallet Product Session Router v2 — Integration Handoff

## Outcome

This branch adds a central, fail-closed Product Session v2 protocol to `@ynx-chain/wallet-auth`. It does not change Wallet UI, native packaging declarations, or product business pages. It also does not claim that any product runtime, staging service, public service, signed package, or store release already uses v2.

The shared implementation is in:

- `packages/wallet-auth/src/product-session-registry.js`
- `packages/wallet-auth/src/product-session-v2.js`
- `packages/wallet-auth/src/product-session-proof-v2.js`
- `packages/wallet-auth/src/product-session-router.js`
- `packages/wallet-auth/src/product-session-recovery.js`
- `packages/wallet-auth/src/product-session-gateway.js`

## Frozen security contract

A v2 Session is valid only when all of these values remain exact: `chainId`, `productId`, `clientId`, `platform`, `applicationId`, platform-specific `bundleId` / `packageId`, `origin`, `callback`, `account`, `deviceId`, `deviceKey`, `nonce`, `state`, `scopes`, `issuedAt`, and `expiresAt`. macOS/iOS require `bundleId`; Android/Windows require `packageId`; Web requires both to be explicit `null` so a native identity cannot be smuggled into a Web session.

Wallet approval uses the selected account signature. The App Gateway, not the product, issues the one-time challenge. The exact product P-256 device signs that challenge. Every later Gateway call uses a fresh sender-constrained proof bound to method, path, body digest, device, product, origin, callback, account and a maximum sixty-second lifetime. Challenge, request, state and proof replay stores survive snapshot restore.

The recovery client refuses implicit browser/local storage. It accepts only an injected adapter labelled `hardware-backed` or `os-protected`, re-introspects a restored Session online, attempts one controlled reconnect after invalidation, and then requires explicit Retry. Offline state never treats the cached Session as authoritative.

## Deep-link and Wallet selection rules

The router opens only `ynxwallet://authorize?request=<base64url canonical JSON>`. It validates the exact registered scheme, host, path and sole query parameter before parsing. Product callbacks validate exact return target, nonce, state, expiry and signed approval. `javascript:`, `file:`, `data:` and `http:` downgrade paths are rejected.

The known legacy value `ynx-social` migrates only for the Social registration and becomes `ynx-social://com.ynx.social`. Unknown or cross-product legacy schemes fail with `UNKNOWN_LEGACY_SCHEME`. Known v1 requests can migrate only when their client, bundle, callback, device algorithm, chain and scopes match the same registry entry.

If YNX Wallet is installed, the first option is to open it. If absent, the shared choices include the verified official `https://www.ynxweb4.com/dapp/download` download center and MetaMask only for registrations marked EVM compatible. The earlier `/wallet` value was rejected because it redirects to an informational product page rather than the real download center. Guest / Try always carries the explicit limitations `not-signed-in`, `no-wallet-balance`, `no-transactions`, and `no-chain-authority`.

## Product migration truth

See `release/integration/wallet-product-session-router-migration.json`. All twelve requested products are registry-ready and pass the shared contract matrix. None is marked runtime-migrated because this task deliberately did not edit product pages or native packaging, and current source evidence still shows v1 or handwritten consumers. Integration must coordinate product-owner changes and installed/browser evidence before changing any `migrated` flag.

## Conflict avoidance

The initial worktree audit found active uncommitted work in the Wallet core/auth evidence branch and in Social/Pay product branches. This branch therefore did not edit:

- `packages/wallet-auth/integration/gateway-integration.manifest.json`
- `release/integration/wallet-auth-contract.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `internal/appgateway/gateway.go`
- `internal/appgateway/gateway_test.go`
- product Wallet adapters, business pages, or platform manifests

Integration should merge the scoped contract and matrix files, then reconcile v2 route hosting with the Wallet/Auth owner. Do not copy the old v1 Gateway manifest over this v2 contract and do not enable a product solely because it is present in the registry.

## Release boundary

The scoped implementation is preserved on `origin/codex/p0-wallet-protocol-integration-20260820`. Local implementation and automated tests prove only `implementedLocal`, `testedLocal`, and `pushedRemote`. Earlier public release-registry and artifact back-read evidence proves `downloadHosted` for the Android Testnet Preview only. Earlier ComputerControl evidence showed the macOS Wallet Companion's fail-closed `NO SUPPORTED WALLET DETECTED` state, real YNX Wallet and MetaMask choices, and no fabricated connection data; no supported installed Wallet completed approval and callback. `installedLocal`, `integratedCentral`, `deployedStaging`, `deployedPublic`, `productionSigned`, and `storeReleased` remain false for this merged candidate.

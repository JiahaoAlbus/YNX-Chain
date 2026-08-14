# Wallet Product Session Router v2 — Integration Handoff

## Outcome

This branch adds a central, fail-closed Product Session v2 protocol with Product Session Registry schema v2 to `@ynx-chain/wallet-auth`. Registry schema v2 adds the required, allowlisted MetaMask download route instead of silently changing schema v1. The only v1 registry compatibility path is the explicit deterministic `migrateProductSessionRegistryV1`; direct parsing of v1, unknown fields, or substituted download hosts fails closed. It does not change Wallet UI, native packaging declarations, or product business pages. It also does not claim that any product runtime, staging service, public service, signed package, or store release already uses v2.

The shared implementation is in:

- `packages/wallet-auth/src/product-session-registry.js`
- `packages/wallet-auth/src/product-session-v2.js`
- `packages/wallet-auth/src/product-session-proof-v2.js`
- `packages/wallet-auth/src/product-session-router.js`
- `packages/wallet-auth/src/product-session-recovery.js`
- `packages/wallet-auth/src/product-session-gateway.js`
- `packages/wallet-auth/src/product-session-gateway-client.js`
- `packages/wallet-auth/src/product-session-gateway-http.js`

## Frozen security contract

A v2 Session is valid only when all of these values remain exact: `chainId`, `productId`, `clientId`, `platform`, `applicationId`, platform-specific `bundleId` / `packageId`, `origin`, `callback`, `account`, `deviceId`, `deviceKey`, `nonce`, `state`, `scopes`, `issuedAt`, and `expiresAt`. macOS/iOS require `bundleId`; Android/Windows require `packageId`; Web requires both to be explicit `null` so a native identity cannot be smuggled into a Web session.

Wallet approval uses the selected account signature. The App Gateway, not the product, issues the one-time challenge. The client validates that every challenge field matches the exact request and approval before the exact product P-256 device signs it locally. The device secret is never passed to the Gateway adapter. Every later Gateway call uses a fresh locally signed sender-constrained proof bound to method, path, body digest, device, product, origin, callback, account and a maximum sixty-second lifetime. Challenge, request, state and proof replay stores survive snapshot restore.

The recovery client refuses implicit browser/local storage. It accepts only an injected adapter labelled `hardware-backed` or `os-protected`, re-introspects a restored Session online, attempts one controlled reconnect after confirmed invalidation, and then requires explicit Retry. `ProductSessionGatewayFetchAdapter` accepts only a canonical HTTPS origin, canonical JSON, bound request IDs, `no-store` responses and the v2 proof header; it has no local/canned fallback. `ProductSessionGatewayHttpHandler` is the matching host-neutral HTTP boundary and can be mounted by Integration without changing the actively owned legacy Node host. It rejects noncanonical or oversized bodies, wrong media types, malformed proof headers and unavailable dependencies with canonical request-ID-bound errors. A typed Gateway network failure preserves the protected Session as non-authoritative and Retry re-introspects it instead of forcing a new approval. If the network fails after Wallet approval, the exact validated callback is retained in protected storage and can resume after restart.

Gateway schema v2 persists idempotent responses for Challenge and Complete. The client derives stable request IDs from the pending nonce/state. If a response is lost after the Gateway commits, an identical retry returns the exact cached challenge or Session across restart; reuse of that request ID with another route or body fails with `IDEMPOTENCY_CONFLICT`. Revoked, expired, malformed, or binding-mismatched state is still removed fail closed. Gateway snapshot v1 requires the explicit `migrateProductSessionGatewaySnapshotV1` path.

## Deep-link and Wallet selection rules

The router opens only `ynxwallet://authorize?request=<base64url canonical JSON>`. It validates the exact registered scheme, host, path and sole query parameter before parsing. Product callbacks validate exact return target, nonce, state, expiry and signed approval. `javascript:`, `file:`, `data:` and `http:` downgrade paths are rejected.

The known legacy value `ynx-social` migrates only for the Social registration and becomes `ynx-social://com.ynx.social`. Unknown or cross-product legacy schemes fail with `UNKNOWN_LEGACY_SCHEME`. Known v1 requests can migrate only when their client, bundle, callback, device algorithm, chain and scopes match the same registry entry.

If YNX Wallet is installed, the first option is to open it. If absent, the shared choices include the verified official `https://www.ynxweb4.com/dapp/download` download center and MetaMask only for registrations marked EVM compatible. An EVM-compatible product still shows a real `https://metamask.io/download` option when MetaMask is missing; when detected, the same choice becomes an `open-evm` action. Both URLs are pinned by the registry parser's official allowlist. The earlier `/wallet` value was rejected because it redirects to an informational product page rather than the real download center. Guest / Try always carries the explicit limitations `not-signed-in`, `no-wallet-balance`, `no-transactions`, and `no-chain-authority`.

## Product migration truth

See `release/integration/wallet-product-session-router-migration.json`. All twelve requested products are registry-ready and pass the shared contract matrix. None is marked runtime-migrated because this task deliberately did not edit product pages or native packaging, and current source evidence still shows v1 or handwritten consumers. The migration test now rejects missing evidence paths and requires distinct runtime, Gateway v2 route, and visible platform evidence before any `migrated-v2` claim. The Pay entry was corrected to `contract-only` because its previously cited runtime file does not exist on this branch. Integration must coordinate product-owner changes and installed/browser evidence before changing any `migrated` flag.

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

The scoped implementation is preserved on `origin/codex/p0-wallet-protocol-integration-20260820`. Local implementation and automated tests prove only `implementedLocal`, `testedLocal`, and `pushedRemote`. Earlier public release-registry and artifact back-read evidence proves `downloadHosted` for the Android Testnet Preview only. Earlier ComputerControl evidence showed the macOS Wallet Companion's fail-closed `NO SUPPORTED WALLET DETECTED` state, real YNX Wallet and MetaMask choices, and no fabricated connection data. It also observed an enabled MetaMask 13.42.0 Chrome extension, but the control pipe closed before any product connection or approval; installation evidence is not Session evidence. No installed YNX Wallet completed a flow and no product runtime is migrated to v2. `installedLocal`, `integratedCentral`, `deployedStaging`, `deployedPublic`, `productionSigned`, and `storeReleased` remain false for this merged candidate.

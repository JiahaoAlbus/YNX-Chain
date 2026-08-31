# Wallet Product Session Router v2 — Integration Handoff

## 2026-08-20 authoritative checkpoint

Central acceptance `3c6288e1aa3d1ea6735b13db24bdfc6419f25c76` proves Wallet/Auth runtime source `6cf3ef845202bd879ed94515a71b323dd2fc9e14` is active at `https://wallet-auth.ynxweb4.com`. The public five-route lifecycle, real service restart, replay rejection, session revoke, device revoke, registered CORS and fail-closed origin/header/method/path/query matrix passed. Website acceptance `907bce373effc529d1ca9cb0b5374135ccb00b27` proves the official apex and www runtime record is published. Exact HTTP/Bytes/SHA, rollback, request IDs and state-isolation evidence are in `release/integration/wallet-product-session-v2-public-deployment-evidence.json`.

A 2026-08-20T14:30:01Z read-only continuation check again observed exact source `6cf3ef845202bd879ed94515a71b323dd2fc9e14`, matching health/ready/version bytes and SHA-256, registered Finance Origin OPTIONS `204`, and attacker Origin OPTIONS `403`. The first local TLS handshake failed before HTTP and a bounded retry recovered; this is recorded without changing the prior lifecycle claim in `release/integration/wallet-product-session-router-continuation-evidence-20260820.json`.

This promotes only the public Wallet/Auth Gateway, Product Session v2 public lifecycle and Website runtime record. Product migration remains `0/12`; installed Wallet approval, account/signing/transaction, public Chain-disconnect Retry, public expiry, ComputerControl, aggregate deployment, production signing and store release remain false. The historical 6441/37f deployment narrative below is retained only as superseded recovery history.

The final architecture is two-layered. Integration accepted the Gateway-independent Standard Wallet Connection protocol at `66003e76e804da16d472255efde50cb879055b96` and the Developer-owned consumer SDK at `315897e75c0ffe3e63435fe73cfec42244b851cc`. Product Session is only an optional enhancement for first-party private services: if it fails, the standard Wallet connection stays connected and the private YNX service becomes explicitly degraded. No local or canned Product Session may be created. Those accepted source contracts do not prove that any product has consumed them or that installed YNX Wallet / other-wallet / WalletConnect interoperability has passed.

## Outcome

This branch adds a central, fail-closed Product Session v2 protocol with Product Session Registry schema v2 to `@ynx-chain/wallet-auth`. Registry schema v2 adds the required, allowlisted MetaMask download route instead of silently changing schema v1. The only v1 registry compatibility path is the explicit deterministic `migrateProductSessionRegistryV1`; direct parsing of v1, unknown fields, or substituted download hosts fails closed. It does not change Wallet UI, native packaging declarations, or product business pages. The shared Gateway is now public as recorded above, but no product runtime, signed package or store release is inferred from that fact.

The shared implementation is in:

- `packages/wallet-auth/src/product-session-registry.js`
- `packages/wallet-auth/src/product-session-v2.js`
- `packages/wallet-auth/src/product-session-proof-v2.js`
- `packages/wallet-auth/src/product-session-router.js`
- `packages/wallet-auth/src/wallet-provider-discovery.js`
- `packages/wallet-auth/src/wallet-connection-coordinator.js`
- `packages/wallet-auth/src/metamask-evm-adapter.js`
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

If YNX Wallet is installed, the first option is to open it. If absent, the shared choices include the verified official `https://www.ynxweb4.com/dapp/download` download center and MetaMask only for registrations marked EVM compatible. An EVM-compatible product still shows a real `https://metamask.io/download` option when MetaMask is missing; when detected, the same choice becomes an `open-evm` action. Both URLs are pinned by the registry parser's official allowlist. The earlier `/wallet` value was rejected because it redirects to an informational product page rather than the real download center.

Products must obtain those availability flags through the narrow browser-safe `@ynx-chain/wallet-auth/wallet-provider-discovery` entry instead of copying provider heuristics. It combines EIP-6963 announcements with legacy injected EIP-1193 providers, de-duplicates the same object, recognizes YNX only when both its explicit flag and an exact central RDNS allowlist match, and never trusts a substring such as `com.ynx.wallet.attacker`. YNX is preferred when exactly one candidate exists. Multiple distinct providers of the same kind, a duplicate announcement UUID mapped to different objects, conflicting YNX/MetaMask flags, hostile getters and malformed metadata all fail closed without automatic selection. Discovery is explicitly `unverified-injected-candidate`; it proves only that a provider candidate was injected, never Wallet identity, account authority, Product Session, balance or Chain state. `walletAvailabilityFromDiscovery` is the sole adapter into `walletConnectionChoices`.

Product runtimes must use the narrow `@ynx-chain/wallet-auth/wallet-connection-coordinator` entry as the common connection boundary. `WalletConnectionCoordinator` composes provider discovery, native platform installation/scheme probing, `RecoverableProductSessionClient`, registered deep-link routing, and the EVM-only MetaMask adapter. It merges native and injected availability, always gives YNX Wallet priority, and opens only the canonical registered request with request ID `req_ps_open_<nonce>`. Platform open attempts time out fail closed after a configured 10–30000 milliseconds. A restored invalid Session may perform at most one controlled automatic Wallet open; later attempts require explicit Retry. Wallet-not-installed, scheme-not-registered, network-unavailable, user-rejected and open-timeout states remain actionable. Invalid probe fields, platform exceptions, cross-product clients and fake recovery-client objects fail closed. No path creates a local/canned Product Session, and MetaMask remains available only to EVM-compatible registrations.

`MetaMaskEvmConnectionAdapter`, also available through the narrow `@ynx-chain/wallet-auth/metamask-evm` entry, makes `open-evm` executable through the selected explicit MetaMask EIP-1193 provider. It reads the real chain, switches to canonical chain quantity `0x1917` only when needed, re-reads the chain, requests real accounts, and rejects malformed provider responses. If MetaMask returns 4902, the adapter offers the fixed central YNX Testnet registration (`https://evm.ynxweb4.com`, `https://explorer.ynxweb4.com`) through `wallet_addEthereumChain`, then explicitly switches and re-reads chain 6423; callers cannot inject another RPC, explorer, currency, or chain identity. Both public endpoints and the RPC `eth_chainId=0x1917` response were reverified before freezing this recovery path. A 4001 rejection, unavailable provider, disconnected provider, refused add/switch, wrong post-switch chain, or invalid address fails closed with an actionable SDK error. Its result is explicitly `evm-only` with `authority: eip-1193-provider-only`, `ynxProductSession: false`, and `productSession: null`. MetaMask therefore cannot substitute for YNX Product Session, YNX Wallet account authority, Wallet AI Gateway answers, balances, or transactions.

Guest / Try always carries the explicit limitations `not-signed-in`, `no-wallet-balance`, `no-transactions`, and `no-chain-authority`.

## Product migration truth

See `release/integration/wallet-product-session-router-migration.json`. All twelve requested products are registry-ready and pass the shared contract matrix. None is marked runtime-migrated because current source evidence still shows v1, handwritten or contract-only consumers. Social now has a tested canonical Android/native launcher preflight and the shared `encodeRequestDeepLink` builder, but its request, callback and completion remain v1, so it is classified `canonical-launcher-v1` rather than migrated. The migration test rejects missing evidence paths and requires runtime use of `createProductWalletConnection`, distinct Gateway v2 route evidence, and visible platform evidence before any `migrated-v2` claim. Lower-level provider discovery, MetaMask, standard EIP-1193, or recovery-client use alone is insufficient.

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

The scoped branch is pushed to `origin/codex/wallet-session-router-recovery`. Source `6cf3ef845202bd879ed94515a71b323dd2fc9e14` is publicly active for Wallet/Auth v1+v2, and Website source `a7313313014bb8792f38e649e9f556dbee983c8c` publishes its accepted record. This is narrower than aggregate `deployedPublic`, which remains false because no product runtime is migrated and the installed-client visible matrix is incomplete. Prior MetaMask, Android and browser observations remain partial evidence only; the current Mac Computer Use channel is unavailable, so no approval, callback, account, signing, transaction or Product Session visible success is claimed.

## Historical public routing evidence (superseded)

The following 2026-08-14 6441/37f record is retained for rollback history. It is not the current public source or origin; the authoritative current checkpoint is the 6cf3 Wallet/Auth deployment above.

On 2026-08-14, a state-free negative probe reached the public App Gateway at `https://rest.ynxweb4.com`. `GET /app/health` returned HTTP 200 for `ynx-app-gatewayd` and reported its legacy Wallet upstream as reachable and remotely deployed. An invalid canonical `{}` control request to `POST /v1/wallet/sessions/complete` reached the legacy Wallet Gateway and returned its schema-version-1 fail-closed response with HTTP 400.

Before deployment, the corresponding request to `POST /v2/product-sessions/challenge` did **not** reach `ProductSessionGatewayHttpHandler`. It fell through to the Chain JSON-RPC catch-all and returned HTTP 200 with JSON-RPC error `-32601`, without the required Product Session schema version, request-ID echo, or fail-closed HTTP status. That historical evidence remains in `packages/wallet-auth/evidence/product-session-v2-public-route-probe-20260814.json` and is explicitly superseded by the deployment evidence.

The independent deployment now mounts the five exact `/v2/product-sessions/*` routes ahead of the Chain RPC fallback, persists the Product Session Gateway schema-version-2 snapshot atomically, and retains revocation, proof-replay and idempotency state across restart. Its candidate, rollback and cryptographic lifecycle gates passed. Real installed Wallet approval/device completion, product migration, network-loss and explicit-Retry acceptance still require product/platform evidence; the cryptographic deployment verifier reports `visibleWalletApproval: false` and does not substitute for that evidence.

`packages/wallet-auth/scripts/probe-product-session-v2-public.mjs` is the state-free route-mount release gate. It sends only invalid canonical `{}` with one stable request ID, retries transport failures at most three times, bounds the response at 64 KiB, and requires the exact schema-version-2 HTTP 400 rejection with request-ID echo and `Cache-Control: no-store`. Its seven deterministic tests pass, and the production deployment gate passed. A passing mount probe proves only that the handler is reachable; it cannot replace the full lifecycle acceptance above.

The deployable v2 runtime is isolated from the actively owned legacy Gateway. `ProductSessionGatewayNodeHost` and `ynx-product-session-gatewayd.mjs` persist the schema-version-2 snapshot before a response is released, bind it to exact registry and snapshot SHA-256 values, serialize mutations, require a service-owned mode-0700 directory and mode-0600 state file, and reject state tamper or missing remote build identity. Dedicated tests cover restart lifecycle recovery, 100 concurrent persisted rejections, build identity, tamper rejection, idempotent response-loss recovery, proof replay, revoke and post-revoke rejection.

`scripts/deploy/deploy-product-session-v2-testnet.sh` packages an exact clean commit and invokes the protected remote installer. The installer uses candidate port 17441, installs the independent production service on loopback port 6441, adds only the exact `/v2/product-sessions/*` Caddy route before the Chain fallback, and never replaces ports 6437 or 6439. Its mandatory rollback-drill mode restores Caddy, systemd, environment and dedicated v2 state, then verifies the legacy App and Wallet Gateways remained active. Deploy mode must pass the public mount gate and cryptographic lifecycle verifier or roll back.

The first public source `cc6c393608a11022f8617eede753af4c578d0ecd` was superseded after a production negative test showed that a runtime `0644` state-file permission change was silently replaced by the next atomic write. Hardened source `d26ed915516c97d07cb4d58e5fc4646486afc851` validates the authoritative on-disk state before every administrative or protocol request and again before persistence; any permission, owner, link, registry or snapshot change marks the process not ready before protocol mutation.

The hardened upgrade rollback drill and public deployment passed. The rollback evidence directory is `/var/backups/ynx-chain/product-session-v2-ynx-product-session-v2-d26ed915516c-rollback-drill-20260814T121756Z`; it restored the previous cc6 unit, environment, state and public route before the final upgrade. The retained deployment evidence directory is `/var/backups/ynx-chain/product-session-v2-ynx-product-session-v2-d26ed915516c-deploy-20260814T121833Z`. On the production host, changing the state file to `0644` caused HTTP 503 `INSECURE_STATE_FILE`; state SHA-256 remained identical, the mode was not silently repaired, and the process required explicit permission repair plus restart. After recovery, the exact hardened source, public mount, complete cryptographic lifecycle, mode `0600`, all services and route ordering passed again. This proves the shared v2 Gateway is publicly reachable, restart-persistent and fail-closed for the tested runtime permission tamper; it does not prove installed Wallet approval or any product runtime migration. The independent 6441 mount also does not claim that the actively owned legacy 6437 App Gateway or 6439 Wallet Gateway binaries were replaced.

The next upgrade intentionally absorbed the shared Core/Auth state-integrity contract and pinned the authoritative file device and inode across requests. Exact source `37f2485ed604d88ed1457bc497d50f3f7a037469` passed a rollback drill that restored d26, then passed the final deployment transaction. A controlled production restart returned the exact same 1,122-byte completion response for the same request ID and body before and after restart, then revoked the test Session and rejected a fresh proof with `SESSION_REVOKED`. Production Caddy/SNI tests for mode `0644`, symlink, hardlink, same-byte inode replacement and snapshot-digest mismatch each returned HTTP 503 with the required error and zero attacker-artifact mutation; explicit repair and a 6441-only restart recovered the exact source after every vector. The final public mount and full lifecycle passed, while 6437, 6439 and Caddy remained active and unchanged in ownership scope.

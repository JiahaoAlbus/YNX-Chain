# YNX DEX handoff

## Release identity and boundary

- Product: independent `YNX DEX`, Testnet Preview `0.1.0-testnet-preview.1`
- Branch: `codex/ecosystem-dex`
- Chain: YNX Testnet chain `6423` (`0x1917` for EVM compatibility); `mainnet=false`
- Protocol: authoritative chain-native constant-product pool, 30 bps pool fee, signed action envelopes and indexed market history; the clean-room EVM contracts remain build artifacts
- Custody: none. The Web app prepares requests; canonical YNX Wallet must authorize and sign.
- Public boundary: Web/PWA, read API and same-origin canonical Wallet Gateway are deployed at `https://dex.ynxweb4.com`; the active market/indexer release is `ynx-dex-b72e19389311`.
- Public Testnet market: labelled `YNXT/YUSDT` pool `dex_ynxt_yusdt`, add/remove liquidity, exact-input/output swaps, transaction history and candles are active and four-node replicated.
- Explicitly absent: mainnet or production liquidity, verified public EVM DEX contracts, hosted download, production signature, store release and independent audit.

YNX Exchange remains the operator/custody/order-book product. Do not merge DEX balances, routes or transaction semantics into Exchange.

## Delivered surfaces

- `contracts/dex`: versioned factory, immutable pool, bounded router, read-only quoter, adversarial test tokens and integration runner.
- `sdk/dex`: strict ESM SDK for token/pool parsing, deterministic exact-in/out routing, slippage, price impact, freshness and transaction builders.
- `internal/dex` and `cmd/ynx-dex-indexerd`: HMAC-protected event state, confirmed EVM poller, reorg rewind/rescan, public read API, protected positions API and strict token-list API.
- `apps/dex`: responsive Web/PWA with Swap, Pools, Pool Detail, Add/Remove Liquidity, Positions boundary, Explore/Tokens/Transactions, Analytics, Governance, Docs and Settings.
- AI risk explanation: context selection, explicit permission, same-origin canonical-gateway enforcement, provider/model/status/cost, strict NDJSON streaming/cancel, review, local apply/reject and SHA-256 hash-chained browser audit. It cannot build, sign, submit or mutate a transaction.
- `release/dex`: deterministic upload-ready PWA tarball and per-file/SHA-256 manifest. That downloadable archive remains unsigned and unhosted; the separately attested Web/API release is public.

## Canonical Wallet/Auth candidate

Candidate file: `apps/dex/wallet-client.json`.

- `productClientId`: `ynx-dex-web-v1`
- `bundleId`: `com.ynxweb4.dex.web`
- callback: `https://dex.ynxweb4.com/wallet-auth/callback`
- scopes: `account:read`, `dex:positions:read`, `dex:transaction:request`
- required device algorithm: `p256-sha256`

The adapter binds the exact client, bundle, callback, chain, scopes, nonce, digest and expiry and rejects substitutions. Positions call central introspection and fail closed when it is missing. The client is enabled in the public canonical Gateway release `ynx-wallet-gateway-476cdcc6bf35`, and DEX exposes that Gateway only through the same-origin `/wallet-gateway/*` proxy. A fresh public lifecycle completed a Product Session, loaded private positions, rejected proof replay, revoked the session and rejected access after revocation.

Registry acceptance, replay, expiry, scope escalation, callback substitution, cross-product reuse and device-binding tests are complete. A browser can start the real Wallet deep link and the Gateway accepts this exact product tuple. The public market is executable. The earlier Wallet session proof remains valid evidence for login, positions, replay rejection and revocation; the recorded market lifecycle used ephemeral in-memory Testnet signing keys and does not claim that an installed-Wallet transaction callback was exercised.

## Runtime configuration

Copy `.env.dex.example` outside the repository. Generate independent secrets for state HMAC and trusted ingestion. The active Testnet deployment sets `YNX_DEX_NATIVE_REST_URL=http://127.0.0.1:6420`; the installer refuses a competing `DEX_FACTORY_ADDRESS`. Tokens, pools and events are read from the authoritative chain-native registry. EVM mode remains mutually exclusive and requires a verified factory, exact start block, positive confirmations and a private cursor path.

The poller checks chain 6423, scans only confirmed bounded ranges, discovers pools from `PoolCreated`, correlates LP `Transfer` with Mint/Burn, decodes Swap/Sync/fees, persists an HMAC cursor and rewinds/rescans when the previously confirmed block hash changes. Never lower confirmations or edit signed state to bypass a conflict.

## Verification

```bash
npm ci
npm run hardhat:build
npm run dex:contracts:test
npm test --prefix sdk/dex
go test -race ./internal/dex ./cmd/ynx-dex-indexerd
npm ci --prefix apps/dex
npm run build --prefix apps/dex
npm test --prefix apps/dex
npm run test:e2e --prefix apps/dex
npm run dex:manifests:check
npm run dex:package:all
npm run dex:artifacts:verify
```

The contract runner includes direct/multi-hop exact-in/out, LP add/remove, protocol fee, oracle progression/manipulation, 100 arithmetic differential vectors, deadlines/slippage, four-hop cap, delayed governance, malicious reentrancy, taxed input rollback, negative rebase sync rejection, extreme ratios and reserve overflow. Go race tests include restart/tamper/replay/concurrency, strict HTTP auth and a fake-EVM confirmed scan/restart/reorg recovery. Sixteen Web unit/integration tests cover Wallet binding, 12-locale/RTL shell, deterministic quotes and AI failures/stream/audit; ten Chromium E2E project cases pass and two project-inapplicable cases skip across desktop/mobile flows, offline Service Worker cold reload and visual evidence.

## Testnet deployment gate

The initial Web/API/Gateway release remains recorded in `docs/evidence/dex/public-web-api-wallet-2026-08-11.json`. The current market is proven separately by:

- `docs/evidence/dex/native-public-lifecycle-2026-08-11.json`: seven committed chain actions, one labelled asset and pool, LP add/remove, two swap modes, index history and candles.
- `docs/evidence/dex/chain-native-four-node-rollout-2026-08-11.json`: identical binary digest on four nodes, durable state, follower snapshot hash checks and matching pool audit hash.
- `docs/evidence/dex/native-market-capacity-2026-08-11.json`: loopback and independent-region public TLS probes, each 1000/1000 at concurrency 64.

This evidence enables the Testnet market flags only. It does not enable mainnet, production liquidity, audited-contract or installed-Wallet transaction-callback claims.

## Release truth

`product-release.json` is authoritative. `deployedPublic=true`, `marketSourceConfigured=true`, `marketAvailable=true`, `executionAvailable=true`, `publicAssetMovementVerified=true` and `testnetLiquidity=true` now refer to the evidence above. `productionLiquidity` remains false. The upload/download artifact remains a local unsigned candidate, so its artifact manifest correctly keeps `deployedPublic=false`. `installedLocal`, `deployedStaging`, `downloadHosted`, `productionSigned`, `storeReleased` and `audited` remain false.

The runtime dependency audit is clean for production dependencies. The development-only Hardhat graph currently includes the documented `adm-zip` high-severity crafted-ZIP denial-of-service advisory with no upstream fix; keep contract tooling out of runtime images and reassess before an owner release.

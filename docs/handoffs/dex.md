# YNX DEX handoff

## Release identity and boundary

- Product: independent `YNX DEX`, Testnet Preview `0.1.0-testnet-preview.1`
- Branch: `codex/ecosystem-dex`
- Chain: YNX Testnet EVM chain `6423` (`0x1917`); `mainnet=false`
- Protocol: clean-room immutable constant-product pools, 30 bps pool fee, bounded four-hop router
- Custody: none. The Web app prepares requests; canonical YNX Wallet must authorize and sign.
- Public boundary: Web/PWA, read API and same-origin canonical Wallet Gateway are deployed at `https://dex.ynxweb4.com` from release `ynx-dex-9b3ed30a6a21`.
- Explicitly absent: verified DEX contracts, reviewed Testnet tokens, an indexed public pool, executable swaps/liquidity, hosted download, production signature, store release and independent audit.

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

Registry acceptance, replay, expiry, scope escalation, callback substitution, cross-product reuse and device-binding tests are complete. A browser can start the real Wallet deep link and the Gateway accepts this exact product tuple. Asset actions remain unavailable because no authoritative public market source or pool exists; enabling the client is not evidence of a swap.

## Runtime configuration

Copy `.env.dex.example` outside the repository. Generate independent secrets for state HMAC and trusted ingestion. The EVM poller additionally requires a verified `DEX_FACTORY_ADDRESS`, exact `DEX_INDEXER_START_BLOCK`, positive confirmations and a private cursor path. The token file defaults to `token-lists/dex-testnet.json`, which is intentionally empty until owner-reviewed test tokens exist.

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

The public Web/API/Gateway deployment is proven by `docs/evidence/dex/public-web-api-wallet-2026-08-11.json`. Its health response deliberately reports `marketSourceConfigured=false`, `marketAvailable=false` and `executionAvailable=false`. The RPC probe observed chain 6423 and a live block, but it does not prove a DEX market. A market deployment still requires owner-provided deployer authority, governance multisig candidate, fee recipient, wrapped YNXT, at least two reviewed test assets, verifier endpoint and funding. Run `npm run dex:deploy:testnet` only after those inputs exist; it rejects wrong chain, missing code, duplicate tokens and zero gas balance.

Before changing the market or execution flags, capture exact manifest and bytecode/source verification, factory/router/wrapped addresses or authoritative native routes, pool creation, labelled test liquidity, Wallet-signed swaps, add/remove LP, Explorer transaction links, Indexer/API/UI consistency, restart/reorg drill and remote smoke results. None of those asset-movement proofs is currently present.

## Release truth

`product-release.json` is authoritative. `deployedPublic=true` applies only to the separately attested Web, read API and Wallet proxy surfaces. Its nested public-deployment boundary keeps `marketSourceConfigured=false`, `marketAvailable=false`, `executionAvailable=false` and `productionLiquidity=false`. The upload/download artifact remains a local unsigned candidate, so its own artifact manifest correctly keeps `deployedPublic=false`. `installedLocal`, `deployedStaging`, `downloadHosted`, `productionSigned`, `storeReleased`, `audited` and `productionLiquidity` remain false.

The runtime dependency audit is clean for production dependencies. The development-only Hardhat graph currently includes the documented `adm-zip` high-severity crafted-ZIP denial-of-service advisory with no upstream fix; keep contract tooling out of runtime images and reassess before an owner release.

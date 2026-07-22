# YNX DEX handoff

## Release identity and boundary

- Product: independent `YNX DEX`, Testnet Preview `0.1.0-testnet-preview.1`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/27-dex`
- Branch: `codex/final-dex`
- Chain: YNX Testnet EVM chain `6423` (`0x1917`); `mainnet=false`
- Protocol: clean-room immutable constant-product pools, 30 bps pool fee, bounded four-hop router
- Custody: none. The Web app prepares requests; canonical YNX Wallet must authorize and sign.
- Explicitly absent: central registry acceptance, deployed contracts, reviewed Testnet tokens, live liquidity, staging/public hosting, hosted download, production signature, store release and independent audit.

YNX Exchange remains the operator/custody/order-book product. Do not merge DEX balances, routes or transaction semantics into Exchange.

## Delivered surfaces

- `contracts/dex`: versioned factory, immutable pool, bounded router, read-only quoter, adversarial test tokens and integration runner.
- `contracts/dex/YNXStrategyVault.sol`: immutable per-user owner/engine boundary with typed Router methods, exact approvals, mandate/oracle limits, pause/revoke/kill and owner-only recovery. Vault v1 has no fee-transfer path.
- `sdk/dex`: strict ESM SDK for token/pool parsing, deterministic exact-in/out routing, slippage, price impact, freshness and transaction builders.
- `internal/dex` and `cmd/ynx-dex-indexerd`: HMAC-protected event state, confirmed EVM poller, reorg rewind/rescan, public read API, protected positions API and strict token-list API.
- `apps/dex`: responsive Web/PWA with Swap, Pools, Pool Detail, Add/Remove Liquidity, Positions boundary, Explore/Tokens/Transactions, Analytics, Governance, Docs and Settings.
- AI risk explanation: context selection, explicit permission, same-origin canonical-gateway enforcement, provider/model/status/cost, strict NDJSON streaming/cancel, review, local apply/reject and SHA-256 hash-chained browser audit. It cannot build, sign, submit or mutate a transaction.
- `release/dex`: deterministic upload-ready PWA tarball and per-file/SHA-256 manifest. It is unsigned and not hosted.

## Canonical Wallet/Auth candidate

Candidate file: `apps/dex/wallet-client.json`.

- `productClientId`: `ynx-dex-web-v1`
- `bundleId`: `com.ynxweb4.dex.web`
- callback: `https://dex.ynxweb4.com/wallet-auth/callback`
- scopes: `account:read`, `dex:positions:read`, `dex:transaction:request`
- required device algorithm: `p256-sha256`

The local adapter binds the exact client, bundle, callback, chain, scopes, nonce, digest and expiry and rejects substitutions. Positions call central introspection and fail closed when it is missing. No central Wallet, Auth, Gateway, registry or policy file was changed on this branch.

Owner action is required to review and register this candidate, expose the canonical introspection endpoint, then run integrated replay, expiry, scope escalation, callback substitution, cross-product reuse and device-binding tests on the accepted commit. Until that proof exists, `integratedCentral=false` and transaction controls remain unavailable.

## Runtime configuration

Copy `.env.dex.example` outside the repository. Generate independent secrets for state HMAC and trusted ingestion. The EVM poller additionally requires a verified `DEX_FACTORY_ADDRESS`, exact `DEX_INDEXER_START_BLOCK`, positive confirmations and a private cursor path. The token file defaults to `token-lists/dex-testnet.json`, which is intentionally empty until owner-reviewed test tokens exist.

The poller checks chain 6423, scans only confirmed bounded ranges, discovers pools from `PoolCreated`, correlates LP `Transfer` with Mint/Burn, decodes Swap/Sync/fees, persists an HMAC cursor and rewinds/rescans when the previously confirmed block hash changes. Never lower confirmations or edit signed state to bypass a conflict.

## Verification

```bash
npm ci
npm run hardhat:build
npm run dex:contracts:test
npm run dex:vault:test
npm test --prefix sdk/dex
go test -race ./internal/dex ./cmd/ynx-dex-indexerd
npm ci --prefix apps/dex
npm run build --prefix apps/dex
npm test --prefix apps/dex
npm run test:e2e --prefix apps/dex
npm run dex:manifests:check
npm run dex:release:test
npm run dex:package:all
npm run dex:artifacts:verify
```

The contract runner includes direct/multi-hop exact-in/out, LP add/remove, protocol fee, oracle progression/manipulation, 100 arithmetic differential vectors, deadlines/slippage, four-hop cap, delayed governance, malicious reentrancy, taxed input rollback, negative rebase sync rejection, extreme ratios and reserve overflow. Go race tests include restart/tamper/replay/concurrency, strict HTTP auth and a fake-EVM confirmed scan/restart/reorg recovery. Sixteen Web unit/integration tests cover Wallet binding, 12-locale/RTL shell, deterministic quotes and AI failures/stream/audit; ten Chromium E2E project cases pass and two project-inapplicable cases skip across desktop/mobile flows, offline Service Worker cold reload and visual evidence.

## Testnet deployment gate

The public RPC probe in `docs/evidence/dex/testnet/rpc-probe.json` observed chain 6423 and a live block, but it explicitly does not prove a DEX deployment. Deployment requires owner-provided deployer authority, governance multisig candidate, fee recipient, wrapped YNXT, at least two reviewed test ERC-20s, verifier endpoint and funding. Run `npm run dex:deploy:testnet` only after those inputs exist; it rejects wrong chain, missing code, duplicate tokens and zero gas balance.

After deployment, the owner must capture all of the following before changing any deployment flag: exact manifest and bytecode/source verification, factory/router/wrapped addresses, pool creation, labelled test liquidity, Wallet-signed direct and multi-hop swaps, add/remove LP, Explorer transaction links, Indexer/API/UI consistency, restart/reorg drill, staging health/version URLs and remote smoke results. No item is currently present.

## Release truth

`product-release.json` is authoritative. The upload bundle may support `implementedLocal` and `testedLocal` after final clean-tree verification, but it does not support `installedLocal`, `integratedCentral`, `deployedStaging`, `deployedPublic`, `downloadHosted`, `productionSigned` or `storeReleased`. `audited=false` and `productionLiquidity=false` remain mandatory.

The runtime dependency audit is clean for production dependencies. The development-only Hardhat graph currently includes the documented `adm-zip` high-severity crafted-ZIP denial-of-service advisory with no upstream fix; keep contract tooling out of runtime images and reassess before an owner release.

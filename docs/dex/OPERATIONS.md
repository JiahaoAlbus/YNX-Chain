# YNX DEX operations

## Local verification

```bash
npm ci
npm run hardhat:build
npm run dex:contracts:test
npm run dex:vault:test
npm run dex:fairflow:test
npm run dex:lp-protection:test
npm run dex:stable:test
npm test --prefix sdk/dex
npm run build --prefix apps/dex
npm test --prefix apps/dex
npm run test:e2e --prefix apps/dex
go test -race ./internal/dex ./cmd/ynx-dex-indexerd
npm run dex:manifests:check
npm run dex:package:all
npm run dex:artifacts:verify
```

Run the Hardhat build and the four Hardhat contract runners serially. Hardhat 3 shares one compile-cache temporary path, so parallel build processes can race during cache rename even when the Solidity output is valid.

Start the API with random non-repository secrets and owner-selected state/cursor paths. Set `DEX_FACTORY_ADDRESS` and `DEX_INDEXER_START_BLOCK` only from a verified deployment manifest; otherwise the API starts without pretending to ingest chain data. Start the Web app through its same-origin reverse proxy. If AI explanation is enabled, `VITE_DEX_AI_GATEWAY_URL` must remain a same-origin proxy path such as `/ai`; cross-origin endpoints fail closed. `/health` reports product, chain and latest indexed block; `/version` reports exact build identity.

Set `DEX_STRATEGY_VAULT_ADDRESS`, `DEX_FAIRFLOW_ADDRESS`, `DEX_LP_PROTECTION_ADDRESS` and `DEX_STABLE_FACTORY_ADDRESS` only from the same verified deployment manifest; the protection address must equal `factory.lpProtection()`. Cursor v5 binds all four addresses and rejects substitution. Enabling a source through any legacy cursor preserves an exact mode-0600 versioned backup and rewinds to `DEX_INDEXER_START_BLOCK` so earlier actions are not skipped. Pool records are labelled `ynx-dex-cpmm-v1` or `ynx-stableswap-v1`; the Stable fee is read from the pool at its creation block. The versioned history APIs must not replace direct current-state RPC reads. FairFlow, protected-swap and Stable clients pair indexed history with fresh authoritative SDK state parsers.

## Testnet deployment

Copy `.env.dex.example` outside the repository, provide the real RPC, deployer key, reviewed multisig/fee/FairFlow treasury addresses, exact Testnet token allow-list, public minimum solver bond, user vault owner, limited Quant engine address, reviewed Vault oracle and reviewed LP Protection Oracle adapter, then run `npm run dex:deploy:testnet`. The script rejects the wrong chain, missing token/oracle code, duplicate tokens, invalid bond and zero deployer balance. It deploys separate protected-CPMM and Stable Factories with their Router/Quoter pairs, the Vault paused and scoped only to the protected-CPMM Router, plus an empty FairFlow registry, then writes a mode-0600 manifest. Stable pools are not auto-created: governance must publish reviewed tokens, immutable A/fee rationale and a depeg runbook first. Source verification, pool creation, solver onboarding, labelled test liquidity, Wallet review and public proofs remain separate gates.

## Recovery and rollback

Contracts are immutable. Rollback means stop advertising the affected router/factory, preserve indexer/audit evidence, publish the incident, deploy a versioned replacement, migrate only through user-approved Wallet transactions and retain both manifests. State/cursor HMAC mismatch fails startup. A confirmed block-hash mismatch automatically rewinds a bounded depth, removes affected events/pool discovery and rescans; deeper or repeated conflicts require an owner-approved full rescan from the recorded deployment block, never manual state editing.

The schema-v5 forward migration and isolated v1/v2/v3/v4 rollback procedure are defined in `MIGRATION_COMPATIBILITY.md`. Never start old and new binaries against the same writable state or cursor paths.

`npm run dex:testnet:probe` writes a timestamped RPC observation. A timeout exits non-zero and records an unavailable probe; a successful chain-ID check still does not establish DEX deployment. The PWA packager creates a deterministic upload-ready tarball and SHA-256 manifest under `release/dex`; it does not host or production-sign it.

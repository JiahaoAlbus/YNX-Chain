# YNX DEX operations

## Local verification

```bash
npm ci
npm run hardhat:build
npm run dex:contracts:test
npm run dex:vault:test
npm run dex:fairflow:test
npm run dex:lp-protection:test
npm test --prefix sdk/dex
npm run build --prefix apps/dex
npm test --prefix apps/dex
npm run test:e2e --prefix apps/dex
go test -race ./internal/dex ./cmd/ynx-dex-indexerd
npm run dex:manifests:check
npm run dex:package:all
npm run dex:artifacts:verify
```

Run the Hardhat build and the three Hardhat contract runners serially. Hardhat 3 shares one compile-cache temporary path, so parallel build processes can race during cache rename even when the Solidity output is valid.

Start the API with random non-repository secrets and owner-selected state/cursor paths. Set `DEX_FACTORY_ADDRESS` and `DEX_INDEXER_START_BLOCK` only from a verified deployment manifest; otherwise the API starts without pretending to ingest chain data. Start the Web app through its same-origin reverse proxy. If AI explanation is enabled, `VITE_DEX_AI_GATEWAY_URL` must remain a same-origin proxy path such as `/ai`; cross-origin endpoints fail closed. `/health` reports product, chain and latest indexed block; `/version` reports exact build identity.

Set `DEX_STRATEGY_VAULT_ADDRESS`, `DEX_FAIRFLOW_ADDRESS` and `DEX_LP_PROTECTION_ADDRESS` only from the same verified deployment manifest; the last address must equal `factory.lpProtection()`. Cursor v4 binds all three addresses and rejects substitution. Enabling a source through any legacy cursor preserves an exact mode-0600 versioned backup and rewinds to `DEX_INDEXER_START_BLOCK` so earlier actions are not skipped. The versioned `/v1/vault/actions`, `/v1/fairflow/events` and `/v1/lp-protection/events` APIs expose confirmed logs only and must not replace direct current-state RPC reads. FairFlow and protected-swap clients pair indexed history with the SDK's fresh authoritative state parsers before request construction or reconciliation.

## Testnet deployment

Copy `.env.dex.example` outside the repository, provide the real RPC, deployer key, reviewed multisig/fee/FairFlow treasury addresses, exact Testnet token allow-list, public minimum solver bond, user vault owner, limited Quant engine address, reviewed Vault oracle and reviewed LP Protection Oracle adapter, then run `npm run dex:deploy:testnet`. The script rejects the wrong chain, missing token/oracle code, duplicate tokens, invalid bond and zero deployer balance. It deploys the protected CPMM Factory with immutable Oracle binding, the Vault paused and unconfigured, plus an empty FairFlow registry with no batches or solver claims, then writes a local mode-0600 manifest. Only the immutable vault owner may configure its mandate. Source/bytecode verification, Oracle/sourceHash review, pool creation, solver funding/onboarding, test liquidity, Wallet mandate review, swap/LP/Vault/FairFlow proofs, Explorer links and Indexer consistency are separate required steps.

## Recovery and rollback

Contracts are immutable. Rollback means stop advertising the affected router/factory, preserve indexer/audit evidence, publish the incident, deploy a versioned replacement, migrate only through user-approved Wallet transactions and retain both manifests. State/cursor HMAC mismatch fails startup. A confirmed block-hash mismatch automatically rewinds a bounded depth, removes affected events/pool discovery and rescans; deeper or repeated conflicts require an owner-approved full rescan from the recorded deployment block, never manual state editing.

The schema-v4 forward migration and isolated v1/v2/v3 rollback procedure are defined in `MIGRATION_COMPATIBILITY.md`. Never start old and new binaries against the same writable state or cursor paths.

`npm run dex:testnet:probe` writes a timestamped RPC observation. A timeout exits non-zero and records an unavailable probe; a successful chain-ID check still does not establish DEX deployment. The PWA packager creates a deterministic upload-ready tarball and SHA-256 manifest under `release/dex`; it does not host or production-sign it.

# YNX DEX operations

## Local verification

```bash
npm ci
npm run hardhat:build
npm run dex:contracts:test
npm test --prefix sdk/dex
npm run build --prefix apps/dex
npm test --prefix apps/dex
npm run test:e2e --prefix apps/dex
go test -race ./internal/dex ./cmd/ynx-dex-indexerd
npm run dex:manifests:check
npm run dex:package:all
npm run dex:artifacts:verify
```

Start the API with random non-repository secrets and owner-selected state/cursor paths. The active public Testnet mode sets `YNX_DEX_NATIVE_REST_URL=http://127.0.0.1:6420`; the service indexes authoritative chain-native assets, pools and events from the colocated node. Native and EVM sources are mutually exclusive: never set `DEX_FACTORY_ADDRESS` for the active native release. An alternative EVM deployment may set `DEX_FACTORY_ADDRESS` and `DEX_INDEXER_START_BLOCK` only from a verified deployment manifest. With neither source configured, the API must report market and execution unavailable instead of inventing data.

Start the Web app through its same-origin reverse proxy. If AI explanation is enabled, `VITE_DEX_AI_GATEWAY_URL` must remain a same-origin proxy path such as `/ai`; cross-origin endpoints fail closed. `/health` reports source configuration, market/execution availability, indexed pools and release identity; `/version` reports exact build identity.

## Active chain-native Testnet deployment

The deploy entry point is `scripts/deploy/deploy-dex-testnet.sh`. It builds an exact Git revision, packages the API and Web surfaces, then invokes `scripts/deploy/install-dex-testnet-remote.sh`. The remote installer requires the strict loopback native endpoint, refuses a competing EVM factory, preserves persistent state outside release directories, runs preflight health/version checks and atomically updates `/opt/ynx/dex-current`. A failed preflight or activation restores the previous release.

After deployment, observe the already-committed lifecycle without creating duplicate assets or pools:

```bash
go run ./scripts/verify/dex-native-public-lifecycle -observe-existing
node scripts/verify/dex-market-capacity.mjs
```

The lifecycle observer validates committed action block references, asset/pool state and Indexer market/candle state. The capacity probe validates response schemas on loopback; a separately recorded independent-host probe validates public DNS/TLS reachability and HTTP success. Neither probe alone is a production SLO.

## Alternative EVM Testnet deployment

Copy `.env.dex.example` outside the repository, provide the real RPC, deployer key, reviewed multisig/fee addresses and exact Testnet token allow-list, then run `npm run dex:deploy:testnet`. The script rejects the wrong chain, missing token code, duplicate tokens and zero deployer balance. It writes a local mode-0600 manifest. Source/bytecode verification, pool creation, test liquidity, Wallet swap/LP proofs, Explorer links and Indexer consistency remain separate gates for that alternative mode.

## Recovery and rollback

For the chain-native path, rollback means atomically restore the prior application release while preserving chain and Indexer state, stop advertising an incompatible market UI, and publish the release boundary. Chain state is never edited to simulate rollback. For the EVM path, contracts are immutable: stop advertising the affected router/factory, preserve audit evidence, deploy a versioned replacement and migrate only through user-approved Wallet transactions. State/cursor HMAC mismatch fails startup. A confirmed EVM block-hash mismatch automatically rewinds a bounded depth; deeper conflicts require an owner-approved full rescan, never manual state editing.

`npm run dex:testnet:probe` writes a timestamped RPC observation. A timeout exits non-zero and records an unavailable probe; a successful chain-ID check still does not establish DEX deployment. The PWA packager creates a deterministic upload-ready tarball and SHA-256 manifest under `release/dex`; it does not host or production-sign it.

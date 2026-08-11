# YNX DEX evidence index

## Source and tests

- Protocol source revision: `contracts/dex/SOURCE_REV`
- Engine evaluation: `docs/dex/DEX_ENGINE_EVALUATION.md`
- Contract integration runner: `scripts/dex/contract-test.mjs`
- SDK deterministic/property tests: `sdk/dex/test/sdk.test.mjs`
- Indexer recovery/security tests: `internal/dex/store_test.go`
- Confirmed EVM polling/reorg tests: `internal/dex/evm_ingester_test.go`
- Chain-native replay/current-state tests: `internal/dex/native_ingester_test.go`
- Web/Wallet/RTL tests: `apps/dex/src/*.test.ts*`
- Desktop/mobile/offline E2E: `apps/dex/e2e/dex.spec.ts`
- Deployment guard: `scripts/dex/deploy-testnet.mjs`
- Release/registry validation: `scripts/dex/check-manifests.mjs`
- Deterministic PWA/SDK/contract-evidence packaging: `scripts/dex/package-web.mjs`, `scripts/dex/package-all.mjs`
- Artifact integrity verifier: `scripts/dex/verify-artifacts.mjs`
- Public native lifecycle observer: `scripts/verify/dex-native-public-lifecycle/main.go`
- Concurrent market-read probe: `scripts/verify/dex-market-capacity.mjs`

## Visual evidence

- `docs/evidence/dex/ui/desktop-light-1440x900.png`
- `docs/evidence/dex/ui/desktop-dark-1440x900.png`
- `docs/evidence/dex/ui/mobile-light-390x844.png`
- `docs/evidence/dex/ui/mobile-arabic-dark-390x844.png`
- `docs/evidence/dex/ui/wallet-central-unavailable-1440x900.png`
- `docs/evidence/dex/ui/tablet-live-fixture-1024x768.png`
- `docs/evidence/dex/ui/large-text-fixture-1440x900.png`
- `docs/evidence/dex/ui/loading-1440x900.png`
- `docs/evidence/dex/ui/api-failure-1440x900.png`
- `docs/evidence/dex/ui/success-indexed-fixture-1440x900.png`

The first five images are local real-runtime captures against an empty persistent Testnet index. Files containing `fixture` use explicitly mocked, schema-valid indexed data; they prove layout, quote/review rendering and responsive behavior only. No screenshot proves deployed availability, real liquidity or successful Wallet execution.

## Network and artifacts

- Public chain-native asset/pool/LP/swap lifecycle: `docs/evidence/dex/native-public-lifecycle-2026-08-11.json`
- Four-node protected rollout and chain capacity: `docs/evidence/dex/chain-native-four-node-rollout-2026-08-11.json`
- Public and loopback DEX market capacity: `docs/evidence/dex/native-market-capacity-2026-08-11.json`
- Timestamped public RPC identity/block observation: `docs/evidence/dex/testnet/rpc-probe.json`
- Upload-ready PWA bundle: `release/dex/ynx-dex-web-pwa-0.1.0-testnet-preview.1.tar.gz`
- Bundle and per-file SHA-256 manifest: `release/dex/web-pwa-artifact.json`
- SDK and contract-source/build aggregate manifest: `release/dex/artifact-manifest.json`

The older EVM RPC observation explicitly records `dexDeploymentObserved=false`; it predates the chain-native market release and remains an exact historical record. The native lifecycle evidence is now the authoritative Testnet market record. The packaged PWA artifact remains unsigned and does not by itself prove hosted identity.

## Missing evidence

EVM contract/bytecode deployment is not part of the active chain-native Testnet path and remains absent. Still missing are an installed production-signed Wallet transaction callback, Explorer per-transaction UI captures, an immutable hosted desktop/mobile artifact, store acceptance, independent security audit, reviewed production token list/liquidity and mainnet activation. The public Testnet pool is deliberately thin test liquidity and must not be marketed as production liquidity.

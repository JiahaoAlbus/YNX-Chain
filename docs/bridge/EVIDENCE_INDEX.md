# Bridge Evidence Index

Updated: 2026-07-30T12:02:10Z

- Frozen release source commit: `40b99be92a9fd7a1e83cab3da27bbe233bf2695c`
- Successful Bridge CI: run `30419513969`, job `90473200772`
- CI verification artifact: ID `8711399511`, digest `sha256:bb1185235fd22cdfae5b98efdb723b1b70f48f32aea7c4dd0d42fae6c506e54f`, expiring 2026-08-28; this remains an expiring Actions artifact.
- Immutable pre-release: `https://github.com/JiahaoAlbus/YNX-Chain/releases/tag/ynx-bridge-v0.3.1-testnet-candidate`, 10 assets, signing class `unsigned-testnet-candidate`.
- Independent download verification: all `SHA256SUMS` entries passed, the packaged SDK installed/imported, and the macOS ARM64 coordinator passed configuration validation plus a real cold start.
- Candidate hashes: Linux AMD64 `0836bc034dfd5b8d3e6e58947ab7e42751d84bc6a2cee26df654aead55ce34b4`; macOS ARM64 `2e0756979ae693292dd2e1eb281253f866baad53e204b165817f083195e0b164`; SDK `dbbdd2a27a2131b43800d732791ec832a6daf0ae2fb584cddd7efff51581f47c`.
- Runtime source: `internal/bridgegateway`, `cmd/ynx-bridged`, `internal/appgateway`, `cmd/ynx-app-gatewayd`; deployed Testnet runtime commit `857371f9b19422861c0675ca6cbd89a7750744ad`
- Remote Testnet coordinator, artifact, permission, App Gateway, and fail-closed runtime proof: `docs/bridge/testnet-deployment-evidence.json`
- Independent-node public TLS read-only surface and mutation-boundary proof: `docs/bridge/public-read-evidence.json`
- Quote Runtime and fail-closed vectors: `internal/bridgegateway/service.go`, `internal/bridgegateway/gateway_test.go`, `scripts/verify/bridge-api-check.sh`
- Wallet Review Runtime and Product Session/App Gateway vectors: `internal/bridgegateway/service.go`, `internal/appgateway/server.go`, `internal/appgateway/session_test.go`, `scripts/verify/app-gateway-check.sh`
- Process-level verifier: `scripts/verify/bridge-api-check.sh`
- Unit, migration, proof-tamper, availability, and HTTP vectors: `internal/bridgegateway/gateway_test.go`, `internal/bridgegateway/state_machine_test.go`
- Provider Registry runtime and fail-closed vectors: `internal/bridgegateway/service.go`, `internal/bridgegateway/provider_registry_test.go`, `sdk/bridge/index.test.mjs`
- Circle CCTP V2 Provider Runtime, remote supported-domain probe, fail-closed outage drill, automatic recovery, and independent public observation: `internal/bridgegateway/provider_runtime.go`, `internal/bridgegateway/provider_runtime_test.go`, `scripts/verify/bridge-provider-check.sh`, `docs/bridge/testnet-deployment-evidence.json`, `docs/bridge/public-read-evidence.json`
- Frozen Integration Contract: `release/integration/ynx-bridge-contract.json`
- Central handoff: `docs/integration/INTEGRATION_HANDOFF.md`
- Dependency acceptance: `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- Deployment dry run: `scripts/deploy/dry-run.sh`
- Readiness boundary: `docs/bridge/BRIDGE_INTEGRATION_READINESS.md`
- Feature status: `docs/bridge/FEATURE_COMPLETION_EVIDENCE.md`
- Migration: `docs/bridge/MIGRATION_COMPATIBILITY.md`
- Data lifecycle and cessation: `docs/bridge/DATA_LIFECYCLE.md`
- Observability: `docs/bridge/OBSERVABILITY.md`
- Status and support contract: `docs/bridge/STATUS_AND_SUPPORT.md`
- Operations: `docs/bridge/OPERATIONS.md`
- Capacity: `docs/bridge/SLO_CAPACITY_PLAN.md`
- Unit economics: `docs/bridge/UNIT_ECONOMICS.md`
- Interface audit: `docs/bridge/UI_DESIGN_AUDIT.md`
- Release notes: `docs/bridge/RELEASE_NOTES.md`
- Consumer manifest: `docs/bridge/consumer-integration-manifest.json`
- Consumer lifecycle vectors: `docs/bridge/consumer-lifecycle-vectors.json`
- Provider status: `docs/bridge/provider-status.json`
- Route adapter contract: `docs/bridge/ROUTE_ADAPTER.md`
- Route adapter gate: `scripts/verify/bridge-route-adapter-check.mjs`
- Asset catalog contract: `docs/bridge/ASSET_CATALOG.md`
- Consumer handoff: `docs/handoffs/bridge-consumers.md`
- Integration gate: `scripts/verify/bridge-integration-check.mjs`
- Read-only SDK: `sdk/bridge`
- SDK gate: `scripts/verify/bridge-sdk-check.sh`
- Data lifecycle gate: `scripts/verify/bridge-data-lifecycle-check.sh`
- Threat model: `docs/bridge/THREAT_MODEL.md`
- Security boundaries: `docs/bridge/SECURITY_BOUNDARIES.md`
- Relayer key lifecycle: `docs/bridge/RELAYER_KEY_LIFECYCLE.md`
- Third-party notices: `docs/bridge/THIRD_PARTY_NOTICES.md`
- Supply-chain gate: `scripts/verify/bridge-supply-chain-check.sh`
- Public product metadata: `docs/bridge/public-product-metadata.json`
- Machine release state: `docs/bridge/product-release.json`
- Capacity evidence: `docs/bridge/capacity-evidence.json`
- Restore evidence: `docs/bridge/restore-evidence.json`; restore runner `scripts/verify/bridge-restore-check.sh` allocates an isolated loopback port and passed two concurrent drills on 2026-07-29.
- Website route evidence: direct HTTP observation of `https://ynxweb4.com/bridge`; route HTTP 200 is proved, but product-specific canonical/title/description/Open Graph/JSON-LD are not proved and are handed to `28-website`.
- Evidence gate: `scripts/verify/bridge-evidence-check.mjs`
- Release-candidate generator and verifier: `scripts/package/bridge-release-candidate.mjs`, `scripts/verify/bridge-release-candidate.mjs`

Generated test output is ephemeral and is not public or remote evidence. A release evidence record must bind future logs, artifacts, transaction receipts, API responses, and deployment URLs to the exact source commit that produced them.

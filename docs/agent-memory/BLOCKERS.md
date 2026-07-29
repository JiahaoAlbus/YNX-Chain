# Blockers and Dependency Gates

Updated: 2026-07-29T02:45:09Z

The product is not classified as `EXTERNAL BLOCKED`; autonomous integration, evidence and packaging work remains. The gates below must remain truthful and fail closed.

## Q08-DEP-001 — Central contract freeze

- Owner: 02 Wallet/Auth, 07 Exchange, 19 Oracle/Market Data, 26 Data Fabric, 27 DEX and 29 Integration.
- State: dependency pending.
- Evidence: `docs/integration/DEPENDENCY_ACCEPTANCE.md` and `.ai-bridge/open-questions.md`.
- Missing facts: accepted versioned Product Session/StrategyMandate, terminal receipt/reconciliation, market-data correction/freshness, event/Billing Ledger mapping and shared Testnet environment contracts.
- Quant preparation complete: local fail-closed adapters, integration contract, schemas and negative vectors exist.
- Resume condition: source-addressable owner artifacts or a central accepted manifest explicitly naming the contract versions.
- First action after resolution: bind the accepted versions in Quant-owned integration files and run negative plus bounded Testnet vectors.

## Q08-DEP-002 — Shared Testnet execution evidence

- Owner: 01 Chain, 02 Wallet/Auth, 07 Exchange, 19 Oracle, 26 Data Fabric, 27 DEX and 29 Integration.
- State: dependency pending.
- Missing evidence: real faucet/account path, StrategyMandate receipt, Exchange order/fill, DEX vault action, risk breach, revoke, emergency exit, restart and exact reconciliation correlated across products.
- Quant preparation complete: deterministic local adapters and receipt-binding/replay/reconciliation tests.
- Resume condition: accepted shared Testnet manifest, endpoints, accounts and evidence store.
- First action after resolution: execute the approved no-withdraw Exchange vector, then the bounded DEX Vault vector.

## Q08-ENV-001 — Windows execution host

- Owner: authorized release operator or CI/SRE owner.
- State: environment unavailable.
- Evidence: Windows x64 archive is reproducibly cross-compiled but `installedLocal=false` and `coldStartVerified=false` in `apps/quant-lab/product-release.json`.
- Preparation complete: archive, hash, scanner and packaged supervisor are present.
- Why not locally resolvable: the current host is macOS arm64 and must not fabricate Windows execution evidence.
- Minimum input: a trusted Windows x64 runner or host capable of launch, installation, uninstall and security checks.
- First action after resolution: verify hash, signature class, clean install, cold start, health/version/frontend, shutdown, uninstall and residual files.

## Q08-ENV-002 — Linux amd64 container and external scan

- Owner: 30 Security/SRE/Release and authorized registry operator.
- State: environment and release path unavailable.
- Evidence: local Linux arm64 image runtime/restart/restore passed; no Linux amd64 runtime, registry digest, signature, immutable hosting or external vulnerability scan exists.
- Preparation complete: pinned Dockerfile, Compose gate, local runtime evidence and SBOM.
- Minimum input: Linux amd64 runner, approved registry path and external scanner/signing workflow.
- First action after resolution: build from the exact source commit, run the same recovery gate, publish by digest, sign and scan.

## Q08-REL-001 — Production signing and public release

- Owner: Founder/authorized release operator, 28 Website and 30 Security/SRE/Release.
- State: external authorization required after autonomous gates.
- Evidence: macOS is ad-hoc test signed; Windows is unsigned; no hosted download, GitHub Quant Release, public deployment or verified `ynxweb4.com` Quant route exists.
- Preparation complete: local candidates, hashes, release metadata and canonical website target.
- Why not autonomously resolvable: production certificates, notarization, registry, Vercel/public deployment and irreversible release authority must not be exposed or simulated.
- Minimum input: minimum-privilege signing, hosting and deployment workflows after central/Testnet approval.
- First action after resolution: build approved artifacts from the frozen release commit, sign/notarize, attach SBOM/provenance, publish immutable downloads and verify public routes.

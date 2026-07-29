# YNX 08 Quant Lab — Current State

Updated: 2026-07-29T02:45:09Z

## Identity

- Product: `08 — YNX Quant Lab`
- Owner boundary: ecosystem Quant Engine; Exchange, DEX, Wallet/Auth, Oracle, Data Fabric, Website and central Integration remain owned by their designated products.
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/08-quant-lab`
- Branch: `codex/final-quant-lab`
- Repository: `https://github.com/JiahaoAlbus/YNX-Chain`
- Verified source checkpoint: `3bff013d86ed5682950a38b114884ce6f17c423d`
- Remote branch checkpoint: `3bff013d86ed5682950a38b114884ce6f17c423d`
- `origin/main`: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Divergence from `origin/main`: 78 commits behind, 38 commits ahead.
- Dirty state at checkpoint: clean.

The SHA above is the last fully verified source checkpoint before this Agent Memory record is committed. Resolve the commit containing this record with `git log -1 --format=%H -- docs/agent-memory/RECOVERY_CHECKPOINT.json`.

## Current phase

`INTEGRATE` — local product, desktop, SDK, API, risk, persistence, capacity and container candidate gates have evidence; central contracts, real shared Testnet execution, public deployment and production release gates remain incomplete.

## Latest successful verification

`apps/quant-lab/scripts/verify-release.sh` passed on committed checkpoint `3bff013d86ed5682950a38b114884ce6f17c423d` on 2026-07-29. It covered:

- Quant Go tests and `go vet`;
- UI catalogue, twelve-locale and browser/mobile/RTL tests;
- TypeScript and Python SDK tests;
- integration package validation;
- archive structural and credential safety checks;
- Docker Compose configuration and Kubernetes YAML parsing;
- two-run macOS/Windows archive reproducibility in the recorded Go 1.25.7 Darwin arm64 toolchain;
- strict ad-hoc macOS signature verification;
- fresh packaged macOS cold start with exact source commit, ready health, live funds disabled, build/risk metrics, frontend identity and clean port release.

Container runtime/restart/restore evidence remains bound to source commit `8b211d08a67abc9e2b3d3f3254bbc87f4293b08e` and local Linux arm64 image ID `sha256:70e32c90601dc50c4770d04d40bd684a8bde52848e969afb9e8ddfbbaceb3f35`.

## GitHub state

- Pull request for `codex/final-quant-lab`: none.
- GitHub Actions for current checkpoint: none. Repository CI currently triggers on `main` push or pull requests to `main`, not direct pushes to this product branch.
- Quant-specific GitHub Release: none.
- Hosted immutable Quant artifacts: none.
- SBOM: local `apps/quant-lab/SBOM.cdx.json`; no published release attachment or provenance claim.

## Candidate artifacts

- macOS arm64 ZIP: 7,377,983 bytes; SHA-256 `7df2bb3fd2f59ef3594a770004866feb8dff3495c3836bfeadec03d98dae2739`; ad-hoc test signing; fresh cold start verified; unhosted.
- Windows x64 ZIP: 8,094,598 bytes; SHA-256 `4cdacd903aee1ab7aeafc9943258f42cf8522b19a8eda3e4f618b963c0a2f392`; unsigned cross-compile; not run on Windows; unhosted.
- Linux arm64 OCI candidate: local image only; unsigned, unhosted, no registry manifest digest and no external vulnerability scan.

## Public state

- `integratedCentral=false`
- `deployedStaging=false`
- `deployedPublic=false`
- `downloadHosted=false`
- `productionSigned=false`
- `storeReleased=false`
- Canonical target: `https://quant.ynxweb4.com`
- Verified public route: none.

No local, candidate, handoff or HTTP metadata is represented as a public deployment.

## Completed locally

- deterministic research/backtest and strategy lifecycle;
- paper and shadow execution boundaries;
- fail-closed Exchange and DEX receipt adapters;
- independent risk controls and persistent kill switch;
- local audit, recovery and persistence tests;
- REST/WebSocket, CLI, Python SDK and TypeScript SDK;
- twelve locales, Arabic RTL, responsive browser evidence;
- measured local API/backtest/worker capacity evidence;
- reproducible desktop candidates and repeatable macOS cold-start gate;
- local Linux arm64 Compose runtime/restart/restore evidence;
- Quant integration contract, test vectors and dependency-acceptance package.

## Remaining

- consume accepted Wallet/Auth, Exchange, DEX, Oracle and Data Fabric owner contracts and central freeze;
- execute real bounded Exchange and DEX shared-Testnet vectors with authoritative receipts, revoke, risk, restart and reconciliation evidence;
- correlate canonical events with Explorer, Monitor, Finance, Trust and Data Fabric;
- run Windows installation/cold-start/uninstall/security evidence;
- run Linux amd64 container runtime evidence, registry publication, signature and external scan;
- run deployed migration/restore/RTO/RPO and accessibility audits;
- create PR and obtain CI for the final candidate SHA;
- publish approved release, immutable downloads, SBOM/provenance and website handoff;
- verify the real `ynxweb4.com` Quant route and public health/version evidence.

## Current risks

- A product-branch-only push does not produce CI under the current workflow trigger.
- Local artifact reproducibility is toolchain-bound; source commit alone is insufficient release provenance.
- Owner contracts and shared Testnet facts are not frozen in this branch; live mutation remains fail-closed.
- Production signing, registry credentials and public deployment require authorized operator paths and must not be simulated.

## Evidence index

- `apps/quant-lab/EVIDENCE_INDEX.md`
- `apps/quant-lab/FEATURE_COMPLETION_EVIDENCE.md`
- `apps/quant-lab/product-release.json`
- `apps/quant-lab/security-verification.json`
- `apps/quant-lab/container-verification.json`
- `apps/quant-lab/evidence/`
- `.ai-bridge/full-goal-coverage.json`
- `docs/integration/`
- `release/integration/ynx-quant-lab-contract.json`

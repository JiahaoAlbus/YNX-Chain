# YNX 33 current state

Updated at: `2026-07-29T02:56:17Z`

## Identity

- Product number: `33`
- Product name: `YNX Video`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/33-video`
- Repository: `JiahaoAlbus/YNX-Chain`
- Branch: `codex/final-video`
- Last verified branch head before this memory checkpoint: `1572846c4ef676b6b6844e9678e3139df913f36c`
- Last verified remote head before this memory checkpoint: `1572846c4ef676b6b6844e9678e3139df913f36c`
- Main SHA: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead / behind at verification: `0 / 0`
- Dirty state at verification: clean

## Current phase

`INTEGRATE` — product-owned media integrity and integration contract v2 are implemented and tested locally. Central acceptance, current-source native artifacts, full current-source ClamAV E2E, public deployment and production release remain unproven.

## Latest successful tests

- `go test ./internal/video/...`
- `go test -race ./internal/video/...`
- `go vet ./internal/video/...`
- `npm --prefix apps/video run check`
- `npm --prefix apps/video run smoke`
- JSON validation for integration contract, vectors, coverage and product release records

## GitHub state

- Pull request: none for `codex/final-video`
- GitHub Actions: no run returned for `codex/final-video`
- Video release/tag: none
- Remote recovery point: `origin/codex/final-video`

## Release and deployment truth

- implementedLocal: true
- testedLocal: true
- builtLocal: historical native artifacts only; not current-source
- installedLocal: false for current source
- migrationVerified: true for schema v2
- restoreVerified: false for current source
- integratedCentral: false
- testnetVerified: false
- deployedStaging: false
- deployedPublic: false
- releasePublished: false
- downloadHosted: false
- productionSigned: false
- storeReleased: false
- Public deployment: none proven
- `ynxweb4.com` Video route: not proven deployed

## Completed in the latest engineering slice

- Added byte count, SHA-256 and explicit original/derivative lineage to every HLS playlist, HLS segment and original fallback variant.
- Enforced per-video object-key containment, duplicate rejection, nonempty assets and source-digest binding.
- Upgraded persisted state to schema v2 with explicit rollback migration.
- Added startup backfill for legacy variant integrity metadata.
- Made missing or unverifiable legacy assets private and failed, with audit evidence.
- Published `ynx-video-integration-v2`, updated cross-product vectors and corrected product-release truth for historical native artifacts.

## Current risks

- Current-source ClamAV-backed loopback E2E is unavailable because the local scanner configuration/signature database is not proven usable.
- No current-source Android/iOS artifact or install evidence exists.
- No final-branch CI run, PR or Video release exists.
- Central Wallet/Auth, Pay, Trust, Data Fabric, Integration and Security/SRE acceptance is pending.
- Public runtime, hosted downloads, production signing, physical devices and store credentials are absent.

## Evidence

- `docs/handoffs/video-evidence/MEDIA_INTEGRITY.md`
- `docs/handoffs/video-evidence/EVIDENCE_INDEX.md`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `release/integration/video-contract.json`
- `apps/video/product-release.json`
- `.ai-bridge/full-goal-coverage.json`

# Evidence index

## Product behavior

- Client unit/integration/security/recovery/locale tests:
  `packages/developer-client/test/developer-client.test.js`
- Web/desktop boundary tests: `apps/developer/test`
- Optional ACP sidecar: `desktop/grok-build-sidecar.mjs`
- Wallet-only compile/deploy/receipt/source-match clients:
  `packages/developer-client/src`
- API Studio OpenAPI validation, request preview, host-broker boundary,
  failure simulation and generation: `API_STUDIO.md`
- API Studio core tests: `packages/developer-client/test/api-studio.test.js`
- API Studio Web boundary tests: `apps/developer/test/api-studio-ui.test.js`
- Current runtime source checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- Current browser-evidence harness source: `f38aa95a9ec7ebff68b4d915f41b20ad8f903769`
- Current targeted verification: Developer client 22/22, Developer Web 21/21 locally (20/20 on artifact-source Windows CI), browser syntax, static claim/workflow, standalone Web build, live compile, same-origin proxy, desktop sandbox 2/2, Windows source boundary and current-source Chrome accessibility audit 15/15.
- Validation-gate evidence: `scripts/validate/no-placeholder-check.sh` and `scripts/validate/secret-scan.sh` execute a verified fallback when `rg` is unavailable; scanner execution errors fail closed.

## Visual evidence

The audited images and their state explanations are listed in
`UI_DESIGN_AUDIT.md`. Historical baseline/final files are under `evidence/ui`.
Current-source deterministic Chrome evidence is under
`evidence/ui/current-accessibility`; `accessibility-audit.json` binds 15 passed
checks and six PNG hashes to clean source commit
`f38aa95a9ec7ebff68b4d915f41b20ad8f903769`. It covers keyboard focus order,
skip navigation, tab roving, the browser accessibility tree, focus visibility,
Light/Dark, reduced motion, 390 px overflow, inert mobile drawers, Arabic RTL,
large text and a 200% page scale. This is product-owner browser evidence, not an
independent accessibility certification or installed-desktop recapture.

## Desktop evidence

- macOS build: `scripts/package-local-macos.sh`
- macOS extracted install/cold start: `scripts/verify-local-macos-package.sh`
- Current macOS source commit: `7f976c1e06292360160325b00fa0875e6a2567f6`
- Current macOS source tree: `0cf68963a1678e6611296684d522b471add4f652`
- Current macOS runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- Current macOS ZIP: SHA-256 `ff9ae3d473f961f38294679a7bdb21c7cc0c905d7791efe9d4b114fc1df903f7`, 38,450,128 bytes, `adhoc-no-team-id`, local and unhosted pending pre-release publication
- Embedded SBOM SHA-256: `801af226eda24a8ad4e880f8d36da197ef8af375b62153435dd4c0c75cc8ac12`
- Windows build: `scripts/package-windows.ps1`
- Windows portable install/cold start: `scripts/verify-windows-package.ps1`
- Windows host workflow: `.github/workflows/developer-windows.yml`
- Successful current-source Windows host run:
  `https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/30417693593`
- Windows source `7f976c1e06292360160325b00fa0875e6a2567f6`, job `90467659180`, transient Artifact `8710756758`, inner ZIP SHA-256 `1efaf486164da71d907a8869e5e749fe46bf0bb1a74625f12ddab1692d07fb29`, outer digest `sha256:5c52a2f911525732fb8ded1e5f72ba79d8f8b48ff1907899870afa355c54c289`; expires `2026-08-12T02:46:59Z` and is not yet an immutable public download.
- Current macOS source `7f976c1e06292360160325b00fa0875e6a2567f6`, ZIP SHA-256 `ff9ae3d473f961f38294679a7bdb21c7cc0c905d7791efe9d4b114fc1df903f7`, 38,450,128 bytes; extracted self-test/cold-launch/cleanup passed with ad-hoc/no-Team-ID classification.

## Supply chain

- `GROK_BUILD_INTEGRATION.md`
- `GROK_BUILD_SOURCE_MANIFEST.json`
- `THIRD_PARTY_NOTICES.md`
- `SOURCE_REV`
- `../sbom.cdx.json`

## Release truth

- `../product-release.json`
- `../public-product-metadata.json`
- `ARTIFACT_MANIFEST.json`
- `../release/SHA256SUMS.txt`
- `../release/PROVENANCE.json`
- repository handoff: `docs/handoffs/developer.md`

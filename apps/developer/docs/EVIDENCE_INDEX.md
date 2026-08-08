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
- Current browser-evidence harness source: `98fcbe3cff68b4b01ebfd94df2d1476b41ecf2b5`
- Current targeted verification: Developer client 22/22, Developer Web 21/21 locally (20/20 on artifact-source Windows CI), browser syntax, static claim/workflow, standalone Web build, live compile, same-origin proxy, desktop sandbox 2/2, Windows source boundary and current-source Chrome accessibility audit 15/15.
- Validation-gate evidence: `scripts/validate/no-placeholder-check.sh` and `scripts/validate/secret-scan.sh` execute a verified fallback when `rg` is unavailable; scanner execution errors fail closed.

## Visual evidence

The audited images and their state explanations are listed in
`UI_DESIGN_AUDIT.md`. Historical baseline/final files are under `evidence/ui`.
Current-source deterministic Chrome evidence is under
`evidence/ui/current-accessibility`; `accessibility-audit.json` binds 15 passed
checks and six PNG hashes to clean source commit
`98fcbe3cff68b4b01ebfd94df2d1476b41ecf2b5`. It covers keyboard focus order,
skip navigation, tab roving, the browser accessibility tree, focus visibility,
Light/Dark, reduced motion, 390 px overflow, inert mobile drawers, Arabic RTL,
large text and a 200% page scale. This is product-owner browser evidence, not an
independent accessibility certification or installed-desktop recapture.

## Desktop evidence

- macOS build: `scripts/package-local-macos.sh`
- macOS extracted install/cold start: `scripts/verify-local-macos-package.sh`
- Current macOS source commit: `63a678ac3c423b53c9628fa35c415d554827eccb`
- Current macOS source tree: `0cf68963a1678e6611296684d522b471add4f652`
- Current macOS runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- Current macOS ZIP: SHA-256 `f8988f011cf5f722fcffcf389cc98d678c6ead909177be6211c954c007a45351`, 48,252,013 bytes, `adhoc-no-team-id`, hosted by `developer.ynxweb4.com`
- Embedded SBOM SHA-256: `801af226eda24a8ad4e880f8d36da197ef8af375b62153435dd4c0c75cc8ac12`
- Windows build: `scripts/package-windows.ps1`
- Windows portable install/cold start: `scripts/verify-windows-package.ps1`
- Windows host workflow: `.github/workflows/developer-windows.yml`
- Successful current-source Windows host run:
  `https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/31270548034`
- Windows source `63a678ac3c423b53c9628fa35c415d554827eccb`, job `93135599604`, transient Artifact `9025496664`, inner ZIP SHA-256 `d07163e6d44ddf6363c92429856bd9eaeeed57d1b939c2cf5ea0797146d88c7d`, outer digest `sha256:3baff8df6a53419caa6b8766d21249ff7d1a96512d14bad2ebda0e77cbfab8f4`; the transient Actions artifact expires `2026-08-22T17:56:46Z`, while the exact inner ZIP is hosted by the YNX download domain.
- Current macOS source `63a678ac3c423b53c9628fa35c415d554827eccb`, ZIP SHA-256 `f8988f011cf5f722fcffcf389cc98d678c6ead909177be6211c954c007a45351`, 48,252,013 bytes; extracted self-test/cold-launch/cleanup, public chain/compiler connection, dependency install, permission-bounded test and second runtime launch passed.

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

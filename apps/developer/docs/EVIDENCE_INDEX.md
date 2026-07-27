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
- Current targeted verification: Developer client 22/22, Developer Web 17/17, browser syntax, static claim/workflow, standalone Web build, live compile, same-origin proxy, desktop sandbox 2/2 and Windows source boundary.
- Validation-gate evidence: `scripts/validate/no-placeholder-check.sh` and `scripts/validate/secret-scan.sh` execute a verified fallback when `rg` is unavailable; scanner execution errors fail closed.

## Visual evidence

The audited images and their state explanations are listed in
`UI_DESIGN_AUDIT.md`. Baseline and final files are under `evidence/ui`.

## Desktop evidence

- macOS build: `scripts/package-local-macos.sh`
- macOS extracted install/cold start: `scripts/verify-local-macos-package.sh`
- Current macOS source commit: `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`
- Current macOS source tree: `a0c61afe7ba9e209eab326dcc02fc6568de201d8`
- Current macOS runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- Current macOS ZIP: SHA-256 `55ec683a9ec59db89331bb4ae45c2666ae4e26921b59ac6ec8284efe268281f9`, 38,450,127 bytes, `adhoc-no-team-id`, local and unhosted
- Embedded SBOM SHA-256: `801af226eda24a8ad4e880f8d36da197ef8af375b62153435dd4c0c75cc8ac12`
- Windows build: `scripts/package-windows.ps1`
- Windows portable install/cold start: `scripts/verify-windows-package.ps1`
- Windows host workflow: `.github/workflows/developer-windows.yml`
- Successful Windows host run:
  `https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/29658166198`

## Supply chain

- `GROK_BUILD_INTEGRATION.md`
- `GROK_BUILD_SOURCE_MANIFEST.json`
- `THIRD_PARTY_NOTICES.md`
- `SOURCE_REV`
- `../sbom.cdx.json`

## Release truth

- `../product-release.json`
- `ARTIFACT_MANIFEST.json`
- repository handoff: `docs/handoffs/developer.md`

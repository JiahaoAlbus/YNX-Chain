# Evidence index

## Product behavior

- Cloud toolchain image builder and pinned-server initialize probe:
  `scripts/build-cloud-toolchain-image.sh` and `scripts/lsp-server-probe.mjs`
- Candidate live container gate: `scripts/live-container-check.mjs`; on
  2026-08-10 it passed seven real compile/run paths, six real cloud completion
  paths and PTY-to-workspace synchronization against image fingerprint
  `7662bcfc5ca87f56d6fe47107b10bcbfd36e08d4faad912d2ebfa48976050ae9`,
  then left no runtime container behind.
- Real Remote SSH gate: `scripts/live-ssh-workspace-check.mjs`; it requires an
  explicit public host/user/key at invocation, verifies the reviewed host key,
  opens the profile through the WebSocket terminal broker, writes and pulls a
  remote file, requires revision 2, and removes the profile without exposing the
  key. The 2026-08-10 candidate run passed with deterministic Ed25519 fingerprint
  `SHA256:7wrOak1OZoD6oDAr0e3En+UD4fs8QnAM1n0Jvwi6Ha8`.
- Live YNX Chain tools gate: `scripts/live-chain-tools-check.mjs`; on 2026-08-10
  it authenticated through the same-origin workspace gateway, required chain ID
  6423 and a non-catching-up canonical status, read the current block, joined a
  known Explorer transaction to its EVM transaction and successful receipt,
  checked Solidity 0.8.24 metadata and required a mutating RPC rejection.
  The current gate also requires a real non-negative `eth_gasPrice` result for
  the artifact fee-estimate boundary.
- Chain service unit evidence: `services/chain-service/test/service.test.mjs`
  covers canonical status normalization, the read-only RPC boundary and invalid
  chain-state rejection.
- Workspace-agent Solidity evidence proves that the 0.8.36 standard-JSON build
  returns ABI, bytecode and source-map metadata whose UTF-8 byte counts and
  SHA-256 values match their exact bounded contents. The React workbench then
  verifies these digests with Web Crypto before persistent project insertion.

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
- Current full YNX Code macOS source checkpoint: `89286b8a6e302c75bd398dd9bf8f2f26160248a6`
- Current browser-evidence harness source: `98fcbe3cff68b4b01ebfd94df2d1476b41ecf2b5`
- Current targeted verification: Developer client 22/22 and Developer Web 24/24 both locally and on current-source Windows CI, browser syntax, static claim/workflow, standalone Web build, live compile, same-origin proxy, desktop sandbox 2/2, Windows source boundary and current-source Chrome accessibility audit 15/15.
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
- Current macOS source commit/runtime checkpoint: `89286b8a6e302c75bd398dd9bf8f2f26160248a6`
- Current macOS source tree: `c6d83999d4da084784e3990bd23b3b320ed0c567`
- Current full YNX Code macOS ZIP: SHA-256 `14564fd3a62f21ceb9ac90282a5e2fb41d7b0e2deb70c8d0f6d7e63abd317448`, 177,937,024 bytes, `adhoc-no-team-id`, hosted at the immutable `89286b8a` YNX-domain URL.
- Embedded 267-component SBOM SHA-256: `26c03adeea1121319cf73b1eea402fdba0a718dd31c2e188d6168610c7146bff`
- Windows build: `scripts/package-windows.ps1`
- Windows portable install/cold start: `scripts/verify-windows-package.ps1`
- Windows host workflow: `.github/workflows/developer-windows.yml`
- Successful historical API Studio-generation Windows host run:
  `https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/31288684378`
- Windows source `f179654dd6e1361711ee480e2c6f3f614ad38002`, job `93182036170`, transient Artifact `9030699361`, inner ZIP SHA-256 `5ea83a0dc3c9e377c1358c13910b7dd9ef6d812558f19956f608cfd6b1344822`, outer digest `sha256:803db91ca14d594c9665181a49cc80488f2c51f0ff0776d0eead714f4ccb076a`; the transient Actions artifact expires `2026-08-23T01:39:57Z`, while the exact inner ZIP is hosted by the YNX download domain.
- Current macOS source `89286b8a6e302c75bd398dd9bf8f2f26160248a6`, ZIP SHA-256 `14564fd3a62f21ceb9ac90282a5e2fb41d7b0e2deb70c8d0f6d7e63abd317448`, 177,937,024 bytes; extracted provenance/SBOM/signing checks, cold launch, JavaScript/C++ toolchain discovery, real bounded C++ compilation, workspace save, child cleanup and persistent second launch passed. The Windows artifact above is not the current full YNX Code build.

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

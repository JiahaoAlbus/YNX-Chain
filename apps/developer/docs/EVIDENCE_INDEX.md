# Evidence index

## 2026-08-31 current desktop-install truth

Historical ZIP records in this index remain preserved, but are not current
installer evidence. `evidence/desktop/macos-current-ccab67b2.json` records a
locally installed ARM64 DMG with `downloadHosted=false`;
`evidence/desktop/windows-current-fa73d751.json` records a Windows CI MSIX
installation lifecycle with `downloadHosted=false`. Neither has immutable
official-domain hosting or external HTTPS byte/hash readback. Do not use any
historical ZIP URL as a desktop installer CTA.

## 2026-08-20 current public candidate

`evidence/public/current-public-candidate-bc8a37bc6f2b.json` binds the current
Developer candidate `bc8a37bc6f2bcfcbe9415cb0e9da17a5294046a3` to its protected
deployment transaction, immutable LXD image, health/version response and
evidence-manifest SHA-256. It is direct host-side release evidence. Independent
external browser visibility and current Windows desktop artifact evidence remain false; the
current macOS artifact has separate extracted-install and official-domain hash evidence.

The macOS ARM64 artifact was additionally downloaded through the official
HTTPS route with IPv4/HTTP 1.1 on 2026-08-21: the 200 response declared and
delivered 168157529 bytes, whose SHA-256 is
`af4c57b89ad5d7cca6c42af47f33d156d182a92870e4d43ed1d558f51de1b01f`.
`evidence/desktop/macos-current-e01b9e4a.json` records this transfer. It proves
hosted artifact integrity only; external browser visibility, production signing,
notarization and store release remain false.

The direct public runtime probe on 2026-08-21 reports a ready Bubblewrap sandbox
and C/C++, JavaScript/TypeScript, Python, Go, Rust and Solidity compilers. It
also reports all seven language-service routes, including Java, but `java` is
explicitly `false` as a compiler. An unauthenticated runtime-profile request
returns `401 workspace_session_required`. The exact probe and blocker are in
`evidence/public/current-public-candidate-bc8a37bc6f2b.json`; Java execution is
not claimed until a reviewed candidate-image/package-egress transaction installs
the JDK and a signed workspace can run it.

The current cross-product contract and gaps are maintained in
`release/integration/developer-contract.json`,
`docs/integration/INTEGRATION_HANDOFF.md`,
`docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`,
`docs/integration/DEPENDENCY_ACCEPTANCE.md`,
`FEATURE_COMPLETION_EVIDENCE.md` and `MIGRATION_COMPATIBILITY.md`.

- DApp Connect SDK handoff: `evidence/integration/dapp-connect-sdk-pr130-8cfb3265.json`
  captures the clean PR #130 source candidate, its exact five-path manifest
  delta, central base and replayed 12/12/scanner/release-gate evidence. It is
  explicitly source-only and records no public SDK, npm, Faucet, endpoint,
  installed-product, ComputerControl or migration success.

- Production package-egress policy: `scripts/verify-package-egress-network.mjs`
  checks the exact dedicated bridge and ACL before any protected deployment
  mutation. `test/package-egress-network.test.js` proves the reviewed
  DNS/HTTPS-only default-reject policy and rejection of broad egress, profile
  attachment, firewall disablement and external bridge bypass. The deployment
  transaction archives raw network/ACL JSON and the normalized review result.
  This is implementation evidence only; the production objects remain absent
  until the operator explicitly approves their creation.
- Public package persistence gate: `scripts/live-package-install-check.mjs`
  installs exact npm/Python dependencies, validates disabled npm scripts and
  SHA-256-bound binary wheels, runs both with the task network disabled, persists
  all three lock/manifest files, and repeats both imports after a service restart.
  `test/package-public-gate.test.js` exercises prepare/resume and cleanup against
  the HTTP contract; the deployment transaction separately captures LXD device
  inventories and fails on any residual temporary package NIC.

## Current recovery audit

The 2026-08-13 preservation audit and requirement/current-state/evidence/gap
matrix is recorded in `RECOVERY_AUDIT_2026-08-13.md`. It binds the clean,
upstream-synchronized repository checkpoint
`e061a30e801a9075dfea212a854b3d7d578d7e85` without rewriting the exact older
source and runtime checkpoints embedded in already-published desktop artifacts.

The independent pre-deploy public probe is machine-readable at
`evidence/public/ynx-code-public-predeploy-probe-20260813.json`. It records the
public `17ee9ae5` release, seven runtime/compiler routes, missing public Java,
and the failed strict read-only operator authentication probe without recording
credential material. It is evidence that Java was not yet deployed, not a
successful eight-runtime release record.

## Product behavior

- Web npm evidence: `runtime-profile-service` exercises owner/project scoping,
  exact-version rejection, exact existing dependency reconciliation, lifecycle
  script denial, bounded persistent storage, runtime `node_modules` linking and
  cleanup of temporary package egress on both success and failure.
  `test/package-install-ui.test.js` holds the React review, one-time approval,
  returned manifest/lockfile mutation and fail-closed language.
- Web Python package evidence: the same service rejects ranges, non-canonical
  locks and cross-owner access, permits binary wheels only, requires pip report
  SHA-256 evidence for every installed wheel, atomically swaps a bounded project
  venv, links it into later isolated Python execution and always
  removes temporary egress. The direct wheel probe used controlled Python
  `3.12.13`, installed and imported `colorama==0.4.6`, then produced wheel
  SHA-256 `4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6` and the exact
  canonical lock. This local proof does not claim the production LXD network or
  public service has been updated.
- Breadcrumb/Outline evidence: `test/breadcrumb-outline-ui.test.js` holds path
  hierarchy, Outline activity, exact-content freshness and Monaco line/column
  navigation. `services/language-service/test/typescript-lsp.test.mjs` executes
  a real `textDocument/documentSymbol` request through the no-network language
  sandbox and verifies the returned `add` function symbol.
- Problems-panel evidence: `test/problems-panel-ui.test.js` holds the Monaco/LSP
  callback to structured severity/location/source/code records, exact-content
  freshness filtering, live counts and source-file navigation. Existing real LSP
  service tests provide the diagnostic payload evidence; unopened files and
  unavailable language servers remain outside the panel's stated coverage.
- Project-test evidence: `services/workspace-agent/test/runtime.test.mjs` executes
  discovered JavaScript, Python unittest, same-package Go, standalone C/C++,
  dependency-free offline Cargo, JUnit Jupiter and Hardhat Solidity tests through
  the real no-network sandbox, then rejects a wrong approval and missing tests.
  `test/project-test-runner-ui.test.js` holds the UI/client to exact discovery,
  one-time review, file/phase bounds and an allowlist that never invokes package
  scripts. The JUnit runner is the SHA-pinned Console Standalone `1.14.2`
  artifact installed by the reviewed image recipe. Cargo uses a canonical
  dependency-free manifest/lock boundary plus `--offline --locked`. The Solidity
  gate compiles two real contracts with Hardhat `3.9.0`, forces the SHA-verified
  solc `0.8.24` WASM artifact, observes one passing `.t.sol` test, and runs with
  network disabled without evaluating workspace configuration or package scripts.
  The local real Cargo gate used the official Rust `1.92.0` macOS arm64 archive
  after SHA-256 verification (`22276ecf826b22e718f099d7bf7ddb8c88aa46230fdba74962ab3c5031472268`).
- Project transfer evidence: `test/project-transfer-ui.test.js` holds Explorer
  directory/versioned-JSON import and JSON export to safe-path, 256-file, 2 MiB,
  strict UTF-8, duplicate, confirmation, collaboration and History boundaries.
  Frontend TypeScript and production build gates compile the File API path; this
  is text-project transfer, not a binary/symlink/permission-preserving archive.
- Project-wide replace evidence: `test/project-replace-ui.test.js` executes the
  literal replacement planner across files, including case policy, regex-like
  search text and `$` replacement text, and holds the UI to exact preview counts,
  confirmation, collaboration write policy, dirty tracking and recovery wording.
- Editor settings evidence: `test/editor-settings-ui.test.js` holds the formerly
  inactive Settings control to a real dialog, sanitized restart-persistent
  preferences, Monaco option wiring and explicit revisioned workspace save when
  auto-save is disabled. Frontend TypeScript and production build gates compile
  the same option contract.
- Workspace revision evidence: `services/workspace-manager/test/store.test.mjs`
  proves owner/project isolation, restart durability, exact idempotent replay,
  immutable snapshots, legacy database backfill, bounded latest-50 pruning and
  revision-guarded one-time restore that creates a new revision. The authenticated
  HTTP gate in `services/workspace-agent/test/runtime.test.mjs` proves metadata-only
  history, full revision export, missing/stale approval rejection and cross-owner
  hiding. `test/workspace-history-ui.test.js` holds the visible server-local
  retention boundary, independent export and confirmed non-destructive restore.
- AI Software Engineer evidence:
  `services/agent-orchestrator/test/service.test.mjs` proves schema-bounded
  Planner/Coder/Reviewer work, one-time write and Tester execution, evidence-led
  fix/review, hash-chain continuity, provider usage retention, reviewed local
  Git preview/commit with stale-repository rejection, and the
  Tester-hash/file-digest deployment review with separate one-time approval.
  `test/agent-deployment-review-ui.test.js` holds the visible context,
  provider/model/token/cost truth and the no-network/no-signing/non-executable
  deployment boundary. The same service/UI gates prove the graded permission
  matrix, owner-scoped approval UUID consumption, replay rejection, durable
  grant/denial decisions and fail-closed unavailable capabilities. It is not
  evidence of a deployment, remote Git operation or of the disabled tool adapters. The orchestrator
  test also applies a real reviewed create alongside a digest-bound edit and
  recoverable delete, rejects an existing-file create collision, then restores
  the deleted content under a new approval and workspace revision. The Web gate
  holds exact approved paths, visible trash and the restore action while keeping
  destructive delete disabled.
- Git broker integration evidence: `services/git-service/test/service.test.mjs`
  runs real Git status/stage/diff/commit/history through both HTTP and the
  direct owner-scoped Agent adapter, local branch creation and
  revision-guarded switching, non-fast-forward merge persistence, conflict abort
  with unchanged authoritative workspace, stable remote-intent preview hashing
  and cross-owner repository isolation. Remote execution remains disabled.
- Extension lifecycle evidence: `services/extension-registry/test/service.test.mjs`
  proves canonical digest installation, replay, persisted disable, stale-digest
  rejection, owner isolation and one-time-approved uninstall. The paired Web
  gate `test/extension-lifecycle-ui.test.js` proves disabled contributions are
  filtered from consumers and the local/declarative-only trust boundary remains
  visible without executable or marketplace loading paths.
- Project-memory lifecycle evidence: `services/project-memory/test/service.test.mjs`
  proves unchanged-vector reuse, changed-chunk incremental rebuild, semantic
  ranking, owner isolation, first-stage-language declaration extraction,
  concrete workspace import resolution, paginated full-content/vector/fact
  export, explicit empty-file revision metadata, legacy metadata migration,
  revision consistency, stale-clear rejection and transactional deletion. The Web gate
  `test/project-memory-lifecycle-ui.test.js` holds view/rebuild/export/clear and
  the honest current-index retention/coverage boundary in the product surface.
- Collaboration lifecycle evidence:
  `services/collaboration-service/test/service.test.mjs` proves owner-only ACL
  visibility, explicit revoke approval, live revocation notification, socket
  close code 4003 and denied HTTP/WebSocket reconnect in addition to CRDT
  convergence and restart recovery. `test/collaboration-lifecycle-ui.test.js`
  guards the durable-access list, confirmation and reconnect-first ACL check;
  shared-terminal input remains explicitly disabled.

- Public full-platform gate: `scripts/live-public-candidate-check.mjs`. Against
  the deployed candidate it requires all nine real runtimes and eight language
  requests across seven LSP routes (C/C++ share clangd),
  twelve concurrent isolated tenant sessions, same-project-name isolation,
  YNX Chain identity, a real hosted `qwen3:4b` Planner run, an attested
  Developer Wallet binding and a closed public Wallet/BFT write gate.
- Restart persistence was separately proven by saving revision 1 and its signed
  session, restarting the systemd service, then reading the same revision with
  the same cookie. The one-time probe secret was removed after verification.

- Cloud toolchain image builder and pinned-server initialize probe:
  `scripts/build-cloud-toolchain-image.sh` and `scripts/lsp-server-probe.mjs`
  verify Eclipse JDT LS `1.61.0-202607142124` against its fixed SHA-256 and
  launch all seven server routes through the reviewed image entry points.
- Java language evidence: `services/language-service/test/java-lsp.test.mjs`
  executes completion, definition, references, rename, formatting, document
  symbols and semantic project diagnostics against the
  pinned JDT LS artifact in the no-network local sandbox;
  `test/java-lsp-ui.test.js` guards the gateway, Monaco, Outline, image and live
  candidate route wiring.
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
- Historical macOS source/runtime checkpoint: `89286b8a6e302c75bd398dd9bf8f2f26160248a6`
- Historical macOS source tree: `c6d83999d4da084784e3990bd23b3b320ed0c567`
- Historical full YNX Code macOS ZIP: SHA-256 `14564fd3a62f21ceb9ac90282a5e2fb41d7b0e2deb70c8d0f6d7e63abd317448`, 177,937,024 bytes, `adhoc-no-team-id`, hosted at the immutable `89286b8a` YNX-domain URL.
- Historical embedded 267-component SBOM SHA-256: `26c03adeea1121319cf73b1eea402fdba0a718dd31c2e188d6168610c7146bff`
- Windows build: `scripts/package-windows.ps1`
- Windows portable install/cold start: `scripts/verify-windows-package.ps1`
- Windows host workflow: `.github/workflows/developer-windows.yml`
- Successful current hosted-workspace Windows host run:
  `https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/31342901937`
- Windows source `90da333dc98ccb9b98d49d17187d4ea5c47c5050`, run `31342901937`, job `93319490655`, transient Artifact `9046377906`, inner ZIP SHA-256 `890f4e4bb331934a81fb9269aec552b3f55e147cd7cc7c04bcef4166e9c61886`, SBOM SHA-256 `d47f774c89c5097aff5c50ca8b14983463726eca5d29d60376634a4aaf8925e2`, outer digest `sha256:3ba7a4307897a239fc2ebec4081676bc9022c5d70c763ecc4bbae55842d9115d`; the transient Actions artifact expires `2026-08-23T23:52:14Z`, while the exact inner ZIP is hosted by the YNX download domain. It cold-launched twice and completed a real remote C++ compile through the public YNX Code workspace.
- Historical macOS source `89286b8a6e302c75bd398dd9bf8f2f26160248a6`, ZIP SHA-256 `14564fd3a62f21ceb9ac90282a5e2fb41d7b0e2deb70c8d0f6d7e63abd317448`, 177,937,024 bytes; extracted provenance/SBOM/signing checks, cold launch, JavaScript/C++ toolchain discovery, real bounded C++ compilation, workspace save, child cleanup and persistent second launch passed.
- Historical macOS source `cb57e10f7f92b01b73942879dedc98f059a1e20b`, ZIP SHA-256 `f4759ecc6bb5240a972bc7cd9909b35869bb756cce5a22f1a23bf1f718f522f9`, 168,157,234 bytes; extracted verification performed Keychain session-storage write/read/cleanup before cold launch, bounded C++ compile and persisted second launch.
- Current macOS source `e01b9e4a8cc00be2e590e86e8f043fd746696adf`, ZIP SHA-256 `af4c57b89ad5d7cca6c42af47f33d156d182a92870e4d43ed1d558f51de1b01f`, 168,157,529 bytes; its 269-component SBOM is `37436588278850c5052d2032f917572dade2af7cf56c4228d4f79f5359568e9f`. Extracted verification performed Keychain session-storage write/read/cleanup and an actual `NSWorkspace` `ynxwallet` scheme lookup, which found no installed Wallet (`installed=false`, `schemeRegistered=false`), then passed cold launch, bounded C++ compile and persisted second launch. The unsigned ZIP, SBOM and provenance are immutable official-domain downloads; the exact machine-readable record is `evidence/desktop/macos-current-e01b9e4a.json`.
- Current Linux x64 Server source `bc8a37bc6f2bcfcbe9415cb0e9da17a5294046a3`, TAR.GZ SHA-256 `aab9fb6ea976fffab0ae66382401bf8e9886a05fb377f483dc46103fd8be4c05`, 138,538,840 bytes. The self-hosted server appliance was bound to the passed protected deployment evidence manifest, excludes workspace state/operator environment, then passed extracted cold start and `healthz` verification. Its unsigned archive and provenance are immutable official-domain downloads; the exact record is `evidence/platform/linux-server-current-bc8a37bc.json`.
- Current Windows x64 hosted-workspace source `6ac39fd140a54675526583c4c3ca6b07fc03af19`, runtime checkpoint `bc8a37bc6f2bcfcbe9415cb0e9da17a5294046a3`, ZIP SHA-256 `10b6914614a86f694d9e58b21e311148b1dd0dc4b21ff39612c4a2486c5e0627`, 72,538,901 bytes and SBOM SHA-256 `8223b35dd1abb7a0a948af4360070b369afe278059d8a9ee7f3ff6ce931bf403`. CI run `32396185202` passed portable extraction, resource self-test, Authenticode `NotSigned`, public workspace connection, a real remote C++ compile and two cold launches. ZIP/SBOM/provenance/checksum production Caddy readback passed; it is an unsigned hosted-workspace client, not a local compiler sandbox. The exact record is `evidence/desktop/windows-current-6ac39fd1.json`.

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

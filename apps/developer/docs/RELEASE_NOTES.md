# YNX Developer 0.2.0 Testnet Preview release notes

## 2026-08-15 Python, Rust, Go and Node.js DAP in the isolated cloud runtime

- Python files can now start a real debugpy DAP session after the user selects
  an owner/project-bound LXD runtime. Breakpoints, stack frames, scopes and
  variables use workspace-relative paths; the runtime lease is locked until
  cleanup and the container keeps external networking disabled.
- debugpy 1.8.21 is installed from an exact PyPI wheel URL with SHA-256
  `b1e37d333663c8851516a47364ef473da127f9caebe4417e6df6f5825a7e9a92` in
  both the candidate verifier and immutable cloud image.
- The protected live-container gate now stops at Python line 2 and proves the
  local variable `value = 7` before accepting the candidate.
- Rust files use the same project-bound container, compile with debug info and
  overflow checks, then launch Ubuntu's pinned `lldb-dap-18`. The protected
  gate stops at Rust line 3 and requires the local variable `value = 9`.
- Go files use pinned Delve 1.25.2 through a reviewed stdio-to-loopback bridge
  wholly inside the no-NIC LXD lease. Each session gets a dynamically selected
  loopback port, an owner/project-bound temporary source tree and deterministic
  cleanup. The protected gate requires a Go line-5 breakpoint and `value = 11`;
  target-image evidence remains pending until the protected transaction runs.
- JavaScript files use Microsoft's official standalone js-debug 1.117.0 asset,
  verified by SHA-256 before atomic installation. A bounded bridge handles the
  adapter's child DAP session, reapplies only already-approved breakpoints and
  uses per-session Unix sockets rather than TCP. A real local gate stops at
  Node line 3 and reads `value = 13`; the protected image gate repeats it.

## 2026-08-15 production package-egress policy candidate

- Added a deterministic LXD 5.21 bridge/ACL verifier for the fixed
  `ynx-code-package-egress` network. The reviewed policy is default-reject,
  DNS/HTTPS-only, explicitly denies private/special destinations, rejects
  profile attachment and firewall/raw/external-bridge bypasses, and accepts only
  owner-bound YNX runtime lease attachments.
- The protected public deployment transaction now captures the raw network and
  ACL JSON plus a normalized review result before dependency installation,
  image creation, service stop or symlink mutation. A missing or changed network
  fails without touching the running public candidate.
- The same transaction now performs real exact npm and Python installs in one
  owner-bound LXD lease, runs both dependencies with runtime networking disabled,
  persists `package.json`, `package-lock.json` and the SHA-256-bound
  `requirements.ynx.lock`, restarts the service, reruns both dependencies, and
  removes the probe lease. Pre/post-restart LXD inventories reject any remaining
  `ynx-package-egress` NIC.
- `PACKAGE_EGRESS_NETWORK.md` contains the exact proposed creation, verification
  and unused-object rollback transaction. It remains unapplied pending explicit
  production-owner approval; the default `lxdbr0` is not accepted. Feature
  source including the restart/package gate:
  `a30308dc1320372c09c7dd03d7715e6a828a68c4`.

## 2026-08-14 reviewed Python wheel installation candidate

- Added an explicit npm/Python selector to the one-time package review. Python
  accepts only exact `name==version` requests and records the resolved environment
  in `requirements.ynx.lock`. The lock now binds each resolved binary wheel to
  the SHA-256 supplied by pip's machine-readable install report; missing or
  malformed integrity evidence fails before the atomic venv switch.
- The LXD adapter forces `--only-binary=:all:` and `--no-input`, rejects source
  builds, checks the existing lock against the persisted environment, atomically
  swaps a 512 MiB-bounded project venv, and makes later isolated Python tasks use
  it. Temporary package egress must be removed before success; cleanup uncertainty
  stops the container.
- Service tests pass `14/14`; product tests pass `56/56`; a controlled Python
  `3.12.13` probe installed and imported the real `colorama==0.4.6` wheel and
  produced the same exact lock. The later integrity slice binds that lock to the
  real wheel SHA-256. Feature source:
  `f2b9e18c374d932ecb41f0f63b4007d9e3a8115e`. Public exact-version and container
  install evidence remain pending the dedicated reviewed LXD egress network.

## 2026-08-14 real offline Hardhat Solidity project-test candidate

- Added server-side discovery for Solidity `.t.sol` files containing `test*`
  functions and real Hardhat `3.9.0` Solidity test execution inside the existing
  one-time-approved, no-network project-test sandbox.
- The runner copies only regular `.sol` sources into an isolated generated
  Hardhat project, ignores workspace configuration/plugins/package scripts,
  forces WASM compilation, and verifies the pinned solc `0.8.24` artifact SHA-256
  `fb59b825b7d57f9de89cd9de2415b12aab1fcc7eb2573fd2bf5c9b969eacf4d9`.
- The direct integration gate compiled two Solidity files with solc `0.8.24`,
  observed one passing contract test, and joined the full workspace-agent `15/15`
  pass. Feature source: `c0d8fe2dc0c406ad70843ab4fbb8e9cd8c537c60`.
  Public exact-version verification remains pending.

## 2026-08-14 real offline Cargo project-test candidate

- Added server-side discovery of Rust `#[test]` functions and a real Cargo test
  phase. It accepts only a minimal dependency-free `[package]` manifest, creates
  or verifies the canonical dependency-free lock, and runs `cargo test --offline
  --locked` with an isolated target and Cargo home inside `.ynx-build`.
- The test action preserves the existing one-time approval, 32-file/20-phase,
  process, time, output and no-network boundaries. It does not read the user's
  Cargo cache, run build scripts from dependencies or claim Cargo package
  installation.
- The reviewed image gate now requires both `rustc` and `cargo`; the direct test
  executes with the official Rust `1.92.0` macOS arm64 archive after verifying
  SHA-256 `22276ecf826b22e718f099d7bf7ddb8c88aa46230fdba74962ab3c5031472268`.
  This limitation was superseded by the later pinned Hardhat Solidity test slice.

## 2026-08-14 real JUnit project-test candidate

- Added server-side discovery for `*Test.java` and `*Tests.java` below
  `src/test/java`, compilation of the explicit Java workspace, and real JUnit
  Jupiter execution inside the existing no-network project-test sandbox.
- Pinned JUnit Platform Console Standalone `1.14.2` to SHA-256
  `5566ffe2aa48263867bca745925f73bf7b01591b30d9a60f191c0b16fa0955e9`.
  The image recipe verifies the immutable Maven Central artifact and its CLI
  before publishing the LXD image.
- The direct integration gate compiles a production class and JUnit test,
  observes one successful test, preserves one-time review and file/phase limits,
  and confirms the sandbox reports network disabled. At that checkpoint,
  Maven/Gradle dependency installation, Cargo and Solidity-framework project
  tests remained open; the later Cargo and Hardhat slices supersede the last two.

## 2026-08-14 real Java language intelligence candidate

- Added a dedicated Java route from Monaco and Outline through the authenticated
  workspace language bridge to Eclipse JDT Language Server. Completion,
  definition, references, rename, formatting, diagnostics and document symbols
  now use the same owner/project/runtime boundary as the existing LSP routes.
- Pinned Eclipse JDT LS `1.61.0-202607142124` from the Eclipse Foundation to
  SHA-256 `4dc0747f22fb86dfada4c9214d3ef94c94f1e84eb57ce52126c26ecf2f17dce4`.
  The reviewed image build verifies the archive before extraction and probes a
  real initialize exchange under OpenJDK 21.
- A direct acceptance gate starts that exact artifact in the no-network local
  sandbox and verifies Java completion, definition resolution and semantic
  project diagnostics. The repository launcher caps the JVM at 768 MiB and
  avoids the upstream snapshot launcher's invalid process argument boundary.
- The JSON-RPC client now answers bounded, non-executing server requests such as
  workspace configuration and capability registration, which JDT LS requires,
  while refusing to apply server-originated workspace edits automatically.
- The protected live gate now requires eight requests across seven LSP routes,
  including Java completion inside the selected no-network LXD runtime. This
  does not add Maven/Gradle dependency installation, JUnit project testing or a
  public deployment claim.

## 2026-08-14 real C17 build, test and debug path

- Added a distinct `.c` runtime adapter using `clang`/`gcc` with C17, warnings
  and pedantic checks; C is no longer inferred from the existing C++ adapter.
- Project Test now discovers standalone `.c` files under `test/` or `tests/`,
  compiles each without network or a shell and executes the bounded output.
- The selected LXD workspace uses an equivalent fixed `clang -std=c17` plan,
  and the LLDB DAP bridge now accepts `.c`, reports language `c` and builds with
  the C compiler rather than `clang++`.
- Clangd now opens `.c` documents with language identifier `c`; direct gates
  exercise real C completion and diagnostics. The protected live candidate gate
  now requires a ninth, distinct C runtime build and a C clangd request.
- Direct gates compile and run a real C program and standalone C test. This does
  not add CMake, Meson, Makefile execution or an arbitrary build-command path.

## 2026-08-14 reviewed Web npm installation

- Added a one-time reviewed Package action for selected project-bound LXD
  workspaces. It accepts only one exact registry version and requires every
  existing direct dependency to be exact before reconciliation.
- npm runs without a shell using `--ignore-scripts --save-exact --no-audit
  --no-fund`, a 120-second/output bound and a 512 MiB project store limit.
  Temporary package egress is removed before success; cleanup uncertainty stops
  the container and fails closed.
- Installed `node_modules` persist in the owner's project container and are
  linked into later build/run tasks. Updated `package.json` and
  `package-lock.json` return through the 256-file/2 MiB workspace boundary.
- This slice covers npm in an explicitly selected LXD runtime. pip, Cargo, Go,
  Maven/Gradle and Solidity framework installers remain open adapters.
- Full-gate retesting exposed Nomic Solidity language-server initialization
  exceeding the generic 8-second RPC budget under load. Solidity now has a
  bounded 20-second initialization/request budget. A later loaded run proved
  TypeScript document symbols and concurrent completion can cross the same old
  threshold, so all LSP initialization and request operations now use the same
  bounded 20-second ceiling alongside existing queue, memory and process limits.
- Repeated full-gate runs also proved cold Go project-test compilation could
  exceed its former 20-second phase limit under concurrent load. The Go test
  phase now has a still-bounded 90-second budget, and compiler version probes
  have a 10-second bound; process, memory and output limits remain unchanged.
- The workspace-agent acceptance suite now runs its independent real compiler
  cases serially so JDK, Go and Solidity cold starts do not starve one another.
  Its dedicated parallel-user case still executes concurrent isolated tasks and
  continues to prove the production concurrency boundary.

## 2026-08-14 real Breadcrumb and Outline navigation

- Added a path breadcrumb above Monaco using the current workspace and active
  file hierarchy, with Explorer navigation and an accessible current-page item.
- Added an Outline activity backed by the configured language server's real
  `textDocument/documentSymbol` response. Hierarchical symbols retain their
  kind and location; selecting one opens the source and focuses its exact line
  and column in Monaco.
- Outline results are bound to the exact active-file content and discarded on
  edits. The empty and unavailable states do not imply whole-project coverage.

## 2026-08-14 real Problems panel

- Replaced the static Problems `0` placeholder with current Monaco/LSP error,
  warning and information records, including file, line, column, source and code.
- Problems are severity-sorted, keyboard-focusable and open their source file.
  Each result is bound to the exact file content diagnosed, so edits invalidate
  stale entries instead of presenting old diagnostics as current.
- Coverage is explicitly limited to opened files for which a configured language
  server returned diagnostics; this is not a whole-project static-analysis claim.

## 2026-08-14 reviewed project tests

- Added a real `test-project` workspace task and Test action with an exact
  discovered-file preview plus a separate one-time `test-once` approval.
- The network-disabled sandbox runs Node's built-in test runner, Python unittest
  scripts, same-package Go tests and standalone C/C++ tests. Direct integration
  evidence executes all five runner classes, streams output and verifies the sandbox boundary.
- Discovery is capped at 32 files and execution at 20 phases with existing
  output, time, memory and process limits. Package scripts and user-selected
  commands are never executed. Rust/Cargo, Java/JUnit and Solidity-framework
  project test adapters remain outside this checkpoint and are not claimed.

## 2026-08-14 bounded project transfer

- Added Explorer actions to import a Chromium-selected directory, import a
  versioned `ynx-code-project/v1` JSON export and download the complete current
  text project as JSON.
- Import enforces the authoritative 256-file/2 MiB ceiling, safe relative paths,
  strict UTF-8 decoding, duplicate-path rejection, explicit project replacement
  confirmation and collaboration write policy. Imported state follows the normal
  revisioned save and Workspace History recovery path.
- Directory transfer does not claim binary, symlink, permission, executable-bit
  or empty-directory preservation; use Git or an external archive for those.

## 2026-08-14 project-wide literal replace

- Extended Search with case-sensitive or case-insensitive literal replacement,
  exact match/file counts, explicit confirmation and multi-file dirty tracking.
- Replacement treats regex metacharacters and replacement `$` sequences as
  literal user text. Changed files enter the normal revisioned save and Workspace
  History recovery path; read-only collaborators cannot apply replacements.
- Removed the inactive editor-toolbar dropdown control.

## 2026-08-14 real editor settings

- Replaced the inactive activity-bar Settings control with an accessible dialog
  for Monaco font size, minimap, word wrap, auto-save and bounded auto-save delay.
- Preferences are schema-sanitized, device-local and restart-persistent. Disabling
  auto-save makes explicit Save write through the revision-checked workspace API;
  it does not silently downgrade to browser-only persistence.

## 2026-08-14 workspace revision history and restore

- Added immutable owner/project workspace snapshots for every accepted mutation,
  with SHA-256 metadata, restart-safe legacy backfill and a latest-50 retention
  ceiling.
- Added authenticated metadata history and full JSON revision export. A reviewed
  restore requires the exact current revision, a fresh owner-scoped one-time UUID
  and an idempotency key, then creates a new revision instead of rewriting history.
- Added a Workspace History activity view with explicit confirmation and honest
  capacity language. This is server-local recovery, not replicated object-store,
  container-volume or disaster-recovery backup.

## 2026-08-14 structured project memory

- Extended owner/project/revision-isolated memory with a transactional facts
  index for files, source declarations and workspace-file import relations.
- Declaration extraction covers JavaScript, TypeScript, Python, Go, Rust,
  C/C++, Java and Solidity. A relation is marked resolved only when the exact
  target exists in the same workspace snapshot; external dependencies remain
  visibly unresolved.
- Chunk/vector and fact exports are independently paginated against one
  revision. Explicit index metadata preserves empty-file projects and migrates
  existing chunk indexes. Rebuild and clear update every derived layer in one
  SQLite transaction.
- API call/reference graphs, architecture decisions, change/test history and
  user preferences remain outside this checkpoint and are not claimed by the UI.

## 2026-08-14 reviewed Agent local Git

- Added a separate local-only Agent Git review after passing Tester evidence.
  Its artifact binds workspace revision, local branch/HEAD, exact message,
  changed-path digests/byte counts and the Tester event hash.
- A fresh `git-local-commit-once` UUID is required before the owner-isolated Git
  broker can initialize, stage only reviewed paths and create the local commit.
  Repository or workspace drift is rejected; revalidation, staging and commit
  run under one owner/project lock, and the resulting commit enters the
  hash-chained audit ledger.
- Pull, push, PR creation, credential access, hooks, signing and Git network
  operations remain explicitly disabled.

## 2026-08-13 Java runtime candidate

- Added a real Java adapter to both the local workspace agent and the isolated
  LXD runtime profile. `javac` writes only beneath `.ynx-build/java`; `java`
  launches the declared package through a fixed classpath with no network.
- The local installed-JDK integration gate compiled and ran a packaged Java
  application. Workspace Agent now passes 10 tests with the Rust host-toolchain
  test still honestly skipped; runtime profiles pass 6/6.
- Updated the reviewed Ubuntu image recipe to include OpenJDK 21 and persist its
  exact Debian package versions. This source checkpoint is not evidence that a
  new LXD image was built or publicly deployed; the public candidate remains the
  seven-runtime image until a new immutable fingerprint and live gate exist.

## 2026-08-10 full YNX Code macOS package

- Replaced the legacy single-page desktop payload with the complete React,
  Monaco and service-based YNX Code workbench and its gateway, terminal,
  compiler, language, debug, Git, extension, model, memory, agent,
  collaboration, Wallet and Chain services.
- Bundled Node 24.14.0, npm 11.17.0 and the complete production dependency
  closure. The deterministic CycloneDX manifest records 267 components; its
  SHA-256 is `26c03adeea1121319cf73b1eea402fdba0a718dd31c2e188d6168610c7146bff`.
- The extracted official ZIP passed provenance and nested ad-hoc signature
  verification, cold launch, JavaScript/C++ toolchain discovery, a real bounded
  C++ compilation, workspace save, process cleanup and a second launch that
  recovered the saved workspace.
- Published the current unsigned macOS arm64 Testnet Preview at the immutable
  YNX-domain URL ending in `89286b8a-macos-arm64-unsigned.zip`: SHA-256
  `14564fd3a62f21ceb9ac90282a5e2fb41d7b0e2deb70c8d0f6d7e63abd317448`,
  177,937,024 bytes. The earlier `472c9bac` candidate was removed because its
  SBOM did not inventory the complete desktop dependency closure.
- Public Web runs the full YNX Code platform. Windows is delivered as a current
  hosted-workspace WebView2 client rather than a bundled local compiler runtime. This package
  is not notarized, Developer ID signed, production released or evidence that
  the public BFT deployment gate has opened.

## 2026-08-10 public full-platform Web cutover

- Built source `17ba15d6617ec83d7befe7cba4f064f0edecccf6` on the public Linux host with
  npm reporting zero installed-package vulnerabilities and deployed it as an
  isolated systemd candidate on loopback port 18113.
- The live gate passed seven runtime builds, six language servers, twelve
  concurrent tenants, tenant isolation, Chain identity and height, hosted
  `qwen3:4b` health and a real Planner run. A separate restart gate recovered
  the signed session and SQLite workspace.
- Caddy moved `developer.ynxweb4.com` from the historical 18111 surface to the
  verified 18113 service. The old service remains active only as the explicit
  rollback upstream; official direct downloads remain under the same domain.
- Wallet registration is attested, but Wallet public readiness and public BFT
  IDE actions remain false. The cutover does not authorize chain writes.

## 2026-08-10 live YNX Chain tools candidate

- Replaced the obsolete injected-provider `/wallet-auth/challenges` and
  `/wallet-auth/sessions` login with the reviewed Developer binding and exact
  `ynxwallet://authorize?request=<base64url(canonical JSON)>` transport. The
  request binds `ynx-developer-v1`, the desktop preview bundle, registered
  callback, compressed P-256 product-device key, sorted least-privilege scopes,
  nonce and five-minute expiry.
- The Web workbench now states that it cannot receive the registered
  `ynxdeveloper://wallet-auth/callback`; it links to installation and never
  creates an account session. Only a reviewed desktop bridge may open an exact
  Wallet review, and even that remains `wallet-review-opened` until callback and
  central Gateway completion pass. Wallet/Auth 107/107 and Wallet 39/39 approve
  the same tuple on the Wallet-owned branch; central deployment remains false.
- Added a signed-workspace and concurrency-bounded Wallet readiness service. It
  reads only the fixed loopback canonical Gateway `health`, `ready` and
  `version` surfaces, enforces response/time bounds and requires the version
  response to attest both the exact Developer client ID and a registry SHA-256.
  A running older Gateway is shown as online but cannot unlock the Developer
  review button. On the current host the Finance build `6b6cb8f5…` is healthy,
  while the Developer registry remains correctly closed.
- The React desktop profile now creates one non-extractable WebCrypto P-256
  private key in IndexedDB for `ynx-developer-v1`; only its compressed public
  key enters the Wallet request. macOS registers the exact `ynxdeveloper`
  callback scheme, opens only the strict `ynxwallet://authorize?request=...`
  route through the operating system and forwards only the exact one-field
  callback to the workbench. Ordinary Web and Windows portable profiles still
  remain callback-disabled.
- The macOS callback now resumes only its exact pending request, rejects route,
  field, scope, device, lifetime and encoding substitution, signs a 90-second
  product-device challenge and submits canonical JSON through the signed
  workspace route. The server rechecks remote deployment, public readiness and
  the exact registry digest before it will forward completion to the fixed
  loopback Gateway; a Product Session is shown only after the canonical Gateway
  returns its 64-hex binding. The current private candidate deliberately reports
  the public gate closed, so this is implemented and tested current source, not
  a claim that the public desktop login has been released.
- Added the separate exact deployment callback transport. A live
  `developer:deploy` Product Session can prepare an artifact-bound request for
  Wallet; Wallet displays the contract, constructor input, simulation, fixed
  one-YNXT fee, compiler/source identity, session, nonce and expiry, then signs
  the chain's canonical Go-compatible `application_action`. Developer never
  receives a private key.
- Added server-side Product Session introspection and receipt binding. The
  service fixes the required scope, verifies the device proof, recomputes the
  payload, request, artifact and transaction digests, rejects extra fields,
  broadcasts the exact Wallet byte sequence and waits for a successful chain
  receipt. A failed request is retained rather than presented as confirmed.
- Public IDE action submission is independently gated by
  `YNX_CODE_IDE_ACTION_PUBLIC_READY=false` by default. Current source and
  isolated tests pass; this does not claim that public RPC accepts the new
  action or that public Developer has been cut over.
- Added a same-origin, workspace-session-bound YNX Chain service with a fixed
  canonical Testnet upstream. It exposes bounded network status, block and
  transaction inspection, receipt joining, a read-only JSON-RPC allowlist and
  compiler metadata; mutating RPC methods fail closed.
- Added a dedicated Chain workbench for live height and validator state,
  transaction/block debugging, reviewed read-only RPC calls and three editable
  Solidity starting points: Counter, DataAnchor and BatchPayment.
- The live gate resolved chain ID 6423, an advancing block, the canonical pinned
  compiler metadata and confirmed transaction
  `0x2d61e641fb6cafbf762beade5fd3dfe614cb360c35707a0827365992be8acab0`
  with a successful EVM receipt. It also proved that `eth_sendTransaction` is
  rejected by the Developer gateway.
- Wallet signing and receipt binding are implemented in reviewed current source,
  but remain visibly unavailable on the public surface while its independent
  action and Gateway gates are closed. Opening Wallet review is not a session,
  signature or deployment. The
  public compiler endpoint currently reports deterministic analysis
  metadata for Solidity 0.8.24 and explicitly does not claim production
  compilation. Neither limitation is converted into a successful UI state.
- Successful isolated Solidity 0.8.36 builds now return bounded artifact
  contents as well as byte counts and SHA-256 values. The browser verifies every
  digest before saving ABI, bytecode, source-map metadata and a source/artifact
  manifest under `.ynx-build`; a compiler result cannot silently substitute an
  artifact after the task finishes.
- Added a reviewed creation-bytecode fee estimate using only read-only
  `eth_estimateGas` and `eth_gasPrice`. The UI labels the result as a mutable
  network estimate, never as execution, reservation, signing or deployment.

## 2026-08-10 cloud language-intelligence candidate

- Added project/owner-bound routing from Monaco through the gateway to six
  allowlisted language servers inside the selected network-disabled LXD
  workspace.
- Added completion, definition, references, rename, formatting and diagnostics
  providers for C++, JavaScript/TypeScript, Python, Go, Rust and Solidity.
- Published a reproducible reviewed v2 image with pinned clangd, Pyright, gopls
  and checksum-verified rust-analyzer additions. Its immutable fingerprint is
  `7662bcfc5ca87f56d6fe47107b10bcbfd36e08d4faad912d2ebfa48976050ae9`.
- The live candidate gate passed all seven compile/run paths, all six cloud LSP
  completion paths and PTY workspace synchronization, then deleted the lease
  with no runtime container left behind. This is candidate evidence, not a
  claim that the public Developer surface has been replaced.
- Saved Remote SSH profiles can now open an owner-bound editable terminal
  workspace with strict host-key checking, server-only credential decryption,
  bounded text synchronization and reconnect. The real public-host gate wrote a
  file remotely and advanced the authoritative workspace from revision 1 to 2.
  Arbitrary remote one-click task/LSP execution remains disabled until the
  target toolchain is separately attested.

## 2026-08-09 extension workspace candidate

- Added a dedicated Languages & Compilers view with a truthful inventory of
  Monaco editing support, locally installed language packs, detected device
  toolchains and custom compiler adapters.
- Expanded the executable catalog to more than 35 language families and added
  per-device installation guidance. Registration, removal and each compilation
  remain separate approvals; a reviewed custom adapter may override a built-in
  file-extension compiler choice, commands remain shell-free, and removing the
  override restores the built-in adapter.
- Verified 24 Developer Web tests and 22 client tests, including a real custom adapter compile and
  register/compile/remove lifecycle, plus build, static workflow checks and
  desktop network/workspace sandbox denial.

## 2026-07-29 browser accessibility evidence checkpoint

- Added a deterministic Chrome DevTools Protocol audit harness with no Playwright, Puppeteer or production dependency.
- Bound 15/15 current-source browser checks and six screenshot SHA-256 values to clean pushed commit `98fcbe3cff68b4b01ebfd94df2d1476b41ecf2b5`.
- Verified keyboard-first skip navigation, editor focus, roving panel tabs, Chromium accessibility-tree roles/names/live regions, a 3 px visible focus ring, Light/Dark, reduced motion, exact 390 px no-overflow, inert mobile drawers, single-column mobile API Studio, Arabic RTL with code/JSON LTR, large text and a 200% page scale.
- Developer Web now passes 24/24 locally and on current-source Windows CI, including release-manifest/provenance/metadata consistency and the extensible toolchain lifecycle. Static claim/workflow check remains passed.
- Rebuilt the then-current API Studio-generation desktop Testnet Preview artifacts from `f179654dd6e1361711ee480e2c6f3f614ad38002`: macOS ZIP SHA-256 `172c0c5b8f94e74dee650b4d2dd172c4faef90330a05b1eeb1c0a269c032b52a` (48,253,431 bytes) and Windows ZIP SHA-256 `5ea83a0dc3c9e377c1358c13910b7dd9ef6d812558f19956f608cfd6b1344822` (114,789,406 bytes). The macOS package was superseded by the full YNX Code build above.
- Current Windows run `31342901937` passed client and Web tests, build, precise runtime inventory, Authenticode `NotSigned`, portable extraction, WPF cold launch, public workspace connection, a real remote C++ compile and a second GUI launch. Artifact `9046377906` remains transient, while the exact 72,538,896-byte inner ZIP is hosted at the immutable YNX-domain download URL.
- YNX AI Build now defaults to the server-hosted `qwen3:4b` open model with a two-active/32-queued concurrency boundary; xAI and OpenAI bring-your-own-key providers are allowlisted and request-only.
- Desktop packages now include npm, persist isolated per-project dependencies across restarts, and run check/test tasks under Node permissions; macOS adds an outer operating-system sandbox.
- The GitHub pre-release now provides immutable unsigned downloads. Central integration, staging/public Web deployment, production signing and store release remain false.

## 2026-07-27 current-source checkpoint

- Added a fail-closed API Studio with OpenAPI 3.0/3.1 JSON validation, reviewed request previews, explicit approval, origin controls, bounded response inspection, deterministic provider-failure simulations, TypeScript client generation and adapter manifests.
- Added reviewed non-affiliation templates for WalletConnect, Bridge, Card, Search, Storage, Mail, Shipping and Oracle.
- Added a credential-reference-only host broker boundary. Browser JavaScript never resolves credential values.
- Added contract-first handoff, dependency acceptance, ten cross-product vectors and a machine-readable full-goal coverage matrix.
- Added all API Studio labels, approval semantics, dynamic states and bounded error classes across the 12 supported locales; Arabic uses RTL interaction layout while source, JSON and URL fields remain LTR.
- Added tablist/tab/tabpanel semantics, roving focus, ArrowLeft/ArrowRight/Home/End navigation, a focusable polite output region and 390px wrapping rules.
- Repaired placeholder and credential-leak gates so a missing `rg` binary cannot produce false success; the verified fallback now distinguishes findings, clean results and scanner execution failure.
- Verified 22 Developer client tests, 17 Developer Web tests, static claim/workflow checks, standalone Web build, browser module syntax, live compile, same-origin proxy and desktop sandbox boundaries.
- Built the current-source macOS arm64 unsigned Testnet Preview from `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`; embedded source tree, runtime checkpoint and SBOM provenance; verified extraction, resource self-test, strict ad-hoc/no-Team-ID classification, GUI cold launch, bundled server observation and child cleanup. ZIP SHA-256: `55ec683a9ec59db89331bb4ae45c2666ae4e26921b59ac6ec8284efe268281f9`, 38,450,127 bytes.
- Current YNX Code is available through the public Web IDE, a full macOS arm64 package and a Windows x64 hosted-workspace client. Production signing and the owner-gated public BFT deployment action remain unavailable.

## 2026-07-18 package checkpoint

- Added YNX AI Build plan/review/apply/revert/audit state machine, permission
  matrix, tool timeline, persistence and checkpoint recovery.
- Added optional exact-pinned Grok Build ACP sidecar verification and
  default-deny permission brokerage; no upstream binary is bundled.
- Reworked the Web IDE into a dense VS Code-class workbench structure with
  desktop light/dark, responsive mobile, large text and Arabic RTL evidence.
- Extended the critical workbench vocabulary across 12 locales.
- Added real Windows build/package/portable-install/cold-launch CI workflow.
- Reverified the unsigned macOS ZIP through extraction, ad-hoc signature check,
  resource self-test, real cold launch, bundled child observation and cleanup.
- Preserved Wallet-only deployment: no key custody, no local unsigned bypass,
  and no success without an authoritative receipt.

This is a published unsigned Testnet Preview. It is not centrally integrated,
staged, publicly deployed as a Web product, production-signed or store-released.

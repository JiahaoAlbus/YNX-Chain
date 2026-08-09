# YNX Developer 0.2.0 Testnet Preview release notes

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
- Public Web and Windows remain the older API Studio generation. This package
  is not notarized, Developer ID signed, production released or evidence that
  the public BFT deployment gate has opened.

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
- Windows run `31288684378` passed 22 client tests, 24 Web tests, compile, provenance, native self-test, Authenticode `NotSigned`, portable extraction, WPF cold launch, bundled server observation and cleanup. Artifact `9030699361` remains transient, while the exact inner ZIP is hosted at the YNX-domain download URL.
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
- Current-source API Studio is installed locally on macOS arm64 only. The Windows artifact remains historical. Central integration, staging/public deployment, hosted downloads and production signing remain false.

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

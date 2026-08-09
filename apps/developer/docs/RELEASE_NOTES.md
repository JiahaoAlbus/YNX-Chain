# YNX Developer 0.2.0 Testnet Preview release notes

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
  central Gateway completion pass. Wallet/Auth 105/105 and Wallet 39/39 approve
  the same tuple on the Wallet-owned branch; central deployment remains false.
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
- Wallet signing, broadcast and deployment remain visibly unavailable in this
  slice. Opening Wallet review is not a session, signature or deployment. The
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
- Rebuilt both current-source desktop Testnet Preview artifacts from `f179654dd6e1361711ee480e2c6f3f614ad38002`: macOS ZIP SHA-256 `172c0c5b8f94e74dee650b4d2dd172c4faef90330a05b1eeb1c0a269c032b52a` (48,253,431 bytes) and Windows ZIP SHA-256 `5ea83a0dc3c9e377c1358c13910b7dd9ef6d812558f19956f608cfd6b1344822` (114,789,406 bytes).
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

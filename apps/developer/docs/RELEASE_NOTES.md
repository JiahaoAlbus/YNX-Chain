# YNX Developer 0.2.0 Testnet Preview release notes

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

# YNX Developer 0.2.0 Testnet Preview release notes

## 2026-08-09 extension workspace candidate

- Added a dedicated Languages & Compilers view with a truthful inventory of
  Monaco editing support, locally installed language packs, detected device
  toolchains and custom compiler adapters.
- Added reviewed current-user adapter removal. Registration, removal and each
  compilation remain separate approvals; built-in extensions cannot be replaced
  or removed, commands remain shell-free and compiler execution remains bounded.
- Verified 24 Developer tests, including a real custom adapter compile and
  register/compile/remove lifecycle, plus build, static workflow checks and
  desktop network/workspace sandbox denial.

## 2026-07-29 browser accessibility evidence checkpoint

- Added a deterministic Chrome DevTools Protocol audit harness with no Playwright, Puppeteer or production dependency.
- Bound 15/15 current-source browser checks and six screenshot SHA-256 values to clean pushed commit `98fcbe3cff68b4b01ebfd94df2d1476b41ecf2b5`.
- Verified keyboard-first skip navigation, editor focus, roving panel tabs, Chromium accessibility-tree roles/names/live regions, a 3 px visible focus ring, Light/Dark, reduced motion, exact 390 px no-overflow, inert mobile drawers, single-column mobile API Studio, Arabic RTL with code/JSON LTR, large text and a 200% page scale.
- Developer Web now passes 21/21 local tests, including release-manifest/provenance/metadata consistency; artifact-source Windows CI passed 20/20 before that release-record-only gate was added. Static claim/workflow check remains passed.
- Rebuilt both current-source desktop Testnet Preview artifacts from `63a678ac3c423b53c9628fa35c415d554827eccb`: macOS ZIP SHA-256 `f8988f011cf5f722fcffcf389cc98d678c6ead909177be6211c954c007a45351` (48,252,013 bytes) and Windows ZIP SHA-256 `d07163e6d44ddf6363c92429856bd9eaeeed57d1b939c2cf5ea0797146d88c7d` (114,787,990 bytes).
- Windows run `31270548034` passed 22 client tests, 21 Web tests, compile, provenance, native self-test, Authenticode `NotSigned`, portable extraction, WPF cold launch, bundled server observation and cleanup. Artifact `9025496664` remains transient, while the exact inner ZIP is hosted at the YNX-domain download URL.
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

# YNX Developer Current Plan

## Product lock

- Product: `11｜YNX Developer / AI Build`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/11-developer`
- Branch: `codex/final-developer`
- Current phase: `FREEZE`
- Runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`
- Current package-source checkpoint: `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`
- Long-term goal: Active

## Completed slices

### API Studio i18n and accessibility

- 12 supported locales cover API Studio labels, approval semantics, dynamic states and bounded fail-closed error classes.
- Arabic uses RTL interaction layout while source, JSON, output and URL fields remain LTR.
- Stable machine error codes remain visible.
- Bottom-panel navigation implements tablist/tab/tabpanel semantics, roving tabindex and ArrowLeft/ArrowRight/Home/End navigation.
- API output is a focusable polite live region.
- 390px rules collapse grids and wrap translated controls.
- Placeholder and credential-leak gates fail closed when the preferred scanner is unavailable.

### Current-source macOS package

- Packaging refuses tracked uncommitted Developer changes.
- Package embeds exact source commit, Git tree, runtime checkpoint, source commit date, platform/signing class and SBOM hash.
- Source commit: `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca`.
- Source tree: `a0c61afe7ba9e209eab326dcc02fc6568de201d8`.
- Runtime checkpoint: `8f352d0159eef0ab60fb6411e949cfcf3aafb551`.
- ZIP SHA-256: `55ec683a9ec59db89331bb4ae45c2666ae4e26921b59ac6ec8284efe268281f9`.
- ZIP bytes: `38450127`.
- Embedded SBOM SHA-256: `801af226eda24a8ad4e880f8d36da197ef8af375b62153435dd4c0c75cc8ac12`.
- Signing class: `adhoc-no-team-id`; local unsigned Testnet Preview only.
- Extracted provenance, resource self-test, strict signature classification, GUI cold start, bundled server observation and child cleanup passed.

## Verified tests

- `cd packages/developer-client && npm test` — 22 passed
- `cd apps/developer && npm test` — 17 passed
- `cd apps/developer && node --check app.js` — passed
- `cd apps/developer && npm run check` — passed
- `cd apps/developer && npm run build` — passed
- `cd apps/developer && npm run live-check` — passed
- `cd apps/developer && npm run proxy-check` — passed
- `cd apps/developer && npm run desktop:sandbox-check` — 2 passed
- `cd apps/developer && npm run desktop:windows-source-check` — passed without a Windows build claim
- `make no-placeholder-check` — passed through the no-`rg` fallback
- `make secret-scan` — passed through the no-`rg` fallback
- `make static-check` — passed
- `cd apps/developer && bash scripts/package-local-macos.sh` — passed from a clean pushed commit
- `cd apps/developer && bash scripts/verify-local-macos-package.sh` — embedded provenance, extracted install, cold start and cleanup passed

## Protected checkpoints

- Runtime commit `8f352d0159eef0ab60fb6411e949cfcf3aafb551` pushed.
- Evidence record commit `3519c5c608e8f9a011e2d39eb9be858710eae499` pushed.
- Provenance gate commit `9bcb984d475a39cc9fcd7e46fbb00adaee0421ca` pushed.
- Local SHA equaled upstream SHA at the package-source checkpoint before artifact generation.
- Product remains `ACTIVE`; local unsigned packaging is not public or production completion.

## Next autonomous engineering slice

Trigger the existing Windows workflow against `codex/final-developer`, verify that the current-source WPF/WebView2 x64 package builds on `windows-latest`, extracts, self-tests, cold-launches, starts the bundled server, cleans child processes, emits exact hash/bytes/provenance, and remains `unsigned-no-authenticode`. Do not reuse the historical run as current-source proof.

## Subsequent priorities

1. Installed-browser keyboard, screen-reader, zoom/dynamic-text and 390px visual evidence.
2. Accepted host broker plus one official provider sandbox vector.
3. Data Fabric redacted audit events and Monitor integration.
4. Canonical Wallet product/deployment acceptance.
5. Real Wallet-signed YNX Testnet deployment and Explorer proof.
6. SLO/capacity and unit-economics measurement.
7. Public staging, immutable artifacts, SEO/public evidence and release gates.

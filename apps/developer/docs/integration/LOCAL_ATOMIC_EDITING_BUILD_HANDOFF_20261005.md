# Atomic workspace editing build handoff — 2026-10-05

This records the completed offline macOS ARM64 build from **`4298b6eba17d661832e1728bc21b5cb58c65e3d9`**, tree **`ea42111676c8926e14cbe9afb636ae722009dd4f`**. The source was clean when both producers ran. No network download, dependency installation, package egress, LXD, GUI launch, installation or publication was performed by the packaging agent. Existing apps, user profiles and all older candidates were retained.

The package contains Tools **0.2.21**, Brand **0.1.5**, Theia **1.76.0**, portable Node **v26.7.0**, and a verified **macOS 27.0** floor. It includes Workbench **0.3.15** atomic workspace Undo/Redo, project-wide F2, local Git configuration and discovery, the local starter, and native Klein presentation synchronization. Brand 0.1.5 contains the new default blue status bar and active-tab treatment. The verifier compared every Brand file in both core and native source payloads to the frozen Git commit, and checked `statusBar.background=#002FA7`, `tab.activeBackground=#151923`, `tab.activeBorderTop=#002FA7`.

**Source validation and remaining boundary:** root reported eleven real Monaco tests and 36 related checks passing for the new atomic editing implementation before source freeze. Those are source/component results, not actual GUI acceptance of this newly sealed package. The previous 0.3.14 package's partial multi-file Undo failure and checkpoint remain retained. Mixed resource-file edits and snippets are currently refused; they are not silently reduced to partial edits. The push-failure path's formerly-null initialSnapshot state restoration still needs completion. Root's real ModelService observation showed existing history was preserved (`/private/tmp/ynx-workspace-initial-snapshot-observation-20261005.log`); it does not prove every failure-state field is restored.

## Fixed paths and retained inputs

The exact source worktree used was:

```text
/Users/huangjiahao/.codex/worktrees/ide-quota-command-diagnostics/YNX Chain
```

In the commands below `REPO` is that literal path and `DEV="$REPO/apps/developer"`; all suffixes expand to these fixed absolute locations, rather than a public alias or another checkout.

| Input | Exact location relative to `DEV` |
| --- | --- |
| Existing verified frontend build and build receipt | `runtime/theia/lib`, `runtime/theia/.ynx-owned-build.json` |
| Frontend package/lock and installed notices inputs | `runtime/theia/package.json`, `runtime/theia/package-lock.json`, `runtime/theia/node_modules` |
| Owned workbench source/cache verification inputs | `runtime/ynx-workbench`, `runtime/theia/node_modules/@ynx/developer-workbench` |
| Eight retained reference extension archives and unpacked payloads | `.ynx-developer-candidates/json-offline-inputs-20261004`, including its `extension-inputs.json` |
| Retained C/C++ extension and receipt | `.ynx-developer-candidates/cpp-offline-language-release-inputs-20261004` |
| Reviewed complete solc input | `.ynx-developer-candidates/ynx-current-ide-release-input-review-20261004-mac-arm64/YNX Developer Testnet Preview.app/Contents/Resources/code/apps/developer/compiler-runtime/node_modules/solc` |
| Offline portable Node closure; reused, not rebuilt | `.ynx-developer-candidates/portable-local-node26-floor-20261005` |
| Formatter and independent Slang parser retained dependency roots | `node_modules/@nomicfoundation/solidity-language-server`, `node_modules/@nomicfoundation/solidity-analyzer-darwin-arm64`, `node_modules/@nomicfoundation/slang`, `node_modules/@bytecodealliance/preview2-shim`, and their already installed dependency closure under this exact `node_modules` |
| Formatter JSON-RPC input | `.ynx-developer-candidates/cpp-offline-language-release-inputs-20261004/ynx.ynx-cpp/node_modules/vscode-jsonrpc` (8.2.0) |
| Tools and Brand product source | `native/ynx-tools`, `native/ynx-brand` at the fixed source commit |
| Compiler helpers | `scripts/compiler-worker.mjs`, `scripts/compiler-pin.mjs`, `scripts/solidity-semantic-index.mjs` at the fixed source commit |
| Native shell/supervisor/lock helper source | `desktop/macos/main.m`, `desktop/code-server.mjs`, `desktop/local-workbench.mjs`, `desktop/macos/local-workbench-lock.c` at the fixed source commit |

The formatter producer resolves transitive package roots locally, rejects roots outside the retained Developer `node_modules`, and records copied files and package versions in each formatter `distribution.json`. It performs no install or lifecycle scripts. Its documented Prettier scan derivative and post-sign Mach-O hashes must remain distinguished from the retained upstream bytes. The independent parser ledger pins its own closure separately.

The reused Node candidate retains all input paths, library hashes, notices and deployment floors in `distribution.json`. Its original Node input was `/opt/homebrew/Cellar/node/26.7.0/bin/node`, SHA-256 `1ef99ea25fe70c9b67e7efe768ef8ee22148d3cabc703db6131b57aeb617d040`. The app runs the closed candidate's `Resources/runtime/node` with its bundled `runtime/lib`; it does not rely on the original Homebrew library paths. No Node closure producer was rerun in this build.

## Reused frontend build identity

Theia's existing `.ynx-owned-build.json` recorded:

```json
{
  "workbenchTreeSha256": "383ae9434f303e4c93e9cf94ac4e050a46a4650f60320a6019196a92c5b6c9fe",
  "compiledTreeSha256": "11ef53e91341cc98c88c169e0af8c786b3df94b234c82659503e7179fc1a6f0a",
  "packageSha256": "1d9677c0555730915848b7b8fbc315679818ce7ac2b00e74c50fe453e2bce69d",
  "lockSha256": "0df86e795a666234c9810f51129b8cc793de88049007eb29a16f2049a4ef67a4"
}
```

The core producer rechecked the actual source, installed owned cache, compiled files, package and lock against this receipt before copying. It did not rebuild Theia. The native producer internally ran its existing `npm run code:build` step for the separate native gateway frontend; that is not a Theia build or dependency installation.

An old receipt alone is not permission to reuse a frontend after workbench source/cache changes. Later dirty source edits cannot be packaged as this same `4298b6eba` artifact. A later committed build must use its own validated source/build receipt, source identity, new core/pin and new native directory. Preserve this candidate and do not mutate its sealed app, pin or receipt.

## Actual producer commands

These are the completed command arguments expressed with fixed path variables for readability. They are a historical handoff, **not a request to rerun them in the current checkout**. Both output directories were verified absent before execution. An exact matching clean source checkout and retained inputs are required for a future source-equivalent build; use new output names rather than overwriting these. Native DMG timestamps/signature construction are not promised to be bit-for-bit reproducible even when source and core bytes match.

```bash
REPO='/Users/huangjiahao/.codex/worktrees/ide-quota-command-diagnostics/YNX Chain'
DEV="$REPO/apps/developer"
CORE="$DEV/.ynx-developer-candidates/ynx-klein-atomic-editing-core-20261005-mac-arm64"
NATIVE="$DEV/.ynx-developer-candidates/ynx-klein-atomic-editing-native-20261005-mac-arm64"
SOLC="$DEV/.ynx-developer-candidates/ynx-current-ide-release-input-review-20261004-mac-arm64/YNX Developer Testnet Preview.app/Contents/Resources/code/apps/developer/compiler-runtime/node_modules/solc"
NODE_CLOSURE="$DEV/.ynx-developer-candidates/portable-local-node26-floor-20261005"
cd "$REPO"

YNX_IDE_SOLC_INPUT="$SOLC" YNX_IDE_SOLIDITY_FORMAT_INPUT=retained \
  node apps/developer/runtime/theia/scripts/package-runtime.mjs \
  "$CORE" \
  "$DEV/.ynx-developer-candidates/json-offline-inputs-20261004" \
  "$DEV/.ynx-developer-candidates/cpp-offline-language-release-inputs-20261004" \
  > /private/tmp/ynx-klein-atomic-editing-core-package-20261005.log 2>&1

YNX_DEVELOPER_SOLIDITY_INPUT="$SOLC" \
YNX_DEVELOPER_SOLIDITY_FORMAT_INPUT=retained \
YNX_DEVELOPER_COMPOSED_ARTIFACT="$CORE" \
YNX_DEVELOPER_COMPOSED_PIN="$CORE.pin.json" \
YNX_DEVELOPER_LOCAL_NODE_RUNTIME="$NODE_CLOSURE" \
YNX_DEVELOPER_MACOS_OUTPUT_DIR="$NATIVE" \
YNX_DEVELOPER_MACOS_REQUIRE_CLONE=1 \
  bash apps/developer/scripts/package-local-macos.sh \
  > /private/tmp/ynx-klein-atomic-editing-native-package-20261005.log 2>&1
```

The native producer refuses uncommitted tracked Developer/client changes. It validates the retained Node distribution and true executable version, verifies the exact core/pin, derives the output floor 27.0, copies source, compiles the native shell and lock helper, validates all 40 app Mach-O images, generates the SBOM, signs embedded binaries and the app, then checks the **final signed** Node/formatter hashes. Local workspace metadata is enabled by the producer's `YNX_DEVELOPER_LOCAL_WORKBENCH_PAYLOAD=1` branch. Source `Info.plist` retains its older target; only this output is set to the verified Node floor and local desktop mode.

## Actual final verification commands and terminal results

```bash
APP="$NATIVE/YNX Developer Testnet Preview.app"
DMG="$NATIVE/ynx-developer-testnet-preview-macos-arm64-unsigned.dmg"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP" \
  > /private/tmp/ynx-klein-atomic-editing-native-signature-20261005.log 2>&1
/usr/bin/hdiutil verify "$DMG" \
  > /private/tmp/ynx-klein-atomic-editing-native-dmg-verify-20261005.log 2>&1
node "$NATIVE/verify-package.mjs" \
  > /private/tmp/ynx-klein-atomic-editing-native-receipt-20261005.log 2>&1
```

The retained, source-specific final verifier is `NATIVE/verify-package.mjs`, SHA-256 **`7b05eb84ccca2d3f4dd0da6ce0364b860f281b1f17356e7593e3f3c7791b9cb3`**. It verifies the actual core pin, archive, Node version/files, parser and final formatter files, source/provenance/SBOM hashes, Tools/Brand/reference-extension versions and final validation logs. It compares every Tools `src` file, all three compiler helpers and the local supervisor to **Git blobs at the fixed source commit**, so later worktree edits cannot silently change its expected source. It also verifies all Brand files and the new palette in both shipped payloads. Compiler-worker SHA-256 in all three shipped copies is **`ea42fe82d8441975f544df2034a1b3f2a6cb5f279435182d20c5b78ccf54c75c`**. Supervisor SHA-256 is **`16fb6588159848120f0fcaab4f2d8749290a2dcdc99005c393c8007e68229c95`**.

`NATIVE/verification-receipt.json` was written exclusively (`wx`, mode **0600**), after the checks succeeded. It is not an input to overwrite or regenerate in place. The source worktree remained clean after packaging.

| Operation | Original live handle | Observed terminal status | Evidence |
| --- | --- | --- | --- |
| Core producer and pin verification | 94783 | 0 | `/private/tmp/ynx-klein-atomic-editing-core-package-20261005.log` |
| Native producer, final runtime ledgers and DMG | 8928 | 0 | `/private/tmp/ynx-klein-atomic-editing-native-package-20261005.log` |
| Deep strict app signature | 72053 | 0 | `/private/tmp/ynx-klein-atomic-editing-native-signature-20261005.log` |
| DMG checksum verification | 65546 | 0 | `/private/tmp/ynx-klein-atomic-editing-native-dmg-verify-20261005.log` |
| Source-specific final verifier/receipt | 23337 | 0 | `/private/tmp/ynx-klein-atomic-editing-native-receipt-20261005.log` |

Handles are historical, agent-local observations, not reusable sessions. No package/build/verifier was rerun to create this handoff document.

## Produced identity and hashes

| Artifact | Value |
| --- | --- |
| Core output | `DEV/.ynx-developer-candidates/ynx-klein-atomic-editing-core-20261005-mac-arm64` |
| Core pin | Same path plus `.pin.json` |
| App | `DEV/.ynx-developer-candidates/ynx-klein-atomic-editing-native-20261005-mac-arm64/YNX Developer Testnet Preview.app` |
| Core tree SHA-256 | `d200996d768b3451719a6fd728caa2c9e3d5e72fecf20f0e5f638d0d6b1bea78` |
| Core manifest SHA-256 | `1701ab172c7c74dcd41a49bf458695fb20fb0a4286fd160c9c3cdd8f4867d2f5` |
| Core archive SHA-256 | `6f6c4acbb8e9478c7f14e122f23c3e9aaaa3a5df9a958a5028072ccd30c5d6cf` |
| SBOM SHA-256 | `977f090373ccb6b4705d76997ccbe41785660796331b844fe25f27e7a499140b` |
| DMG SHA-256 | `d8efd1e898c713983d303f024c44d2ce3d044ef85979f9b2a5f84b31d4bca3e5` |
| Sealed build-provenance SHA-256 | `6cdb2d074623ae28425940a5c6530fffe3115bfd76f236ae2e0d5dca9a334cff` |
| Independent Slang parser closure SHA-256 | `4a71ce3d18805d970782045516bea34a305545cf9d535a5bfc99106aa2440ccb` |
| Parser distribution SHA-256, core and native (130 files each) | `47f04698f9d7996797a3a4817abb3547c59c2159e9f05a3836c2891165ef1ef6` |
| Native final signed formatter distribution SHA-256 (4034 files) | `5012a74710b139050f3a52f292c1ee7f4b5b21bbe00b00ec6298f9a2d589e1cc` |

The pin lock hash is `0df86e795a666234c9810f51129b8cc793de88049007eb29a16f2049a4ef67a4`, architecture `darwin-arm64`. There are eight retained reference extensions plus three YNX extensions, eleven plugin directories total.

## Acceptance boundary

These receipts establish exact source/package identity, retained closure integrity, deployment-floor/link compatibility, ad-hoc signature validity and DMG integrity. They do not establish actual native GUI atomic Undo/Redo acceptance, a GUI save/reopen flow across ports, user acceptance, installation, publishing, deployed services, Developer ID signing or notarization. Native GUI was deliberately not exercised during this packaging run; no native GUI app was launched or closed. Canonical private Tools, online AI and Chain admission remain separate from this OS-user local workspace. Windows remains an **uncompiled foundation**, not a completed native Windows product.

Preserve all previous failed editing receipts/checkpoints and sealed candidates. Any subsequent snapshot-state repair requires a new committed source/build checkpoint and a new coherent core/native pair. This is a local ad-hoc Testnet candidate, not a published release.

This handoff is retained beside the fresh candidate, outside the sealed app, and was written without changing product source. Existing root native session 59367 and user profiles were not operated by this packaging task.

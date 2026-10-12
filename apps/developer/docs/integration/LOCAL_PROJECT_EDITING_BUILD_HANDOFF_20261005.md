# Local project editing build handoff — 2026-10-05

This records the completed offline macOS ARM64 build from **`ede440dc7d93c2437504f0b2c5635379e1086176`**, tree **`f1d62d2319cf26326b6d5bb8a4af39fe565485bb`**. The source was clean when both producers ran. No network download, dependency installation, package egress, LXD, GUI launch, installation or publication was performed by the packaging agent. Existing apps, user profiles and all older candidates were retained.

The package contains Tools **0.2.21**, Brand **0.1.4**, Theia **1.76.0**, portable Node **v26.7.0**, and a verified **macOS 27.0** floor. It includes project-wide F2, local Git configuration and discovery, the local starter, and native Klein presentation synchronization from that commit.

**Known subsequent finding:** root exercised this sealed package and reported actual project F2/save/recompile passing, but multi-file Undo restored the definition while three callers remained renamed. The failed receipt and later checkpoint were retained. The shared atomic Undo/Redo repair under development after this package is **not included or validated here**. Do not treat packaging success as completion of that editing journey.

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
  "workbenchTreeSha256": "29136afb1744c568d241caba3957f6233e3bc1493303a425496168ac9020e6ce",
  "compiledTreeSha256": "e7224acdeee6aba679e0f3224307b9f535810c23e61390139f6185405bdb9aa5",
  "packageSha256": "1d9677c0555730915848b7b8fbc315679818ce7ac2b00e74c50fe453e2bce69d",
  "lockSha256": "424cb416ecbc91396a530eefe6457f6bc4216ad0ca6d47945906dd036e35849b"
}
```

The core producer rechecked the actual source, installed owned cache, compiled files, package and lock against this receipt before copying. It did not rebuild Theia. The native producer internally ran its existing `npm run code:build` step for the separate native gateway frontend; that is not a Theia build or dependency installation.

An old receipt alone is not permission to reuse a frontend after workbench source/cache changes. Later dirty Undo/Redo edits cannot be packaged as this same `ede440dc7` artifact. A later committed build must use its own validated source/build receipt, source identity, new core/pin and new native directory. Preserve this candidate and do not mutate its sealed app, pin or receipt.

## Actual producer commands

These are the completed command arguments expressed with fixed path variables for readability. They are a historical handoff, **not a request to rerun them in the current checkout**. Both output directories were verified absent before execution. An exact matching clean source checkout and retained inputs are required for a future source-equivalent build; use new output names rather than overwriting these. Native DMG timestamps/signature construction are not promised to be bit-for-bit reproducible even when source and core bytes match.

```bash
REPO='/Users/huangjiahao/.codex/worktrees/ide-quota-command-diagnostics/YNX Chain'
DEV="$REPO/apps/developer"
CORE="$DEV/.ynx-developer-candidates/ynx-klein-project-editing-core-20261005-mac-arm64"
NATIVE="$DEV/.ynx-developer-candidates/ynx-klein-project-editing-native-20261005-mac-arm64"
SOLC="$DEV/.ynx-developer-candidates/ynx-current-ide-release-input-review-20261004-mac-arm64/YNX Developer Testnet Preview.app/Contents/Resources/code/apps/developer/compiler-runtime/node_modules/solc"
NODE_CLOSURE="$DEV/.ynx-developer-candidates/portable-local-node26-floor-20261005"
cd "$REPO"

YNX_IDE_SOLC_INPUT="$SOLC" YNX_IDE_SOLIDITY_FORMAT_INPUT=retained \
  node apps/developer/runtime/theia/scripts/package-runtime.mjs \
  "$CORE" \
  "$DEV/.ynx-developer-candidates/json-offline-inputs-20261004" \
  "$DEV/.ynx-developer-candidates/cpp-offline-language-release-inputs-20261004" \
  > /private/tmp/ynx-klein-project-editing-core-package-20261005.log 2>&1

YNX_DEVELOPER_SOLIDITY_INPUT="$SOLC" \
YNX_DEVELOPER_SOLIDITY_FORMAT_INPUT=retained \
YNX_DEVELOPER_COMPOSED_ARTIFACT="$CORE" \
YNX_DEVELOPER_COMPOSED_PIN="$CORE.pin.json" \
YNX_DEVELOPER_LOCAL_NODE_RUNTIME="$NODE_CLOSURE" \
YNX_DEVELOPER_MACOS_OUTPUT_DIR="$NATIVE" \
YNX_DEVELOPER_MACOS_REQUIRE_CLONE=1 \
  bash apps/developer/scripts/package-local-macos.sh \
  > /private/tmp/ynx-klein-project-editing-native-package-20261005.log 2>&1
```

The native producer refuses uncommitted tracked Developer/client changes. It validates the retained Node distribution and true executable version, verifies the exact core/pin, derives the output floor 27.0, copies source, compiles the native shell and lock helper, validates all 40 app Mach-O images, generates the SBOM, signs embedded binaries and the app, then checks the **final signed** Node/formatter hashes. Local workspace metadata is enabled by the producer's `YNX_DEVELOPER_LOCAL_WORKBENCH_PAYLOAD=1` branch. Source `Info.plist` retains its older target; only this output is set to the verified Node floor and local desktop mode.

## Actual final verification commands and terminal results

```bash
APP="$NATIVE/YNX Developer Testnet Preview.app"
DMG="$NATIVE/ynx-developer-testnet-preview-macos-arm64-unsigned.dmg"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP" \
  > /private/tmp/ynx-klein-project-editing-native-signature-20261005.log 2>&1
/usr/bin/hdiutil verify "$DMG" \
  > /private/tmp/ynx-klein-project-editing-native-dmg-verify-20261005.log 2>&1
node "$NATIVE/verify-package.mjs" \
  > /private/tmp/ynx-klein-project-editing-native-receipt-20261005.log 2>&1
```

The retained, source-specific final verifier is `NATIVE/verify-package.mjs`, SHA-256 **`6546a6c01fd1f9ff79da4bffdfbcf6b7bbfc9cb83825276d0295c9222a041bce`**. It verifies the actual core pin, archive, Node version/files, parser and final formatter files, source/provenance/SBOM hashes, Tools/Brand/reference-extension versions and final validation logs. It compares every Tools `src` file, all three compiler helpers and the local supervisor to **Git blobs at the fixed source commit**, so later worktree edits cannot silently change its expected source. Compiler-worker SHA-256 in all three shipped copies is **`ea42fe82d8441975f544df2034a1b3f2a6cb5f279435182d20c5b78ccf54c75c`**. Supervisor SHA-256 is **`16fb6588159848120f0fcaab4f2d8749290a2dcdc99005c393c8007e68229c95`**.

`NATIVE/verification-receipt.json` was written exclusively (`wx`, mode **0600**), after the checks succeeded. It is not an input to overwrite or regenerate in place. The source worktree remained clean after packaging.

| Operation | Original live handle | Observed terminal status | Evidence |
| --- | --- | --- | --- |
| Core producer and pin verification | 75067 | 0 | `/private/tmp/ynx-klein-project-editing-core-package-20261005.log` |
| Native producer, final runtime ledgers and DMG | 29402 | 0 | `/private/tmp/ynx-klein-project-editing-native-package-20261005.log` |
| Deep strict app signature | 6592 | 0 | `/private/tmp/ynx-klein-project-editing-native-signature-20261005.log` |
| DMG checksum verification | 80091 | 0 | `/private/tmp/ynx-klein-project-editing-native-dmg-verify-20261005.log` |
| Source-specific final verifier/receipt | 76217 | 0 | `/private/tmp/ynx-klein-project-editing-native-receipt-20261005.log` |

Handles are historical, agent-local observations, not reusable sessions. No package/build/verifier was rerun to create this handoff document.

## Produced identity and hashes

| Artifact | Value |
| --- | --- |
| Core output | `DEV/.ynx-developer-candidates/ynx-klein-project-editing-core-20261005-mac-arm64` |
| Core pin | Same path plus `.pin.json` |
| App | `DEV/.ynx-developer-candidates/ynx-klein-project-editing-native-20261005-mac-arm64/YNX Developer Testnet Preview.app` |
| Core tree SHA-256 | `85643332424bd5a189d9885fb0623523948b479da2db51504c6c2e038e6ba1b0` |
| Core manifest SHA-256 | `6cc38ff84c19be54d641576a55eca502295a6bb74526c1e68cbc34a8d06d9ce3` |
| Core archive SHA-256 | `c749c1bb09180453d0ed21b6fa28ed5f756b40782cd44d10bf5ef0ee72fc9662` |
| SBOM SHA-256 | `2eca8ec0994c8a8eb657eeb585e7073ba7079b3c1fe00dc14131d27dd36955f2` |
| DMG SHA-256 | `3b2770c3326916f020a93993b5914927e54066be7dff6bd0362bbacdf903af23` |
| Sealed build-provenance SHA-256 | `089cd8eee699e61aea459c8a3dcddff362a7d55aa78f28652853394c523e3242` |
| Independent Slang parser closure SHA-256 | `4a71ce3d18805d970782045516bea34a305545cf9d535a5bfc99106aa2440ccb` |
| Parser distribution SHA-256, core and native (130 files each) | `47f04698f9d7996797a3a4817abb3547c59c2159e9f05a3836c2891165ef1ef6` |
| Native final signed formatter distribution SHA-256 (4034 files) | `5012a74710b139050f3a52f292c1ee7f4b5b21bbe00b00ec6298f9a2d589e1cc` |

The pin lock hash is `424cb416ecbc91396a530eefe6457f6bc4216ad0ca6d47945906dd036e35849b`, architecture `darwin-arm64`. There are eight retained reference extensions plus three YNX extensions, eleven plugin directories total.

## Acceptance boundary

These receipts establish exact source/package identity, retained closure integrity, deployment-floor/link compatibility, ad-hoc signature validity and DMG integrity. They do not establish successful multi-file Undo, a GUI save/reopen flow across ports, user acceptance, installation, publishing, deployed services, Developer ID signing or notarization. The Mac was locked during this packaging run; no native GUI app was launched or closed. Canonical private Tools, online AI and Chain admission remain separate from this OS-user local workspace. Windows remains an **uncompiled foundation**, not a completed native Windows product.

Preserve the subsequent failed editing receipt/checkpoint and the original sealed candidate. Wait for root's explicit ready source/build checkpoint before producing a new coherent core/native pair for the Undo/Redo repair.

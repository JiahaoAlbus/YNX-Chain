# Canonical portable Native QA component

This adds one explicit finite build/record profile to SDK534. It consumes Auth portable H `d136f0…` plus its exact two-leaf same-root successor H `cf53a3…`. It does not mix ProductSource, IDE-r2, Browser or Task additions. No Root/Source enrollment, production signing, install or Electron claim is made.

The old `canonical-native-qa-profile` / 52-command receipt remains its original immutable-source reader and default selector. Its old builder pin cannot select or build the new tree; old records are not upgraded to 53 commands or new image qualification. The new explicit `component-canonical-portable-image` normal mode uses the original Auth builder, not a second compiler. Its plan is 50 C/ObjC/C++ commands + one Swift command + one link to `.linked.node` + the fixed zero-input portable stage, 53 total/51 objects/one original Go archive. Helper13 is built from its exact existing recipe. A default caller never silently falls back between profiles.

The new profile independently pins the full common manifest, actual builder and runtime manifest. Its source roles contain 266 Node source/DATA rows: 262 original normal inputs plus builder/common manifest and original dependency source-build receipt+recipe. Helper closure is 272 rows; provenance names are 75. The three unrelocated input dylibs must be real same-root source files with mode0755, per Auth's normal builder. The sole Go archive is 15,553,360 bytes, below the unchanged16MiB per-leaf ceiling.

The original source-built OpenSSL archive is 55,003,802 bytes, SHA2569bffaa… and remains an external upstream URL/pin in the immutable original build receipt; it is NOT represented as an admitted Git source leaf and the16MiB limit is not raised. libuv source archive pin66d511… is retained alongside it. `target13-source-build-receipt.json` and `target13-source-build-recipe.mjs` are byte-exact provenance copies (the receipt is pinned by formal Auth H; the recipe is an additional read-only observed source pin frozen by this SDK successor, not claimed as an upstream SOURCEPINS entry), not another invocation path or a claim this SDK worker rebuilt them. The installed-source provenance paths in Auth's new manifest are descriptive only. Runtime linking uses exactly the three relative vendor paths in the SAME normal root.

Normal fixed producer sequence:

1. Verify actual source/header/runtime inputs and reconstruct the exact53-command original plan.
2. Execute all53. The last supplier stage copies fresh outputs, rewrites relative load dependencies and performs nested dylib-first/Node-last ad-hoc QA signing. It never overwrites a prior artifact.
3. Read post-sign Node/library/5-license bytes, independently run `codesign --verify --strict` on libraries then Node, and parse their actual Mach-O metadata. Only system absolute dependencies and exact sibling `@loader_path` dependencies are accepted. Install IDs are fixed; macOS minOS13 is metadata, not an OS13 execution test.
4. Run the original owned-symbol scan, strict42 gate and bounded Root0 Node readback, then build/scan helper13.
5. Recheck sources and final nested output hashes. Only then create the actual component record and helper alias. Exceptions keep the original attempt ledger; no new record asserts a failed build succeeded.
6. P01 generates ASAR/integrity from those exact bytes, preserves nested bytes during outer App signing, and checks all nine assets afterward. Any nested re-sign/change requires genuinely fresh hashes/record/ASAR and outer signing; expected hashes are never edited to hide a mismatch.

Normal commands from the actual source root (Node runtime itself must match Auth's pinned normal Node26.7, while public compiler headers remain24.5):

```
node apps/wallet-desktop/scripts/build-wallet-native-component.mjs plan-canonical-portable-image arm64 /absolute/pinned/include/node
node apps/wallet-desktop/scripts/build-wallet-native-component.mjs component-canonical-portable-image arm64 /absolute/pinned/include/node
node apps/wallet-desktop/scripts/run-canonical-native-portable-qa-controls.mjs /absolute/owned/evidence
```

Only plan/DATA tests were run by this SDK worker. The second command is for P01's separately owned fresh normal source, never the old C1 tree or failed App. A new genuine component record, new E42 load/readback and new App checks are still required. Supplier output16bd and same-root73a8 are observed supplier artifacts; neither hash is hard-coded as the required future P01 image or assigned the older68718e E42 pass.

`verifyPortableQAComponent`, `verifyCanonicalNativeReceipt`, `verifySDK13NativeComponent`, `canonicalNativeInputSelection` and `inspectNativeComponentGitSourceClosure` have the new finite role path. Public synthetic test records are DATA grammar controls only, not execution/signature receipts. `inspectPortableMachOQAData` always returns signatureVerified/actualOS13Runtime/ElectronLoad/Root/Source false. `portableRuntimePackAssetsDATA` gives the contract's exact node+3lib+5license unpacked paths/pins; `assertPortableRuntimePackagedBytesDATA` catches post-record mutation but does not verify outer signing or confer Native qualification.

P01-owned integration changes are specified in `P01_PORTABLE_INTERFACE.json`; this SDK delta does not replace its current release-provenance68 implementation, source startup/inc/archive classification fixes, package.json, workflows or actual application assets. Supplier269 and Main5df context are separate manifests, not SDK-owned replacement deltas.

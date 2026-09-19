# Wallet browser acceptance fixtures — 2026-09-20

This change modifies test fixtures and diagnostics only. Product source is unchanged from Wallet base `4d1992f99645589ab69ea7856db647b900d47704`. No deployment, signing, account approval, transaction, or artifact-manifest mutation occurred.

## Results

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused fixture tests | 10 passed | `focused-final.stdout.log` |
| Full Wallet Web tests | 351 passed | `unit-final.stdout.log`, `unit-final.exit` |
| Edge 153.0.4234.32, exact preexisting ZIP | PASS: independent EIP-6963 announcement, foreign frozen provider unchanged, `eth_chainId=0x1917`, popup preferences retained | `exact-zip-edge.stdout.json` and `exact-zip/` |
| Chrome 153.0.8010.50 | NOT PROVED: isolated launch started but extension worker never appeared; no provider assertion attempted and no bypass | `branded.stdout.json`, `branded-stages.ndjson` |
| CfT 151.0.7922.34 HTTP | Negative boundary passed across restart, migration retained HTTPS-only origins. Positive activeTab action NOT performed or proved; exit 2 | `active-tab.stdout.json`, `active-tab.exit` |
| Old 6e502 PWA | FAIL at 20s: complete new cache but worker stays `activating`, old iframe document lacks `dataset.pwa` | `pwa-old-artifact-result.json` |
| Existing 75b387 PWA | PASS: upgrade, failed-update preservation and second launch | `pwa-v8-to-build-upgrade.json` |
| Fresh local 4d1992 candidate | PASS: upgrade, failed-update preservation and second launch, all `dataset.pwa=ready` | `final-source/pwa-v8-to-build-upgrade.json`, `final-source-pwa.exit` |

The original old-artifact timeout came from `await client.navigate(...)` in its activation lifetime. Current product source already uses nonawaited navigation; this task does not duplicate that fix. A first current-source candidate run exposed a separate fixture race: `documentElement` is temporarily null while its iframe navigates. `current-source/` preserves that failure. The gate now polls a null-safe predicate; timeout remains 20 seconds.

Old Chromium ZIP: source `6e502c3a2d7feb2b4cfc0290c8539b9b08a5faf1`, SHA256 `a2c40edf0fa96d58158f653c930e1a7d687bd7f9f9c3f9d7344655dacc2481a0`, 545709 bytes. Edge PASS applies to this exact ZIP, not to newly published binaries. The final gate extracts and hashes the same immutable bytes instead of loading unrelated `dist/chromium` contents.

Fresh PWA source: `4d1992f99645589ab69ea7856db647b900d47704`; cache `ynx-wallet-shell-build-5ce77d5459d92b13c10f8eda4bbadc333077e6692be03006e6b2ba77eda1eada`; worker SHA256 `0041e5f1c556a8248c18971bca595a2b55a589daa3a4e8208a71f43dd2964e94`. Built in `/tmp/ynx-wallet-browser-acceptance-final-dist`, not released. Product files were unchanged; the working diff is the tested fixture/diagnostic code.

Firefox 140 binary now exists at `/tmp/ynx-firefox-install.Lkf88L/Firefox.app/Contents/MacOS/firefox`. It is no longer a missing-binary blocker. This task did not rerun Firefox, and does not adopt another owner's historical PASS as current evidence.

## Commands (from apps/wallet-web)

Dependencies: `npm ci --ignore-scripts --no-audit --no-fund`; isolated repository `node_modules` symlink pointed to `apps/wallet-web/node_modules` for shared `packages/wallet-auth` resolution. Initial full tests without that resolver failed six imports; log retained in `initial-unit-missing-shared-deps.log`. After resolver setup, full suite passed. No test assertion was relaxed.

```sh
node --test test/runtime-evidence.test.js test/runtime-harness.test.js test/runtime-extension-gates.test.js
npm test
YNX_BROWSER=all YNX_WALLET_WEB_WRITE_EVIDENCE=1 YNX_WALLET_WEB_SOURCE_COMMIT=4d1992f99645589ab69ea7856db647b900d47704 node scripts/runtime-branded.mjs
YNX_BROWSER=edge YNX_WALLET_WEB_WRITE_EVIDENCE=1 YNX_WALLET_WEB_EVIDENCE_DIR=evidence/runtime/20260920-browser-acceptance/exact-zip node scripts/runtime-branded.mjs
node scripts/runtime-active-tab-browser-gate.mjs
YNX_WALLET_WEB_SOURCE_COMMIT=4d1992f99645589ab69ea7856db647b900d47704 node --input-type=module -e 'import {buildAll} from "./scripts/build.mjs"; await buildAll({dist:"/tmp/ynx-wallet-browser-acceptance-final-dist"})'
YNX_WALLET_WEB_DIST_DIR=/tmp/ynx-wallet-browser-acceptance-final-dist YNX_WALLET_WEB_EVIDENCE_DIR=evidence/runtime/20260920-browser-acceptance/final-source node scripts/runtime-v8-upgrade-gate.mjs
```

Stdout/stderr, exits, browser versions, temporary profile paths and metadata are saved beside this file. `branded.stdout.json` was the first two-browser run before exact-ZIP extraction was introduced; Chrome worker absence is an environment boundary, not a product failure claim. The outer shell wrapper for that first run hit zsh's read-only `status` variable after Node finished; do not attribute that wrapper error to the browser. Subsequent wrappers use `gate_exit`.

## Still unproved

Real Chrome toolbar installation/use and HTTP positive injection require a real user browser-action grant. Page keyboard events, injected JavaScript, popup navigation and VM tests are not grants. HTTP assessment exits 2 while this is missing; its `passed` and `actionInjectionProved` stay false. HTTPS discovery/chain ID success is not account authorization, transaction or product-release acceptance.

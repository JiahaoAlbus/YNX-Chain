# Wallet Android onboarding security QA recipe

This recipe is source-bound follow-up evidence. It does not replace or rerun the completed API 36 disposable APK launch/privacy/chain-identity receipt. Until the strict receipt verifier passes, every new device check in `apps/wallet/proof/wallet-android-onboarding-security-qa-pending.json` stays `false`.

## Safety boundary

- Run only on a disposable API 36 / Android 16 arm64 AVD with strong biometrics enrolled. Never use a real user recovery key or mnemonic.
- Generate two one-run synthetic 32-byte keys into mode-0600 files under a mode-0700 temporary directory. Disable shell tracing. Never print, copy into a receipt, attach to logs, or retain those files.
- Do not dump the UI while an unmasked recovery value could be exposed. The create screen uses the fixed accessibility label `YNX Wallet recovery key`; immediately run `android-ui-tree-control.mjs assert-secret-free` on every pulled XML. If it rejects, delete that XML and fail the run.
- Every tap coordinate must come from the current UI tree: `node apps/wallet/scripts/android-ui-tree-control.mjs point TREE.xml 'Exact accessibility label'`. Screenshots are supplementary because `FLAG_SECURE` may intentionally black the application region.
- Use the APK built from the exact tested commit with the existing disposable-QA build script. Production/store/public booleans remain false.

## Source-bound setup

From the repository root, with shell tracing disabled, set `SERIAL`, absolute `APK`, its adjacent absolute `manifest.json`, and a new mode-0700 `EVIDENCE_DIR`. Record `git rev-parse HEAD`, APK SHA-256/bytes, `adb -s "$SERIAL" shell getprop ro.build.version.sdk`, release, ABI, and the installed package path. Fresh-install that exact APK. The system QA owner may reuse the already-proven AVD configuration, but the onboarding artifact must be rebuilt from this slice's commit; the verifier rejects a build manifest whose `sourceCommit`, APK digest/bytes, package or signing class differs.

For each UI step, capture with `adb -s "$SERIAL" shell uiautomator dump /sdcard/window.xml`, pull to a uniquely named XML, run `assert-secret-free`, derive the next tap from that same XML, then archive its SHA-256 and bytes. Do not infer coordinates from a screenshot.

## Required sequence

1. Create: tap `Create a new Wallet`; confirm the tree exposes `YNX Wallet recovery key` but no 64-hex text/content description. Enter `BACKED UP`, tap `Confirm backup and save`, and capture `create-locked-tree` proving the app returned to `WALLET LOCKED`. A disabled confirmation or repository error is not success.
2. Biometrics: capture one cancelled/failed system biometric attempt and `biometric-denied-tree`, then a strong-biometric success and `biometric-unlocked-tree`. Confirm failure never reveals Dashboard or private material.
3. Multi-account import: open `Switch Wallet account` → `Import recovery key`. Inject only the first temporary synthetic key into the secure field, authorize biometrics, and capture `import-biometric-tree`. Repeat with the same key and capture the explicit duplicate rejection as `duplicate-rejected-tree`. Import the second synthetic key through `Recover on a replacement device`; capture `recover-boundary-tree` showing that product sessions/devices/approvals are not restored. Capture `multi-account-tree` with at least three locally stored account labels and exercise switching; each switch must relock.
4. Background lock and secret dismissal: open replacement recovery, put a temporary synthetic key in the secure field, press Home, then resume. Do not dump before background. Capture `background-resume-tree`; it must show the locked Wallet, no setup Modal, and no recovery-field node. This proves the source-bound reducer path added in `a68b6aa6884612507496163e3743763995b677fb` on a device.
5. Accessibility: select Arabic, force Android dark mode, set font scale to at least 1.30, and restart. Capture the current configuration plus `rtl-dark-tree` and `large-text-tree`. The Settings accessibility summary must report dark appearance, Arabic controls must be present, every required button bound must remain inside the display, and no control may overlap or have empty bounds.
6. Deep link rejection: while locked and unlocked, send malformed/tampered authorization links and an otherwise valid request with a substituted callback. Capture `tampered-deeplink-rejection-tree` and `wrong-callback-rejection-tree`; no approval button may be enabled for either.
7. Valid callback: use the repository Social harness, which generates its own disposable device key and verifies every response binding. Capture the Wallet exact review as `valid-deeplink-review-tree`, approve only after strong biometrics, and capture the harness terminal verification as `callback-harness-tree`. Record only the public request digest, never account secret material. Replay the exact callback must remain rejected by the harness/Wallet replay boundary.
8. Truthfulness: capture `authoritative-data-tree`. A real RPC result may be shown; otherwise the UI must show loading/unavailable and `— YNXT`. Do not enter any fake balance, transaction, provider, signature, user, or success into the receipt. Capture PID-scoped logs and WindowManager state as `pid-scoped-log` and `window-state`, with zero fatal/AndroidRuntime crashes.

## Receipt gate

Copy the pending JSON to the external evidence directory, replace only observations backed by the required raw files, and add absolute paths plus SHA-256/bytes for all 17 required labels. Verify:

```sh
node apps/wallet/scripts/verify-android-onboarding-qa-receipt.mjs /absolute/evidence/receipt.json
```

The verifier hashes the source-bound APK and every raw artifact, scans text evidence for exposed recovery material, requires all positive and negative checks, and still emits `productionSigned=false`, `storeReleased=false`, `deployedPublic=false`. The repository pending contract itself is checked with:

```sh
node apps/wallet/scripts/verify-android-onboarding-qa-receipt.mjs --pending "$PWD/apps/wallet/proof/wallet-android-onboarding-security-qa-pending.json"
```

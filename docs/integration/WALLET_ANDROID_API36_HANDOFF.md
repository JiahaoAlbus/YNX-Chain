# Wallet Android API 36 recovery handoff

## Checkpoint

- Owner: Wallet Android (`02-wallet-auth` Android responsibility).
- Recovery branch: `codex/wallet-android-api36-20260813`.
- Recovery base: `1883d406f77f94cb81171b79fe9518882ede0b16` (`codex/integrate-finance-suite`).
- Prior evidence checkpoint: `e90e8c31a78db62e76f9f17093743b3254823cf4`.
- Frozen Auth consumer: `release/integration/wallet-auth-contract.json`; this slice defines no Auth protocol.
- Machine-readable proof: `apps/wallet/proof/wallet-android-api36-recovery-2026-08-13.json`.

## Direct Android evidence

The hosted Wallet 1.0.1 Testnet preview was downloaded again and matched SHA-256 `fd924ef853cf17d42ca2d36504528ef879c73fcb4b01ea72b1bfe7ae85085fef` and 78,392,878 bytes. Android package inspection reported `com.ynxweb4.wallet`, versionName `1.0.1`, versionCode `2`, minimum API 24, compile SDK 36 and target SDK 36. APK Signature Scheme v2 verification passed with certificate SHA-256 `67c841ab31a4eb34f21e458827eb213b24dc22d3f1d224686ed601ed7eb8f489`. This is a persistent Testnet preview key, not production/store signing.

Fresh installation succeeded on Android 16/API 36. The first explicit cold launch created PID `3188`; ActivityManager reported `com.ynxweb4.wallet/.MainActivity` top-resumed and WindowManager reported the Wallet surface. PID-scoped logcat observed Hermes `Running "main"` and no Fatal/AndroidRuntime crash. After force-stop, a second cold `ynxwallet://open` launch created distinct PID `4118`; ActivityManager preserved the exact VIEW intent and again reported Wallet top-resumed, and WindowManager reported the Wallet surface. A separate second-PID log was not captured, so that narrower evidence flag remains false.

The successful launcher UI tree exposed the real empty onboarding and Testnet identity; it did not expose a fake balance, user, transaction or provider. A 1080×2424 screencap retained only system bars while the Wallet application region was black. Its SHA-256 is `0a12c6a83cc80ffa01e2a73f00122387975f4f68504c2abb6313fa8b262fd7fb`, directly proving `FLAG_SECURE` behavior for this installed artifact.

## Emulator boundary

`YNX_WALLET_101_QA` / `emulator-5592` first produced valid install, UI-tree, foreground-process and secure-screenshot evidence. Its QEMU/ADB transport later became unavailable, and Android System UI also emitted an ANR overlay. The Wallet process had no matching fatal crash. The remaining lifecycle checks were repeated on the separate existing API 36 Wallet AVD `YNX_WALLET_FINAL` / `emulator-5594` with independent bounded commands. Emulator transport and `uiautomator` failures are not classified as Wallet failures.

## Release truth and next gate

`implementedLocal`, `testedLocal`, `installedLocal`, `integratedCentral` and `downloadHosted` are true for their separately evidenced boundaries. `deployedStaging`, native-app `deployedPublic`, `productionSigned` and `storeReleased` remain false. Dark mode, RTL, large text, biometric, background lock and clipboard privacy were not re-exercised in this slice and remain next-device-evidence work; no new Auth contract may be introduced while doing so.

## Native launch-window privacy follow-up

Source commit `6c59d21949f91a956ec567cf58cee28817471994` moves `FLAG_SECURE` into `MainActivity.onCreate` before `super.onCreate(null)`, closing the native splash/React-start window while retaining the Expo runtime fail-closed screen-capture gate. Wallet tests pass 41/41; typecheck, product, release-content/secret and diff gates pass. The bounded offline `:app:compileReleaseKotlin` task completed with `BUILD SUCCESSFUL` using compile/target SDK 36, minimum API 24 and Kotlin 2.1.20. Machine-readable evidence is `apps/wallet/proof/wallet-android-native-launch-privacy-2026-08-13.json`.

The source-bound arm64 Release build subsequently completed with `BUILD SUCCESSFUL in 15m 39s`. Its unsigned APK is 30,647,563 bytes with SHA-256 `4af2792486e24776ff4e19e1d9979f5194418766c801db01ba3e0a4e5408fcd8`; badging confirms package `com.ynxweb4.wallet`, versionName 1.0.1, versionCode 2, minimum API 24 and target/compile SDK 36. `apksigner` reports `DOES NOT VERIFY`, so signing class is strictly `unsigned-release-build`.

This follow-up has `implementedLocal=true` and `testedLocal=true`. Its `installedLocal`, `downloadHosted`, `productionSigned` and `storeReleased` states remain false because the new APK is unsigned, and the installed signed 1.0.1 APK predates this change.

## Android privacy product-gate checkpoint

Commit `f105cadcda2bca619d3993a9bcedeb3c0faaebd4` promotes the already implemented Android privacy boundaries into the Wallet product gate without changing the frozen Auth protocol. The gate now fails if native `FLAG_SECURE` moves after React startup, either Android SecureStore backup-exclusion binding disappears, device-bound unlocked-only storage is weakened, strong biometric/device-fallback policy is removed, background locking no longer clears the unlocked account, or the bounded clipboard-clear policy is removed.

The bounded verification completed on 2026-08-13: `npm run product-check` passed, all Wallet tests passed 41/41, `npm run typecheck` passed, and `git diff --check` passed. These are source and local-test facts. They do not turn biometric/background/clipboard emulator interaction, source-bound APK installation, public deployment, signing, or store release true.

## Source-bound unsigned APK install boundary

After the privacy-gate evidence was pushed, `YNX_WALLET_FINAL` / `emulator-5594` responded to bounded ADB commands and reported API 36 with `sys.boot_completed=1`. The source-bound unsigned APK still matched SHA-256 `4af2792486e24776ff4e19e1d9979f5194418766c801db01ba3e0a4e5408fcd8`. A bounded `adb install -r` failed before signature evaluation with `cmd: Can't find service: package`; a separate `service check package` returned `Service package: not found`.

Therefore this probe proves neither an APK-signature rejection nor a Wallet failure. It records an emulator Package Manager boundary and leaves `installedLocal=false`, `apkSignatureVerified=false`, `productionSigned=false`, and device screenshot/second-PID evidence false for the new source-bound build.

The Package Manager boundary was committed locally as `ae14760c3b99bf9cc03a673a0a14036e94e8f3ab`. The single bounded push attempt at `2026-08-13T15:16:58Z` used `git -c http.connectTimeout=10 -c http.lowSpeedLimit=1 -c http.lowSpeedTime=20 push origin codex/wallet-android-api36-20260813` and exited 128 with `Operation too slow. Less than 1 bytes/sec transferred the last 20 seconds`. At that checkpoint, the verified remote-tracking commit was `293dcc15bfa5e0dfd782dab48fcf598f28549ca0` and the local branch was ahead by one. The `ae14760c` evidence slice is locally protected but is not claimed as remotely published.

## Disposable source-bound API 36 continuation

### Verified disposable QA install — 2026-08-14

The strict receipt verifier passed for source commit 5f35c06d4ba1cc79c5112e592d185e040fbeae7e. The arm64 APK is 30,659,851 bytes with SHA-256 6a81b380398ce21fc7d62fb8f6ed8f6f0d904b63fbc473e07fb77b785e1c4fed, minimum API 24, compile/target API 36, v2 signature, certificate SHA-256 6b21e3108b592c6bc23165103791250fda54f60653e1a61bd3890414f7fbfbcf and signing class disposable-qa-release-key.

Fresh install on YNX_WALLET_101_QA / Android 16 API 36 succeeded. Explicit first and second cold launches produced PIDs 4589 and 4685; both were top-resumed com.ynxweb4.wallet/.MainActivity, both PID logs contained React Running main, and neither contained a fatal/AndroidRuntime crash. WindowManager independently reported SECURE. The screencap was fully black including system bars, while the accessibility tree independently exposed the real onboarding and YNX TESTNET · ynx_6423-1. The public endpoint simultaneously returned native chain ID 6423 and EVM eth_chainId=0x1917.

This makes installedLocal=true only for the source-bound disposable QA artifact. It does not prove a persistent signing identity, production signing, store release, hosted download, public native-app deployment, user/account recovery, transaction, callback, biometric, RTL, Dark or Large Text flows; each remains false until separately exercised.

`apps/wallet/scripts/build-disposable-android-qa-release.sh` builds only the independent Wallet application from a clean commit. It creates a 30-day disposable PKCS12 identity in a mode-0700 `/private/tmp` custody directory, never prints passwords, passes credentials to the existing fail-closed Release signing block only through process environment, verifies APK Signature Scheme v2 plus exact package/version/API identity, removes custody material and emits an external APK plus secret-free manifest. It does not alter the persistent Testnet signing line and can never claim production/store signing.

The system QA owner must install the emitted APK on a fresh API 36 target and capture raw install, first/second cold-launch PID/activity/window/log, `FLAG_SECURE` screenshot and `ynx_6423-1` / decimal 6423 / `0x1917` identity evidence. `apps/wallet/scripts/verify-android-api36-qa-receipt.mjs` requires absolute paths and validates SHA-256/Bytes for the APK and every raw file. Until that verifier passes, `installedLocal`, source-bound cold launches and device privacy remain false.

## Strong-biometric recovery and fail-closed callback/replay continuation

Branch `codex/wallet-android-api36-continuation2-20260814` preserves the strong-biometric policy at commit `7a6d30bc90f63c52e27340c10334e16c2e774643`. It requires `BIOMETRIC_STRONG`, `disableDeviceFallback=true`, strong security level and explicit confirmation for every local private-key purpose; missing hardware, missing enrollment, weak biometrics, cancellation, authentication failure and unknown purpose all fail closed.

Commit `2fc0613111cc2acfabed5e725133a3b1b448f020` closes the next Android-owned boundary. The canonical Wallet deep-link parser now accepts only the byte-exact `ynxwallet://authorize?request=<canonical-base64url>` route and rejects userinfo, ports, duplicate or extra query fields, fragments, percent-normalized authority and case-normalized schemes. The device-local replay store serializes concurrent read-modify-write consumption, bounds record bytes/count, validates canonical nonce/timestamp tuples, rejects duplicate or reordered persisted records and persists the consumed nonce before approval continues.

The repository Social proof harness remains Wallet-owned test infrastructure; no `apps/social` runtime was changed. Its callback parser now rejects userinfo, ports, paths, fragments, duplicate/extra query fields and noncanonical base64url before decoding. It verifies approval issue time against both the original request and the bounded future clock window, persists callback replay state before creating the Product Session challenge, and retains the Android Keystore P-256 device boundary. `apps/wallet/scripts/social-harness-contract-check.mjs` makes these source invariants a Wallet release gate.

Local verification for `2fc06131` passed Wallet typecheck, 51/51 Wallet tests, 113/113 Wallet/Auth package tests, product check, Social harness contract check, release-content check, full-goal coverage and `git diff --check`. The Social harness also completed offline API 36 `:app:assembleDebug` successfully. No `adb`, emulator, process query or device interaction was performed, so for this exact source `testedOnDevice=false`, `installedLocal=false`, `downloadHosted=false`, `deployedPublic=false`, `productionSigned=false` and `storeReleased=false`. Historical source-bound APK evidence above remains historical and is not promoted to this commit.

## Multi-account switch relock checkpoint

Commit `73e451191992d1275dd597cd390fccf9686cbb42` corrects the Android multi-account authorization boundary. The prior reducer transferred the unlocked state from the old account to the newly selected account. Selection persistence also ran before the relock dispatch, so a failed or delayed secure-storage operation left the old account unlocked during the attempt.

The current flow synchronously clears `unlockedAccount` with reason `account-switch` before selection persistence starts. Switching to a different account, reselecting the same account, selecting from an already locked state and a failed persistence attempt all remain locked and require fresh strong biometrics. The product gate requires the fail-closed switch policy and reducer reason so a later UI refactor cannot silently restore unlock inheritance.

Verification passed Wallet typecheck, 53/53 Wallet tests, product check, Social harness contract check, release-content check, full-goal coverage, `git diff --check` and an Android Hermes export of 2,735 modules. No device command or interaction was performed; for this exact source `testedOnDevice=false`, `installedLocal=false`, `downloadHosted=false`, `deployedPublic=false`, `productionSigned=false` and `storeReleased=false`.

Follow-up commit `a62b23284d2c360c32daa5290b02a309c53c5ee6` closes selection drift outside the explicit switch handler. Dashboard rendering now requires both `locked=false` and `unlockedAccount === selected.account`; deleting the currently selected account, an asynchronous manifest replacement or any other selection change cannot inherit another account's prior unlock. Verification passed typecheck, 54/54 Wallet tests, the same product/content/goal gates and a fresh 2,735-module Android Hermes export. Device and release booleans remain false for this source.

## Authorization Modal lifecycle checkpoint

Commit `e6c94407a2dd8cd9da57d7233a35a19dbc7d6e4b` invalidates authorization work that outlives the exact foreground review. Leaving the active App state locks Wallet and clears canonical authorization, Exchange, Quant, Developer and DEX pending Modals. Each Modal captures an attempt generation and reviewed account before biometrics, then rechecks component lifetime, current selected account and exact expiry after biometrics and after secure private-key access. Closing a Modal, backgrounding Wallet, changing account or reaching expiry cannot continue into signing or callback dispatch.

The canonical Wallet authorization request is reparsed against the current registry and clock before and after private-key access. The prior ordering that wrote `intent-approved` before final expiry validation has been removed; signing is prepared only after current request validation and replay consumption, and callback dispatch remains behind a final lifecycle check.

Verification passed Wallet typecheck, 56/56 Wallet tests, 113/113 Wallet/Auth package tests, product check, Social harness contract check, release-content check, full-goal coverage, `git diff --check` and an Android Hermes export of 2,736 modules. No device command or interaction was performed; `testedOnDevice`, `installedLocal`, `downloadHosted`, native-app `deployedPublic`, `productionSigned` and `storeReleased` remain false for this exact source.

## Process reconstruction and exact-account unlock checkpoint

Commit `16d9eb0e35122c2c91663aaa45ae131a44c857f2` makes every Wallet repository reconstruction relock before persisted state is read, dismisses all pending authorization reviews and discards the prior in-memory manifest. A failed or unavailable SecureStore reconstruction therefore cannot preserve an old account view or unlock state.

Unlock now uses a fail-closed exact-account policy: strong biometric authorization must complete first, the selected account must still match, that exact account's SecureStore secret must be readable, and the selection must still match after the asynchronous secret read. Biometric rejection, unavailable or corrupt secure material, and selection drift before or after the read never dispatch unlock. Network availability is not an unlock input and does not weaken this local self-custody boundary.

Verification passed Wallet typecheck, 58/58 Wallet tests, 113/113 Wallet/Auth package tests, product check, Social harness contract check, release-content check, full-goal coverage, `git diff --check` and an Android Hermes export of 2,737 modules. No device command or interaction was performed; `testedOnDevice`, `installedLocal`, `downloadHosted`, native-app `deployedPublic`, `productionSigned` and `storeReleased` remain false for this exact source.

## Cold-start admission and action callback replay checkpoint

Commit `52edb133efdc816cd0b1091c63076d28cdf2e8e8` sequences initial deep-link admission behind successful SecureStore and repository reconstruction. A single link delivered while reconstruction is pending is held without parsing or presenting a review; reconstruction failure discards it. Duplicate or otherwise ambiguous startup delivery is discarded rather than selecting one request. Locale changes no longer recreate the repository load callback and cannot implicitly relock or replay the initial URL.

Commit `6f45295be28cd51debf50feb4cf2544dbc0e406d` adds persistent exact-request replay consumption for Exchange, Developer, DEX and Quant action callbacks. Each key binds the action domain to the package-defined canonical request digest. Writes are serialized, bounded and canonical; malformed storage, duplicate keys, expiry, capacity exhaustion and concurrent duplicate attempts all fail closed. Replay consumption is persisted and the foreground/account/expiry lifecycle is revalidated before any callback handoff, so process reconstruction cannot authorize the same reviewed action again.

Verification passed Wallet typecheck, 63/63 Wallet tests, 113/113 Wallet/Auth package tests, product check, Social harness contract check, release-content check, full-goal coverage, `git diff --check` and an Android Hermes export of 2,739 modules. These are source and local-test facts only. No device command or interaction was performed; `testedOnDevice`, `installedLocal`, `downloadHosted`, native-app `deployedPublic`, `productionSigned` and `storeReleased` remain false for these exact commits.

Follow-up commit `ab2c137950297f58bb95b9e614ce22bea3a40ca6` requires Exchange, Developer, DEX and Quant action deep links to equal the byte-exact canonical URL regenerated from the strictly parsed request. URL-parser normalization can no longer make alternate-case schemes, userinfo authorities or percent-normalized hosts acceptable. Commit `02fe097202fec8fe6589798720cb3f40f65e73a8` applies the same rule to authorization callbacks: generation rejects noncanonical registered callback values, and parsing accepts only the exact registered callback followed by one canonical `response` parameter.

Both follow-ups passed Wallet/Auth 113/113, Wallet 63/63, typecheck and every Wallet product/content/coverage gate. The Android Hermes export was rerun through a mode-0700 dependency overlay that explicitly resolved `@ynx-chain/wallet-auth` to the current rescue clone; it succeeded with 2,739 modules. The overlay and all temporary dependency links were removed. No device command or interaction was performed, so all exact-source device and release booleans remain false.

Commit `5260159fbf68dabbfd6a1ec8b57c520ec1f96291` restricts the non-authorizing launcher to the single byte-exact `ynxwallet://open` string. Alternate-case schemes, userinfo, ports, percent-normalized hosts, paths, queries and fragments cannot masquerade as the safe launcher or clear a pending review. Commit `b2a61ed5da255770e169340ef9ac3130f6184f04` binds every initial and runtime deep-link admission to exact active AppState; background, inactive and unknown state reject the link and the existing catch path clears every review.

Verification passed Wallet 65/65, typecheck, product check, Social harness contract check, release-content check, full-goal coverage and `git diff --check`. A current-source Android Hermes export passed with 2,741 modules. No `adb`, emulator or process command was issued; device and release booleans remain false for these commits.

## Sensitive Wallet operation lifecycle checkpoint

Commit `df55d2bb5a0913a8c6a345b9f4440f99d5e963e4` extends background and account-drift invalidation beyond Product authorization Modals. Native transfer, recovery-key reveal, account creation/import/recovery, local account deletion and approval revocation now capture an exact operation/account binding and component generation. Each flow revalidates after biometric and asynchronous reads, and immediately before its first broadcast or persistent mutation.

Repository and audit mutation entry points accept a final synchronous lifecycle assertion after their prerequisite reads and before SecureStore writes. Tests prove a dismissed attempt cannot add account material, delete an existing account or append a revocation record. Offline/network failure cannot weaken the local gate: native transfer still requires the authoritative account/nonce response, exact secure account material and an active review before broadcast.

Verification passed Wallet 68/68, typecheck, product check, Social harness contract check, release-content check, full-goal coverage and `git diff --check`. A mode-0700 current-source dependency overlay resolved Wallet/Auth to this clone and produced an Android Hermes export of 2,742 modules; all temporary links were removed. No device command or interaction was performed, so exact-source device and release booleans remain false.

Follow-up commit `f5fab472836231b4b34367d9a107069ad0170195` serializes every authorization-audit append and revoke through one in-process queue. Concurrent callback records can no longer overwrite the same sequence, and concurrent duplicate revocations deterministically persist exactly one terminal record while the second fails as already revoked. Verification passed the focused 4/4 audit suite, Wallet 69/69, all Wallet gates and a current-source 2,742-module Android Hermes export. Device and release booleans remain false.

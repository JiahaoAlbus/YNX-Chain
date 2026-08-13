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

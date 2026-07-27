# YNX Browser evidence index

## Current local checkpoint

Source commit: `88bf8dddf06411ea26749abdd5ea52173b7cd10a`

- Browser tests: 14/14 pass.
- Browser Smoke: persistent state and exact-origin permission boundary pass.
- Web4 permissions/Wallet registry tests: 15/15 pass.
- macOS Swift 6.1 release build: pass for arm64.
- macOS Testnet Preview packaging: pass with ad-hoc signature.
- macOS cold start, graceful quit and restart: pass.
- macOS machine-readable evidence: `macos-release-88bf8dd.json`.

## Local artifacts

- Android: `dist/android/YNX-Browser-Testnet-Preview-Android.apk` (generated,
  ignored); the prior API 36 preview evidence remains historical until the final
  branch install/cold-start rerun.
- macOS: `dist/macos/YNX-Browser-Testnet-Preview-macOS.zip` (generated,
  ignored); 103039 bytes; SHA-256
  `d41826d277f10a96ef3c5621a3c514689d9a450f094da36c8c87fce8c1efc506`.
- macOS executable SHA-256:
  `279cac226dab8fe06b9f394984a53a900d560008a44ce87a99894804b090eb56`.

The macOS app is an ad-hoc-signed local Testnet Preview. `codesign` verification
passes, while Gatekeeper rejects it because it is not Developer ID signed or
notarized. It is not production signed, hosted, installed to a user application
location, or store released.

## Platform CI

Workflow: `.github/workflows/browser-platform-evidence.yml`. It builds and then
installs/cold launches/restarts Android, iOS Simulator, macOS and Windows hosts;
also exercises deep links where supported and verifies Android private process
isolation. CI artifact names are:

- `ynx-browser-android-testnet-preview`
- `ynx-browser-ios-simulator-testnet-preview`
- `ynx-browser-macos-testnet-preview`
- `ynx-browser-windows-testnet-preview`

Hashes, byte counts, signing metadata, screenshots and process/install logs live
inside each artifact. The final run URL and results are recorded in
`PLATFORM_EVIDENCE.md` and `product-release.json` after the run completes.

## Remaining evidence gates

- Complete one normal and one Private macOS download and prove only the normal
  record persists with the initiating source and selected filename.
- Exercise the macOS `ynxbrowser` deep-link callback and rejection states.
- Run Windows/.NET 8 compile, package, install, protocol registration and
  Wallet callback replay/tamper/expiry tests.
- Rerun Android final-branch installation and full iOS Simulator evidence.
- Obtain central Wallet/Auth acceptance, shared Testnet evidence, hosting,
  production signing/notarization and public `/browser` proof.

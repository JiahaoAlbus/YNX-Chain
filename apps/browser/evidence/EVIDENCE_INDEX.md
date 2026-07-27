# YNX Browser evidence index

## Current local checkpoint

Source commit: `f2f9aaed8d3e4231d37c94de352077008a338572`
Native download runtime commit: `668cb44dab95374ba9e5342d754b6ec568564f2b`

- Browser tests: 14/14 pass.
- Native macOS download-persistence tests: 3/3 pass against the exact function called by the WKDownload delegate.
- Browser Smoke: persistent state and exact-origin permission boundary pass.
- Web4 permissions/Wallet registry tests: 15/15 pass.
- Production source gate: pass for deployment filler, fake-success markers and common embedded-secret patterns.
- macOS Swift 6.1 release build: pass for arm64.
- macOS Testnet Preview packaging: pass with ad-hoc signature and ZIP integrity verification.
- Two consecutive same-host builds produced the same ZIP SHA-256.
- macOS cold start, graceful quit and restart: pass.
- Current machine-readable evidence: `macos-release-f2f9aae.json`.
- Historical machine-readable evidence: `macos-release-88bf8dd.json`.

## Local artifacts

- Android: `dist/android/YNX-Browser-Testnet-Preview-Android.apk` (generated,
  ignored); the prior API 36 preview evidence remains historical until the final
  branch install/cold-start rerun.
- macOS: `dist/macos/YNX-Browser-Testnet-Preview-macOS.zip` (generated,
  ignored); 109273 bytes; SHA-256
  `df24eb70667572b3122137f41883bc9d6b02bec8e7728e727b44bcb09cc176ce`.
- macOS executable SHA-256:
  `822947dd8a9146e66274d3ebce1ff56d2e3e2a476493d8069611d7d88e9769dc`.
- Reproducibility scope: two consecutive builds on the same host, toolchain,
  source tree and ad-hoc signing class produced the same ZIP hash. Cross-host
  reproducibility is not yet claimed.

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

- Complete one normal and one Private network download through WKWebView and
  NSSavePanel. The exact persistence policy is now natively tested, but the
  full UI interaction recording remains open.
- Exercise the macOS `ynxbrowser` deep-link callback and rejection states.
- Run Windows/.NET 8 compile, package, install, protocol registration and
  Wallet callback replay/tamper/expiry tests.
- Rerun Android final-branch installation and full iOS Simulator evidence.
- Obtain central Wallet/Auth acceptance, shared Testnet evidence, hosting,
  production signing/notarization and public `/browser` proof.

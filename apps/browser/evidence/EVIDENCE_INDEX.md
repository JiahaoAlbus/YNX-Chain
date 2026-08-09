# YNX Browser evidence index

## Current local checkpoint

Current central-candidate source commit: `96dfc528ddd62cb3ec3a574d7f1a5ae37e99ad44`

## 2026-08-04 central public-preview candidate

- `macos-public-preview-96dfc52.json` binds the exact arm64 ZIP and executable hashes to the current central candidate.
- Browser Node tests: 18/18; native Swift tests: 20/20; Wallet/permission contract tests: 15/15.
- Two same-host release builds produced the same ZIP SHA-256: `939c50454720be24e8de109f758a49e5f58342542d18d6d513639a2f90c84448`.
- The package is still ad-hoc signed, rejected by Gatekeeper, not notarized and not Developer ID signed.
- The current candidate is not described as installed: an older registered app with the same Bundle ID retained the `ynxbrowser` protocol handler on the evidence host.

The records below are historical checkpoints and must not be attributed to the current central candidate unless their source commit matches.
Wallet callback runtime commit: `d9580e6b9d09a9d2eec69fbcb6d35a9ddf6997ed`
Native download runtime commit: `668cb44dab95374ba9e5342d754b6ec568564f2b`

- Browser tests: 18/18 pass.
- Native macOS tests: 20/20 pass, including 17 Wallet callback boundary tests and 3 download-persistence tests.
- Browser Smoke: persistent state and exact-origin permission boundary pass.
- Web4 permissions/Wallet registry tests: 15/15 pass.
- Production source gate: pass for deployment filler, fake-success markers and common embedded-secret patterns.
- macOS Wallet pending state is P-256 signed and bound to Nonce, expiry, chain, product, client, bundle, callback, algorithm and ordered scopes.
- Current Dist protocol probes recorded `MALFORMED`, `ROUTE`, `DUPLICATE` and `STATE-MISSING` rejection codes through privacy-safe OSLog events.
- macOS Swift 6.1 release build: pass for arm64.
- macOS Testnet Preview packaging: pass with ad-hoc signature and ZIP integrity verification.
- Two consecutive same-host builds produced the same ZIP SHA-256.
- macOS cold start, termination and restart: pass.
- Current machine-readable callback and artifact evidence: `macos-wallet-callback-bde6939.json`.
- Current non-destructive installation evidence: `macos-install-2beece6.json`; the exact reviewed binary is installed under an immutable name and LaunchServices resolves the protocol to that hash.
- Historical machine-readable evidence: `macos-release-f2f9aae.json` and `macos-release-88bf8dd.json`.

## Local artifacts

- Android: `dist/android/YNX-Browser-Testnet-Preview-Android.apk` (generated,
  ignored); the prior API 36 preview evidence remains historical until the final
  branch install/cold-start rerun.
- macOS: `dist/macos/YNX-Browser-Testnet-Preview-macOS.zip` (generated,
  ignored); 138216 bytes; SHA-256
  `c487748ca19c65b62425b5ba536c7714e49321afad6e590fd70be15f5b88c655`.
- macOS executable SHA-256:
  `cae76c48e0acb8241f3501115cee118865c3d2b54ee945b7091d4894208943a9`.
- Reproducibility scope: two consecutive builds on the same host, toolchain,
  source tree and ad-hoc signing class produced the same ZIP hash. Cross-host
  reproducibility is not yet claimed.

The macOS app is an ad-hoc-signed local Testnet Preview. `codesign` verification
passes, while Gatekeeper rejects it because it is not Developer ID signed or
notarized. The installer preserved the source-mismatched user Applications copy,
installed the exact reviewed binary under an immutable evidence name and proved
LaunchServices resolves the protocol to that hash. `installedLocal` is therefore
true only for this evidence host. It is not production signed, hosted, notarized,
cross-host verified, or store released.

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
- Complete a centrally accepted positive macOS Wallet/Auth callback with Gateway
  signature and product-device challenge verification. Local negative protocol
  paths are proven; no Product Session is created locally.
- Run Windows/.NET 8 compile, package, install, protocol registration and
  Wallet callback replay/tamper/expiry tests.
- Rerun Android final-branch installation and full iOS Simulator evidence.
- Obtain central Wallet/Auth acceptance, shared Testnet evidence, hosting,
  production signing/notarization and public `/browser` proof.

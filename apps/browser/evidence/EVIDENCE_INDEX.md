# YNX Browser evidence index

## Local artifacts

- Android: `dist/android/YNX-Browser-Testnet-Preview-Android.apk` (generated,
  ignored); API 36, min SDK 28, RSA-3072 public disposable preview key, APK v3.
- macOS: `dist/macos/YNX-Browser-Testnet-Preview-macOS.zip` (generated,
  ignored); macOS 14+, ad-hoc signed, not notarized.

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

## Contract verification

- Browser tests: 9/9.
- Browser smoke: persistent state and exact-origin permission boundary.
- Web4 permissions/Wallet registry tests: 15/15.
- macOS Swift release build and both preview packaging scripts pass locally.
- `UI_DESIGN_AUDIT.md` records the manual design/security-state review.

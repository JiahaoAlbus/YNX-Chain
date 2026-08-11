# YNX Docs evidence index

- Protocol/security: shared Go tests, Docs mobile `wallet.test.ts`, and Cloud integration failure vectors.
- Real API smoke: Cloud’s canonical smoke covers v1→v2 save, stale-base 409, version-bound comment, bounded presence, audit, deletion, and backup/restore.
- Web runtime images: `screenshots/docs-desktop-empty-en.png`, `docs-desktop-autosave-en.png`, `docs-desktop-dark-en.png`, `docs-mobile-rtl-ar.png`.
- Historical Android runtime: `screenshots/docs-android-release.png`; package `com.ynxweb4.docs`, cold launch and `ynxdocs://wallet-auth/callback` routing were verified by `adb` for the retained historical preview, not the current source.
- Historical artifact: `ARTIFACT_MANIFEST.json` and `release/YNX-Docs-1.0.0-testnet-preview.apk`; the manifest hash is exact but the package is not a current-source or production-signed artifact.
- UI/a11y/RTL: `UI_DESIGN_AUDIT.md`, Web static tests, and native i18n audit.
- iOS: `.github/workflows/cloud-docs-ios-simulator.yml` passed the unsigned Cloud and Docs Simulator Release build on macOS 26 / Swift 6.2 in [workflow run 31446228989](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/31446228989). Device installation, production signing, and store release are not claimed.
- Historical public runtime: `https://web4.ynxweb4.com/docs-app/` remains reachable, but no deployment receipt binds it to source `57a736a3e917d7cc62cbd5487d90b469e0323a28`. It is not current-source public evidence and no hosted current download, production durability, or HA claim is made.

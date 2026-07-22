# YNX Docs evidence index

- Protocol/security: shared Go tests, Docs mobile `wallet.test.ts`, and Cloud integration failure vectors.
- Real API smoke: Cloud’s canonical smoke covers v1→v2 save, stale-base 409, version-bound comment, bounded presence, audit, deletion, and backup/restore.
- Web runtime images: `screenshots/docs-desktop-empty-en.png`, `docs-desktop-autosave-en.png`, `docs-desktop-dark-en.png`, `docs-mobile-rtl-ar.png`.
- Android runtime: `screenshots/docs-android-release.png`; package `com.ynxweb4.docs`, cold launch and `ynxdocs://wallet-auth/callback` routing verified by `adb`.
- Artifact: `ARTIFACT_MANIFEST.json` and `release/YNX-Docs-1.0.0-testnet-preview.apk`.
- UI/a11y/RTL: `UI_DESIGN_AUDIT.md`, Web static tests, and native i18n audit.
- iOS: `.github/workflows/cloud-docs-ios-simulator.yml` is runnable on a full-Xcode GitHub macOS runner. Local iOS evidence is absent and is not claimed.
- Staging/public/download: absent; corresponding release booleans remain false.

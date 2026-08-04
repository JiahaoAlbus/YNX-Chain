# YNX Docs evidence index

- Protocol/security: shared Go tests, Docs mobile `wallet.test.ts`, and Cloud integration failure vectors.
- Real API smoke: Cloud’s canonical smoke covers v1→v2 save, stale-base 409, version-bound comment, bounded presence, audit, deletion, and backup/restore.
- Web runtime images: `screenshots/docs-desktop-empty-en.png`, `docs-desktop-autosave-en.png`, `docs-desktop-dark-en.png`, `docs-mobile-rtl-ar.png`.
- Android runtime: `screenshots/docs-android-release.png`; package `com.ynxweb4.docs`, cold launch and `ynxdocs://wallet-auth/callback` routing verified by `adb`.
- Artifact: `ARTIFACT_MANIFEST.json` and `release/YNX-Docs-1.0.0-testnet-preview.apk`.
- UI/a11y/RTL: `UI_DESIGN_AUDIT.md`, Web static tests, and native i18n audit.
- iOS: `.github/workflows/cloud-docs-ios-simulator.yml` produced successful unsigned Cloud and Docs Simulator Release packages in [workflow run 30876233140](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/30876233140). Device installation, production signing, and store release are not claimed.
- Public: `https://web4.ynxweb4.com/docs-app/` and `https://web4.ynxweb4.com/docs-app/api/health` are live. UI and health returned 100/100 HTTP 200 responses at concurrency 20; the private object route returned 100/100 HTTP 401 responses without a Wallet session, and an invalid challenge returned HTTP 400. No hosted Docs download, production durability, or HA claim is made.

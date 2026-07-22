# YNX Cloud evidence index

- Completion truth table: `../FEATURE_COMPLETION_EVIDENCE.md` and machine-readable `../product-release.json`. False states are deliberate and may change only with direct evidence.
- Migration, observability, scale and economics boundaries: `../MIGRATION_COMPATIBILITY.md`, `../OBSERVABILITY.md`, `../SLO_CAPACITY_PLAN.md`, and `../UNIT_ECONOMICS.md`.
- Public handoff metadata and provider/license boundary: `../public-product-metadata.json` and `../THIRD_PARTY_NOTICES.md`.

- Protocol/security: `internal/cloud/service_test.go`, `server_test.go`, `adapters_test.go`, mobile `wallet.test.ts`, and `integration/failure-vectors.json`.
- Real API smoke: `scripts/canonical-smoke.mjs` and `scripts/smoke.sh` cover canonical sessions, upload/download/hash, same-name collision, share/revoke, trash/delete, quota/audit, Docs save/conflict/comment/presence, backup, and restore.
- Object-store contract: `OBJECT_STORAGE_CONTRACT.md` and `internal/cloud/recovery.go`.
- Web runtime images: `screenshots/cloud-desktop-empty-en.png`, `cloud-desktop-success-en.png`, `cloud-desktop-dark-en.png`, `cloud-mobile-rtl-ar.png`.
- Android runtime: `screenshots/cloud-android-release.png`; package `com.ynxweb4.cloud`, cold launch and `ynxcloud://wallet-auth/callback` routing verified by `adb`.
- Artifact: `ARTIFACT_MANIFEST.json` and `release/YNX-Cloud-1.0.0-testnet-preview.apk`.
- UI/a11y/RTL: `UI_DESIGN_AUDIT.md`, Web static tests, and native i18n audit.
- iOS: `.github/workflows/cloud-docs-ios-simulator.yml` is runnable on a full-Xcode GitHub macOS runner. Local iOS evidence is absent and is not claimed.
- Staging/public/download: absent; corresponding release booleans remain false.

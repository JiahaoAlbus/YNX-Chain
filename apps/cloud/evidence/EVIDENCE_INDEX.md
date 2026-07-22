# YNX Cloud evidence index

- Completion truth table: `../FEATURE_COMPLETION_EVIDENCE.md` and machine-readable `../product-release.json`. False states are deliberate and may change only with direct evidence.
- Migration, observability, scale and economics boundaries: `../MIGRATION_COMPATIBILITY.md`, `../OBSERVABILITY.md`, `../SLO_CAPACITY_PLAN.md`, and `../UNIT_ECONOMICS.md`.
- Public handoff metadata and provider/license boundary: `../public-product-metadata.json` and `../THIRD_PARTY_NOTICES.md`.
- Capacity: `CAPACITY_077bfc1.json` records the exact source commit, command, environment, 100 raw-profile summary, percentiles, allocation, and strict single-process coverage boundary for the one-million-object candidate.

- Protocol/security: `internal/cloud/service_test.go`, `server_test.go`, `adapters_test.go`, mobile `wallet.test.ts`, and `integration/failure-vectors.json`.
- Client SDK: `../sdk/index.js`, `../sdk/index.d.ts`, and `../tests/sdk.test.mjs` prove short-lived token callbacks, exact API routing, product validation, error correlation, and bounded idempotent retry behavior.
- Usage/economics: schema-v5 migration plus service/server tests prove product-isolated persisted ingress, delivered range egress, scan, AI, and exact whole-second storage integration counters; `../UNIT_ECONOMICS.md` records the non-retroactive coverage and unconfigured zero-charge boundaries.
- Retention/exit: service tests prove retention validation and time-gated deletion; server tests plus `../OPERATIONS.md` prove the local user-exit mode preserves export/deletion while blocking new mutations.
- Product data erasure: schema-v6 migration, service/server tests, SDK tests, and canonical smoke prove dedicated `data.delete` authority, exact confirmation, atomic retention preflight, Cloud/Docs isolation, hashed receipts, raw-identity cleanup, session revocation, and honest provider pending/retry completion.
- Observability: `internal/cloud/telemetry_test.go`, server tests, `../OBSERVABILITY.md`, and `../observability/*.json` prove integrity-checked persistent RED bins, normalized routes, correlated bounded traces, authenticated readiness, and local alert evaluation.
- Security/supply chain: `../THREAT_MODEL.md`, `../SECURITY_BOUNDARIES.md`, `SBOM.cdx.json`, `ARTIFACT_PROVENANCE.json`, `../security/build-script-allowlist.json`, `../scripts/security-gate.mjs`, and `.github/workflows/cloud-security.yml` define and execute local controls without upgrading debug/public release claims.
- Real API smoke: `scripts/canonical-smoke.mjs` and `scripts/smoke.sh` cover canonical sessions, upload/download/hash, same-name collision, share/revoke, trash/delete, quota/audit, Docs save/conflict/comment/presence, backup, and restore.
- Object-store contract: `OBJECT_STORAGE_CONTRACT.md` and `internal/cloud/recovery.go`.
- Web runtime images: `screenshots/cloud-desktop-empty-en.png`, `cloud-desktop-success-en.png`, `cloud-desktop-dark-en.png`, `cloud-mobile-rtl-ar.png`.
- Android runtime: `screenshots/cloud-android-release.png`; package `com.ynxweb4.cloud`, cold launch and `ynxcloud://wallet-auth/callback` routing verified by `adb`.
- Artifact: `ARTIFACT_MANIFEST.json` and `release/YNX-Cloud-1.0.0-testnet-preview.apk`.
- UI/a11y/RTL: `UI_DESIGN_AUDIT.md`, Web static tests, and native i18n audit.
- iOS: `.github/workflows/cloud-docs-ios-simulator.yml` is runnable on a full-Xcode GitHub macOS runner. Local iOS evidence is absent and is not claimed.
- Staging/public/download: absent; corresponding release booleans remain false.

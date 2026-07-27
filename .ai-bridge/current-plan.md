# YNX Card Current Plan

Status: Active
Stage: FREEZE
Protected source commit: `01415dc4413dd8d4e33756a52682ca0f2a6675ec`

## Completed in the current FREEZE sequence

1. Frozen issuer capability schema `ynx.card.provider.capabilities.v1` with fail-closed conformance validation.
2. Added provider-event tamper, timestamp expiry, replay, relationship ordering and bounded key-rotation verification.
3. Added versioned `ynx.card.backup.v1` backup verification, rollback, migration compatibility, corrupt-primary quarantine and missing-primary cold restore through an operator CLI.

## Next engineering slice

1. Add structured request, error and audit correlation IDs; trace propagation; bounded metrics; and provider-outage/recovery signals.
2. Add account-scoped data export/delete and retention enforcement without exposing provider-sensitive data.
3. Retry Android unsigned native assembly; after success, install, cold start and deep-link test on API 36.
4. Build/install the iOS Simulator target and verify the Wallet callback.
5. Generate Card threat model, SBOM, dependency/license review, SLO plan and unit-economics disclosure.
6. Prepare the official issuer provider bake-off without requesting credentials until autonomous adapter and security gates are complete.

Keep all public, hosted, integrated, production-signing and store-release flags false until direct evidence exists.

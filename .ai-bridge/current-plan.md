# YNX Card Current Plan

Status: Active
Stage: FREEZE
Protected source commit: `13f90c5f6dae6fb002560574b4c481b5e1477f9d`

## Completed in the current FREEZE sequence

1. Frozen issuer capability schema `ynx.card.provider.capabilities.v1` with fail-closed conformance validation.
2. Added provider-event tamper, timestamp expiry, replay, relationship ordering and bounded key-rotation verification.

## Next engineering slice

1. Implement versioned backup/export plus an isolated restore and rollback-migration drill.
2. Add structured request/error/audit IDs, bounded Card metrics and trace propagation.
3. Retry Android unsigned native assembly; after success, install, cold start and deep-link test on API 36.
4. Build/install the iOS Simulator target and verify the Wallet callback.
5. Generate Card threat model, SBOM, dependency/license review, SLO plan and unit-economics disclosure.
6. Prepare the official issuer provider bake-off without requesting credentials until autonomous adapter and security gates are complete.

Keep all public, hosted, integrated, production-signing and store-release flags false until direct evidence exists.

# YNX Card Current Plan

Status: Active
Stage: FREEZE
Protected source commit: `bdd5ca02ad42b712db66a5173ecfad09340aa42c`

## Next engineering slice

1. Freeze a versioned issuer capability schema and provider-adapter conformance tests.
2. Add negative vectors for event tamper, timestamp expiry, out-of-order clearing/reversal and provider key rotation.
3. Implement versioned backup/export plus an isolated restore and rollback-migration drill.
4. Add structured request/error/audit IDs and bounded Card metrics.
5. Retry Android unsigned native assembly; after success, install, cold start and deep-link test on API 36.
6. Build/install the iOS Simulator target and verify the Wallet callback.
7. Generate Card threat model, SBOM, dependency/license review, SLO plan and unit-economics disclosure.

Do not request issuer credentials or signing assets until all autonomous adapter,
security, build and integration preparation is complete. Keep all public and
production release flags false until direct evidence exists.

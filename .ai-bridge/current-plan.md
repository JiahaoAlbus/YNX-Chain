# YNX Shop current plan

Status: Active
Stage: FREEZE → INTEGRATE
Source commit: `0347320463466cf9a265c7447fbced0218a32cab`

## Completed checkpoints

- `4cd59fcb11e11d221defa88d20ac0d50b7663b99`: buyer data export/deletion, retention boundary, Web/Android/iOS controls and tests.
- `77d047076537fffb4290d9389516c73f3a4cbede`: fail-closed validation when scanner dependencies are absent.
- `ef97eadea90e2b6f4f24225c52e6093b5d5de567`: Node fallback for secret scanning; real secret and placeholder scans pass.
- `5ce3ae56d14b73c4d5b0c64deaa27e6353b224c3`: integration contract, release record, public metadata and full-goal coverage frozen for current truth.
- `4267fdbf3ff581043bafef5c357d915f1904b964`: Web/PWA privacy controls and dynamic export/delete states localized across all twelve locales; Arabic RTL framework retained.
- `0347320463466cf9a265c7447fbced0218a32cab`: Android and iOS privacy controls, warnings and dynamic results localized across all twelve locales with Arabic RTL verification.

## Next autonomous actions

1. Add versioned persistence migration/rollback and old-client vectors for privacy records.
2. Add Shop-specific SLO/load evidence, unit economics and observability counters.
3. Package current Web/API artifacts with hashes and provenance.
4. Resolve shared-repository preflight failures without weakening permission checks.

## External integration gates

- Wallet/Auth owner must merge and deploy the Shop registry entry.
- Pay owner must provision a Shop Testnet merchant and payout address.
- Android current-source build requires an Android SDK build host.
- iOS current-source build requires full Xcode and Simulator.
- Current source still requires staging deployment and public verification.

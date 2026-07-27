# YNX Shop current plan

Status: Active
Stage: FREEZE → INTEGRATE
Source commit: `ef97eadea90e2b6f4f24225c52e6093b5d5de567`

## Completed checkpoints

- `4cd59fcb11e11d221defa88d20ac0d50b7663b99`: buyer data export/deletion, retention boundary, Web/Android/iOS controls and tests.
- `77d047076537fffb4290d9389516c73f3a4cbede`: fail-closed validation when scanner dependencies are absent.
- `ef97eadea90e2b6f4f24225c52e6093b5d5de567`: Node fallback for secret scanning; real secret and placeholder scans pass.

## Next autonomous actions

1. Localize the new privacy controls across the twelve supported locales and verify Arabic RTL.
2. Add versioned persistence migration/rollback and old-client vectors for privacy records.
3. Add Shop-specific SLO/load evidence, unit economics and observability counters.
4. Package current Web/API artifacts with hashes and provenance.
5. Resolve shared-repository preflight failures without weakening permission checks.

## External integration gates

- Wallet/Auth owner must merge and deploy the Shop registry entry.
- Pay owner must provision a Shop Testnet merchant and payout address.
- Android current-source build requires an Android SDK build host.
- iOS current-source build requires full Xcode and Simulator.
- Current source still requires staging deployment and public verification.

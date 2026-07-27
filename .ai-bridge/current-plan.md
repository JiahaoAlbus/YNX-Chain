# YNX Pay current plan

Status: Active. Current phase: FREEZE moving toward INTEGRATE.

1. Preserve the full local Split consumer flow at `a405604714645df1084ed9e06cc7d7b6f9a4d4b0` and bind release evidence to it.
2. Push and verify the source-bound Split UI metadata checkpoint.
3. Implement the Quant/service-billing evidence validator, including externally signed high-water-mark evidence and fail-closed fee calculation.
4. Add fixture-based migration/rollback and timed backup/restore verification.
5. Add dependency-aware health/version, metrics and trace correlation, then run repeatable capacity/unit-economics measurements.
6. Ask `29-integration` to accept the Pay contract and run Wallet/Gateway cross-product vectors; after central acceptance, run a fresh YNX Testnet payment, two-account Split flow, sponsorship, refund, dispute and webhook retry proof.
7. Continue current mobile install/cold-launch and accessibility proof when the required device/runtime authority is available.

Do not mark central, public, hosted, signed or store states true without direct evidence.

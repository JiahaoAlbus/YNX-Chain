# YNX Pay current plan

Status: Active. Current phase: FREEZE moving toward INTEGRATE.

1. Preserve the tested Split Payment runtime and canonical Pay contract in a source-bound commit.
2. Replace every `WORKTREE_PENDING_COMMIT` reference with the resulting commit SHA and verify machine-readable JSON.
3. Push `codex/final-pay` and establish/verify its upstream remote SHA.
4. Ask `29-integration` to accept the Pay contract and run Wallet/Gateway cross-product vectors.
5. After central acceptance, run a fresh YNX Testnet payment, two-account Split flow, sponsorship, refund, dispute and webhook retry proof.
6. Continue Pay-owned autonomous gaps: Quant fee evidence validator, fixture migration/restore drill, real observability, capacity/unit-economics measurements, current mobile install and accessibility proof.

Do not mark central, public, hosted, signed or store states true without direct evidence.

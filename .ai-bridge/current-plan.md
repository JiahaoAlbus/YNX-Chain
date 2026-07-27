# YNX Merchant Console current plan

Stage: **FREEZE**  
Goal status: **Active**  
Latest runtime commit: `1f7963c8153a8a75cbbec0baadd1471ca5f2c9e9`  
Remote: `60f860791a09e41a3bf0509184d5a91ea926e985` (push blocked by three upstream HTTP 502 responses)

## Completed checkpoint

- Recovered the exact product worktree/branch and confirmed a clean protected baseline.
- Added auditable `/version` output and release metadata headers to all API responses.
- Added build-time linker inputs and deterministic started-at metadata.
- Added race-tested release metadata acceptance.
- Created a verified recovery bundle for runtime commit `1f7963c`.
- Created the full-goal coverage matrix, integration contract, handoff, test vectors and dependency acceptance ledger.

## Next autonomous engineering slice

1. Validate all new JSON documents and rerun focused runtime/frontend tests.
2. Bind API contract, release record and evidence ledgers to runtime commit `1f7963c`.
3. Commit the FREEZE checkpoint, regenerate a bundle that contains both runtime and FREEZE commits, and retry push with bounded attempts.
4. Continue the highest-priority runtime gap that does not require central credentials: signed Quant/Billing evidence ingestion **or** merchant data export/delete/retention state machines. Prefer the former only after the contract shape is exact; otherwise implement data-rights state machines first.
5. Keep `integratedCentral`, deployment, hosting, signing and store states false until direct evidence exists.

## Do not do

- Do not modify another worktree.
- Do not create alternate Wallet/Auth, Pay, Quant, Trust, Billing Ledger or Integration authorities.
- Do not request secrets in chat.
- Do not mark local tests as shared-Testnet or public evidence.

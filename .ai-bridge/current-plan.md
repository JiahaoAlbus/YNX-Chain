# YNX Merchant Console current plan

Stage: **FREEZE**  
Goal status: **Active**  
Latest protected source: `c9eb7e41054fa4f88a3c0f2cc5352a3d187f4504`  
Remote checkpoint: `c9eb7e41054fa4f88a3c0f2cc5352a3d187f4504`

## Completed checkpoints

- Recovered the exact product worktree/branch and confirmed no concurrent writer.
- Preserved, reviewed, tested, committed and pushed Merchant Data Rights runtime commit `b0934a0`.
- Added owner-only schema-v1 tenant export, runtime-material redaction, versioned retention, exact-confirmation/idempotent deletion requests, 168-hour cooling off, deterministic blockers, cancellation and audit.
- Upgraded persistent snapshot schema to v3, migrated v1/v2, rejected future schemas, and included data requests in backup/restore counts.
- Bound contracts, migrations, release evidence and coverage at evidence commit `0c275ff`.
- Diagnosed GitHub Actions run 7 failure as a locale false positive: case-insensitive `TODO` matching rejected normal Spanish/Portuguese `Todo/Todos` copy.
- Replaced the grep gate with a semantic source scanner and positive/negative tests at commit `c9eb7e4`.
- Reproduced every workflow gate locally: Node install/check/audit/source scan/build, Go test/vet and three fuzz targets.
- GitHub Actions run `30276842541` for `c9eb7e4` completed successfully; frontend and backend jobs were fully green.
- Local HEAD, upstream and direct remote branch SHA match; ahead/behind is `0/0`.

## Immediate checkpoint actions

1. Bind the successful CI run, no-artifact state and no-visible-release state into coverage/release/evidence records.
2. Commit and push the CI evidence checkpoint and verify exact Local SHA = Remote SHA.
3. Inspect repository-owned Quant/Billing/Data Fabric contracts. Implement only strict accepted-contract ingestion; do not invent schemas or authority.
4. If no exact accepted contract exists, implement the next independent operations slice: server-side search/filter/cursor pagination and confirmation-bound bulk operations with tenant/RBAC/idempotency/audit tests.
5. Keep `integratedCentral`, Testnet, deployment, hosting, signing and store states false until direct evidence exists.

## Boundaries

- Do not modify another worktree or replace central Wallet/Auth, Pay, Quant, Trust, Billing Ledger or Integration authority.
- Do not request or expose secrets.
- Do not represent local tests, Git synchronization, green CI or unsigned bundles as shared-Testnet/public/production evidence.

# YNX Merchant Console current plan

Stage: **FREEZE**  
Goal status: **Active**  
Latest runtime commit: `b0934a09df9d2dbea67abb596ad84154ab168312`  
Remote runtime checkpoint: `b0934a09df9d2dbea67abb596ad84154ab168312` (push succeeded)

## Completed checkpoint

- Recovered the exact product worktree/branch and confirmed no concurrent writer.
- Preserved and reviewed the existing Merchant Data Rights dirty slice.
- Added owner-only `data-manage` authorization and four authenticated data-rights routes.
- Added schema-v1 tenant export with runtime/session/replay/provider/webhook authentication redaction.
- Added versioned retention policy, exact-confirmation/idempotent deletion request, 168-hour cooling off, deterministic retention blockers, cancellation and audit.
- Upgraded persistent snapshot schema to v3, migrated v1/v2, rejected future schemas, and included data requests in backup/restore counts.
- `go test ./internal/payproduct/...` and `go test -race ./internal/payproduct/...` passed.
- Runtime commit `b0934a0` was pushed to `origin/codex/final-merchant-console`.
- Full-repository `go test ./...` remains red only in unrelated owner areas: missing bounded-IDE contract artifact and darwin permission-mode checks in consensus/faucet/trust.

## Immediate checkpoint actions

1. Validate updated contract/release/coverage JSON and review all evidence diffs.
2. Commit and push the evidence checkpoint; verify exact Local SHA = Remote SHA and clean status.
3. Retry GitHub Actions/Releases/Artifacts inspection with bounded network attempts.
4. Continue the highest-priority autonomous runtime gap: signed Quant/Billing evidence acceptance only if an exact owner contract exists; otherwise implement operational search/filter/pagination and confirmed bulk-operation contracts.
5. Keep `integratedCentral`, Testnet, deployment, hosting, signing and store states false until direct evidence exists.

## Boundaries

- Do not modify another worktree or replace central Wallet/Auth, Pay, Quant, Trust, Billing Ledger or Integration authority.
- Do not request or expose secrets.
- Do not represent local tests, Git synchronization or unsigned bundles as shared-Testnet/public/production evidence.

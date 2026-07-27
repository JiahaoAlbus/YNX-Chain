# YNX Finance Active Plan

## Current stage

FREEZE. The source-truth and activity-cursor runtime slice is protected at `b7147cee87275a3d7b0b452aae29bfbd93667dff`, and the remote branch matches. The local Finance read contract is now versioned; central dependency acceptance remains pending direct owner contracts and Testnet evidence.

## Protected scope

- Explorer health/native-asset validation before account evidence.
- Source version, `asOf`, coverage, sync and error semantics.
- HMAC-SHA-256 activity cursors bound to Wallet account and source snapshot.
- Operator-managed `YNX_FINANCE_CURSOR_SIGNING_KEY` startup gate.
- Finance integration contract, handoff, dependency acceptance and negative vectors.
- Machine-readable full-goal coverage matrix and truthful release state.

## Verification before checkpoint

1. Validate all modified JSON.
2. Run `gofmt` and uncached Finance Go tests.
3. Run Finance smoke, Gateway tests and native checks.
4. Run diff/placeholder/secret gates applicable to the changed scope.
5. Review with `show_changes`.
6. Commit and push `codex/final-finance`; verify local SHA equals remote SHA.

## Next autonomous runtime slice

Implement explicit Finance state backup and restore with integrity manifest, atomic restore, corrupted-backup rejection, restart proof and migration/rollback documentation. Do not wait for external source contracts before completing this local recovery work.

## Later priority

Create fail-closed read adapter contracts for Exchange, DEX, Quant and Economics; then implement only against owner-frozen schemas. Add request/error IDs, metrics and source SLOs before staging.

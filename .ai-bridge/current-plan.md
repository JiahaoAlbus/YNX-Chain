# Current Plan — YNX Data Fabric

Status: `ACTIVE`
Phase: `INTEGRATE`
Engineering Source Commit: `3a1bcceddc9e680761ce9563bb3d6cd823037222`
Release Candidate: `ynx-data-fabric-3a1bcceddc9e`

## Completed and protected

- Exact Worktree and Branch verified; no concurrent writer found.
- Envelope v2 JSON Schema published and bound by reflection tests to the runtime envelope.
- Product event contract points to Envelope v2 and Schema Registry v2 while retaining v1 compatibility.
- Engineering commit pushed; Local and Remote SHA matched.
- Full Go tests pass with the standard permission-test umask; Data Fabric Race and targeted tests pass.
- GitHub Actions Run `30279794834` succeeded for the engineering Source Commit.
- Release truth, full-goal coverage, Integration Contract, Handoff and public metadata are source-bound to the current engineering commit.
- Legacy recovery summaries are preserved under `recovery/2026-07-23/` and are explicitly non-authoritative.
- Release Truth positive and negative vectors, policy scans, full Quality Gates, full Go tests and expanded Data Fabric Race pass.

## Current slice

1. Review the complete evidence and recovery archive diff with `show_changes`.
2. Commit the source-bound evidence slice without changing the engineering Source Commit.
3. Push, verify Local SHA equals Remote SHA and record the evidence-commit CI result.
4. Resume the highest-priority central-integration adapter and shared-Testnet work.

## Next engineering action

After the evidence slice is protected, implement the highest-priority autonomous central-integration adapter work that does not require modifying another Worktree. Execute the Wallet/App Gateway fail-closed acceptance vector first when owner endpoints are available, then the shared-Testnet Pay vector. Keep phase `INTEGRATE` and all central, staging and public states false until direct receipts exist.

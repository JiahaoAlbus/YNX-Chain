# YNX 27 DEX decision log

## 2026-07-29 — Preserve distinct source roles

- `product-release.json.commit` remains the packaged contract/SDK source base `4d9f9c807efb2529836a1324b17c697e91a23421` because artifact verification intentionally fails on packaged-source drift.
- The latest DEX runtime/recovery source is `7d61369e02ab4d50a9fc36c927dc487e47ce9814`.
- The protected evidence checkpoint observed during recovery is `f933440d5cb791044476eb69c58c522d5c91d8a1`.
- These roles must not be collapsed into one ambiguous SHA.

## 2026-07-29 — Recovery status classification

- The point-in-time authenticated state/cursor backup and isolated restore drill is `testedLocal`.
- Operational RPO remains unproven until the same drill runs against a quiesced provisioned Testnet indexer.
- Down-schema rollback migration remains incomplete and must stay separate from disaster recovery.

## 2026-07-29 — Public truth boundary

- No PR, Actions run, DEX Release, hosted artifact or public DEX runtime was found for `codex/final-dex`.
- Local tests, packages and screenshots cannot set any public, hosted, signed, merged or deployed status to true.
- `ynxweb4.com` remains the only allowed YNX product domain; `huangjeo.com` is not a DEX product, docs, status or canonical URL.

## 2026-07-29 — Security scan must fail closed

- The inherited secret scan returned success when `rg` was unavailable because command-not-found was evaluated as the false branch of an `if`.
- The gate now uses `rg` when available, otherwise scans Git-known non-ignored files with `grep`, and distinguishes no-match, secret-found and scanner-error exit states.
- A missing scanner or scan error may no longer produce a passing security claim.

## 2026-07-29 — Repository-wide test ownership

- `go test ./...` currently fails only in unchanged shared `internal/api` Hardhat selector metadata tests.
- YNX 27 records and hands off the defect rather than modifying Developer/API implementation outside its ownership boundary.
- Focused DEX Race tests remain the authoritative YNX 27 runtime gate until the shared dependency is repaired and reaccepted.

## 2026-07-29 — Next autonomous protocol slice

- Concentrated liquidity is the next protocol gap after recovery evidence synchronization.
- Implementation must be clean-room and begin with a bounded invariant-tested pool slice, not copied third-party source or a full routing/UI claim.

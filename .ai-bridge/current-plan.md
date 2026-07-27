# YNX Browser current plan

Updated: 2026-07-27  
Branch: `codex/final-browser`  
Goal: Active  
Phase: PROTECT, with a Browser-owned FREEZE candidate prepared

## Protected runtime checkpoints

1. `06fb7ee7e321743288348feefa3fb76e9f096463` — isolate macOS Private download metadata and bind source attribution to the initiating tab.
2. `91685b728cefefabec9414317f2663d659062edc` — state schema v2, v1 rollback backup, migration, corruption recovery, export/delete and backup/restore core.
3. `0515ff50b22547840c6554b29c4af3cd17484800` — Windows non-exportable CNG P-256 Wallet request builder and strict callback envelope.

## Immediate sequence

1. Commit the release record, goal coverage, Browser integration contract, vectors, dependency acceptance and handoff.
2. Push `codex/final-browser` and verify local HEAD equals `refs/heads/codex/final-browser` on origin.
3. Restore deterministic Swift execution; build the macOS host at the pushed commit and run normal/private download interaction evidence.
4. Run Windows CI on a Windows/.NET 8 host; compile/package/install, register `ynxbrowser`, and execute nonce/tamper/expiry/replay callback vectors.
5. Wire state-v2 export/delete/backup/restore controls into native clients and run installed restore drills.
6. Submit the four Browser tuples and vectors to 02 Wallet/Auth; keep Browser fail closed until accepted.
7. Continue the highest-priority autonomous gap: privacy-safe observability, retention/service-exit policy, SLO/capacity and supply-chain evidence.

## Truth boundary

- Browser tests: 14/14 pass.
- Wallet/permission contract tests: 15/15 pass.
- Browser Smoke: pass.
- macOS current-commit build: not verified because Swift processes hung.
- Windows current-commit build: not started because `dotnet` is absent.
- Central integration, Testnet, public deployment, hosted artifacts, production signing and store release: false/unverified.

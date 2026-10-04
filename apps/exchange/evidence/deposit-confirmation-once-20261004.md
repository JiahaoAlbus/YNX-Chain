# Exchange deposit confirmation transition and indexer hash binding

Predecessor `42e19454719b4109983f26f7ef70c55f5e34b583`, owner branch `codex/exchange-sso-cookie-binding-20261002`.

Actual unchanged-engine RED (`go test ./internal/exchangeproduct -run 'TestDeposit(Simultaneous|IndexerHash)' -count=1`, 1.062s): simultaneous reads both saw the same confirming deposit, then each published a credit; observed balance 8000000 instead of 4000000. A returned transfer hash different from the requested hash was accepted with nil error. Controlled synthetic engine accounts/fake indexer/temp durable state only; no user key, RPC, public wallet, chain transfer or real deposit.

Minimal product fix: ObserveDeposit binds returned Hash to the requested transaction. RefreshDeposit binds returned Hash to the existing observation, then re-reads existence/account/terminal status inside the publication lock after the external read. An already confirmed deposit returns the existing observation rather than crediting again. No account reattribution, historical balance correction, schema change, Auth grant, shared SDK or public execution gate change.

The actual regression uses a barrier forcing both refreshes to finish the initial state check before either external read can return; both callers succeed but only one transition/credit occurs. Reopening the same durable service and repeating refresh preserves the exact balance. Wrong returned hash fails without any durable-byte change or credit, on both observe and confirm.

Executed GREEN:

- `go test -race ./internal/exchangeproduct -run 'TestDeposit(Simultaneous|IndexerHash)' -count=5`: PASS 1.817s.
- `go test ./internal/exchangeproduct/... ./apps/exchange/server -count=1`: PASS 5.412s / 0.452s.
- gofmt/diff checks: PASS.

Scope is a real local engine concurrency and cold-reopen proof, not PostgreSQL multi-instance or public settlement evidence. Historical duplicate credits, if any, are not silently changed and require a separately authorized reconciliation. Previous runtime candidates remain historical engineering results and need a new source-bound engine build for formal publication. Public order/custody execution, private grants, user approval/signing, installed runtimes and product completion remain unproven.

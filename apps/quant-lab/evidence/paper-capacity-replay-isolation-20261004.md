# Paper capacity, restart and replay isolation

Parent source 3fce7f431f470aebc7820a744b1b4ecf96f6fdd6. Ordinary Quant test scope; no shared authorization, runtime pins or Host changes.

Actual Go service regression creates 100 persisted Paper orders from a saved backtest strategy using an explicitly synthetic local market adapter. Order 101 is rejected. After enabling Kill and closing the service, two fresh service instances with no market adapter open the same file state. Sixteen concurrent replays of the earliest key return the original exact receipt despite capacity, Kill and feed absence. A changed side conflicts. State file bytes remain exact, orders remain 100, position remains zero and Kill stays enabled.

A separate workspace saves a different strategy and uses the same request key for a different Paper instruction; it obtains only its own receipt. No cross-workspace strategy/amount is borrowed. This tests isolated state paths, not shared database tenant authorization.

Executed:

- go test -race ./internal/quantlab -run TestPaperCapacityKeepsEarliestReceiptAcrossRestartKillAndTwoInstances -count=10: PASS, 17.252s.
- go test -race ./internal/quantlab -count=1: PASS, 3.838s.
- gofmt and git diff --check: PASS.

No production business operation or wallet approval. These are restarted service objects sharing a local durable file, not separate OS processes or PostgreSQL distributed acceptance. PostgreSQL opt-in tests remain unconfigured. publicVerified=false; installedVerified=false; realOrders=false; walletApproval=false; migratedV2=false. Existing formal public source integration remains with the release owner through the active coordinator.

# Exchange two-instance HTTP order replay and durable recovery

Source predecessor `47e428a19a32631be285114d1d15084c0849278b`, tree `ff62d5b99d43891c422a71a3fbc233ef43e855cd`; branch `codex/exchange-sso-cookie-binding-20261002`.

New executable regression: `internal/exchangeproduct/owned_order_replay_http_test.go`, `TestTwoHTTPInstancesOrderReplayMatchAndRestartRemainOwnerBound`.

Two separately opened service/repository instances expose actual loopback HTTP servers over the same isolated file-CAS state. A test seller deposits fixture YNXT; a separate test buyer receives venue-only quote credits. A resting seller limit order and two concurrent identical signed buyer requests commit exactly one matched buyer order (the other returns that order or CAS conflict). After closing both HTTP servers and reopening fresh service instances, explicit retry returns the exact committed order. Replaying the buyer signature through the seller session returns 401 without leaking the buyer order ID. Both account reads retain one owned order and one trade; ledger assertions reconcile balances. Retry and denied foreign requests leave the whole persisted state digest unchanged, including fees/audit. Guest market HTTP reads independently project exactly that single match and empty filled depth, without private account/order identity.

The initial fixture used a non-hex deposit reference and correctly failed admission; it was corrected to the existing fixture chain reference format. No production implementation change was needed by this regression.

Executed final checks:

```
go test -race ./internal/exchangeproduct -run '^TestTwoHTTPInstancesOrderReplayMatchAndRestartRemainOwnerBound$' -count=30
go test -race ./internal/exchangeproduct -count=1
git diff --check
```

All passed: repeated focused package 6.061 s, complete package 14.154 s, no reported race/failure. The complete package still contains opt-in dependencies; this PASS does not establish skipped PostgreSQL or Host cases.

Truth boundaries: this executes real product HTTP, signature verification, deterministic matching, CAS and persisted reload code using isolated generated test identities, a fixture chain adapter and venue test-credit funding. It is not a public chain transfer, standard Wallet approval, production order or browser/native acceptance. File-CAS remains labelled single-host; separately opened service objects are not OS-process or PostgreSQL multi-instance proof. Current public source mismatch/formal release integration is unchanged, and no shared SDK/Auth/authority/endpoint/formal release/Host files were modified. Future isolated PostgreSQL execution must rerun real database tests against a disposable database, not a production URL.

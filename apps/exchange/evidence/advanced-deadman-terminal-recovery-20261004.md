# Existing advanced-order terminal recovery

Inherited owner checkpoint: 36cf03a9b81421b0dc2572e28d3be637c1351786, tree f8205b1aaa0bd6eb441d711cff0e150d1ff902b8. Only five existing Exchange creation methods and their direct recovery tests change. No new product, permission, strategy execution, shared Wallet protocol or public deployment is introduced.

## Reproduced failure and correction

Conditional, OCO, TWAP, Scale and Iceberg creation all rejected the original authenticated idempotent request after dead-man expiry had already cancelled its persisted effect. All five file-backed regression cases failed with `exact replay lost settled effect forbidden` before the correction.

Existing request normalization, validation, native signature verification and digest calculation remain before cached reconciliation. Under the existing lock, the original action/digest must match and the referenced effect must exist and belong to the authenticated account. Exact replay only returns that persisted effect. New intent remains subject to the unchanged expiry, kill-switch and capital admission checks. Existing pre-lock notional validation is not bypassed or reconfigured.

## Executed recovery gates

File-backed recovery covers three exact repetitions, changed same-key intent rejection, separately authenticated foreign-owner rejection, fresh-key expiry rejection, complete state-digest equality, available/reserved balance equality, both users' ledger reconciliation, service close and second startup.

Real loopback PostgreSQL 17.11 tests use isolated per-case schemas, two independent Exchange OS processes and twelve concurrent HTTP POST requests for each of the five existing routes. Every exact request returns HTTP 201 with byte-identical persisted cancelled-effect JSON. Both processes stop; a third process recovers the same effect. Changed same-key intent and foreign-owner signatures return 409; fresh expired intent returns 403. Complete durable state remains unchanged, including fees and audit; available native test-asset balance remains 2*AmountScale and reserved balance zero. Both users' ledgers reconcile.

Focused child process IDs (two concurrent processes / restarted process): conditional 43263/43265/43304; OCO 43422/43424/43490; TWAP 43523/43525/43583; Scale 43588/43590/43694; Iceberg 43732/43734/43788.

Commands executed with the local `YNX_EXCHANGE_POSTGRES_TEST_URL` configured:

```sh
go test -race ./internal/exchangeproduct -run 'Test(ExistingAdvancedCreationReplay|PostgreSQLAdvancedDeadMan)' -count=1 -v
go test -race ./internal/exchangeproduct -count=1
```

Focused combined suite: PASS 20.253s. Complete Exchange race suite: PASS 67.883s. `gofmt` and `git diff --check`: PASS. After tests, zero `ynx_exchange_qa_%` schemas remained. The owned QA cluster was stopped normally and retained, not deleted.

## Publication boundary and continuation

Native signing and the existing controlled Gateway are local test fixtures, not canonical Web business-write or real Wallet approvals. Public deployment, installer, testnet chain transactions, Product Session v2 business-write acceptance and ComputerControl evidence remain unproved. A remains the sole shared/Host/formal publisher. The current Web write producer/role/mount dependency and compatible whole-product release must be completed there; this checkpoint must not widen browser permissions or pretend public trading succeeds.

Submit this ordinary owner-source recovery together with the preserved Finance/Exchange/Quant checkpoints to the active `接续测试网生态审计工作` coordination thread. Continue existing user journeys and account/recovery boundaries; do not restart the project or discard earlier red evidence.

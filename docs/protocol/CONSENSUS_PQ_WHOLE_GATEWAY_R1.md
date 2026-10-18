# Whole transfer gateway R1 — source checkpoint

This checkpoint adds a bounded HTTP transport and read model to the existing BFT gateway. It does not change Comet limits, the public authoritative producer, Product App Gateway, chain transaction execution, Wallet signing, or frozen Whole protocol bytes. The earlier ingress audit remains a historical source analysis: `CONSENSUS_PQ_WHOLE_INGRESS_R1.md`.

All new Go sources in this checkpoint are **uncompiled and unexecuted locally**. `gofmt` and `git diff --check` are formatting/static evidence only. The tests below contain actual dual signing, source registration/migration and actual ABCI execution behind a mocked Comet HTTP transport; even a later test PASS would not be a live Comet node, public deployment, light-client verification or end-user acceptance.

## HTTP contract

- `POST /transactions/pq/batches/broadcast`: `application/octet-stream`, exact original Whole bytes. Raw body limit 297,196 bytes; canonical `pq_whole` JSON envelope limit 594,436. The only write is one JSON-RPC `POST /` to configured private Comet, with base64 transaction bytes, method `broadcast_tx_commit`, id 1. JSON-RPC body limit 792,658. Redirects are disabled for this write. There is no retry, replacement signature, member replay or hidden fallback to classic signatures.
- `GET /transactions/pq/wholes/{originalABCIHash}`: read the original `/tx?hash=...&prove=true` and immutable `/pq-batches/{batchHash}`. UNKNOWN on missing/index-lag/network/malformed/inconsistent evidence. This read never broadcasts. The caller must retain its original wire and identities before submitting; the gateway introduces no separate durable outbox.
- `GET /transactions/pq/batches/{batchHash}`: immutable shared proof query. Target proofs require matching original Comet execution. Imported source proofs have `status=source_import`, `provenance=imported-authoritative-source`, original source height and results, no invented ABCI hash or index, and `committed=false` (not a Comet commitment claim).
- Existing `GET /txs/{hash}` returns a typed Whole container when the hash is the actual outer transaction hash. Native member hashes are not Comet transaction lookup keys.

`PQWholeView` keeps the actual ABCI hash, original Whole hash, execution height, actual Comet index, per-index native outcomes/hashes, original bytes on direct readback, and a readback URL separate. A committed proof authenticates both signatures and both complete message trees through the standard verifier against `/account-policy` at the original execution height. The submitter's keys never define trust. Full state policy validation and `TrustedRegistration` handle historical revocation/rotation. The gateway does not reconstruct or mutate an account ledger.

A successful container requires code zero, exact outer-payload hash, positive matching execution height, canonical exact ExecTx.Data, ordered member results, exact admitted native hashes and original proof bytes/results, and historical dual verification. Each admitted member must decode as a canonical native transfer for chain 6423, trusted owner/network and fee 1. `feeYNXT` is the sum of admitted member fees, never outer `gas_used=1`; unknown/rejected responses omit the fee field. A partial commit remains committed with its rejected members permanently listed. Readback never tries those rejected indices again. All-rejected CheckTx preserves the real per-index result Data but reports rejection, without manufacturing a stored proof.

Transport failures after submission, response identity/hash/height/Data mismatch and incomplete readback return HTTP 202, `status=unknown`, `committed=false`, original outer and batch hashes and the readback URL. A malformed response cannot prove rejection. Actual CheckTx rejection is HTTP 422. An indexed failed outer transaction is also a rejection rather than successful native effects. Ordinary client-request validation is HTTP 400/413/415 before any Comet write.

## Mixed blocks and history

The ordinary `transactions` array remains ordinary `chain.Transaction` objects. Added `pqBatches` contains one typed Whole per actual outer transaction. `transactionOrder` preserves actual outer hash/type/height/index; block `cometTransactionCount` and history `total` count Comet transactions, not native members. Shared raw Whole bytes are omitted from block/history containers and returned via the original-hash readback route, avoiding repeated raw-proof output.

Single `pq_transfer`, `account_migration` and `account_revocation` envelopes already execute in ABCI but do not yet have gateway native-effect projections. They are explicitly retained in `unmappedTransactions` and actual order, with `unsupportedProjection`, canonical outer hash/type/height/index only. A page containing them remains readable; no fee, native hash, signature authority or successful receipt is invented. Their direct `/txs` view is the same explicit unsupported reference. Invalid canonical framing or contradictory evidence still fails the read rather than hiding corruption.

The EVM endpoint rejects Whole as a native batch container with unsupported Ethereum transaction/receipt projection. It also explicitly rejects other native PQ envelopes. It does not emit synthetic gas=fee receipts, RLP identities, multiple fake Comet indexes, or substitute a member hash for the outer hash. Existing ordinary EVM behavior remains unchanged.

## Read budgets

All response readers use max+1 and an explicit overflow error, including bodies whose first bytes form valid JSON followed by whitespace. Generic RPC reads remain 4 MiB. Full `/block` and `/block_results` reads have a dedicated 32 MiB budget, derived for the current default 22,020,096-byte raw Comet block and base64/JSON framing. No consensus cap is changed.

Search uses the requested row count (bounded by the existing API limit 100), with 2 MiB per row plus 64 KiB. A current <=1 MiB outer mempool transaction expands below 1.4 MiB base64; Whole result messages are bounded and fit the remaining row allowance. A 25-row search therefore has a 50 MiB + 64 KiB budget; 100 rows can allocate up to 200 MiB + 64 KiB. This is explicit, operation-specific memory cost, not a performance claim. A future streaming or small upstream-page implementation can reduce peak memory; this checkpoint prioritizes preserving existing page semantics and rejects overflow explicitly. Account/policy/proof queries retain the generic limit and may return a visible limit error as history grows.

Whole submission confirmation reads the individual indexed transaction and shared proof, not the entire block. It returns no invented block hash and therefore does not need `/header`. Its evidence is from configured trusted Comet RPC; requesting `prove=true` is not cryptographic verification of the returned Comet proof or validator set. Production proxy/body/timeouts, live-node mempool submission and public routing remain independent gates.

## Tests prepared for Root's remote CI

`pq_whole_test.go` uses actual persistent Devnet faucet/registration, valid classic authorization for the migration, real ML-DSA-87 + SLH-DSA-SHA2-256f Whole signatures, actual source migration into `consensus.NewPersistentApplication`, and real CheckTx/FinalizeBlock/Commit/Query. Only the Comet HTTP transport is mocked.

- Actual JSON-RPC POST and exact base64/canonical envelope/body size; no GET broadcast.
- Actual partial admitted/rejected/admitted/rejected outcome, fees 2, underlying balance/nonce/bandwidth and amount-only lot deltas; original hash and native member hash separation; original-hash/batch-hash lookups do not resend.
- Actual connection loss after commit, HTTP 504, wrong JSON-RPC id/hash/height, missing Data and 307 redirect. Ambiguous cases remain UNKNOWN; original committed effects reconcile by GET; redirect never replays.
- Independent signature A and B corruption rejected by real ABCI. An authentic all-rejected batch preserves rejection Data and creates no indexed commit.
- Mutated readback payload hash/height/Data/member hash/rejection reason/duplicate JSON field and original proof are never reported committed.
- Real signing for N=1/16/64/1024 checks fixed canonical wire sizes; N1024 is actually submitted over HTTP to the mock driving ABCI, with 49 admitted and remaining rejected given its funded account. One byte above the body bound and trailing wire bytes cannot reach Comet.
- Imported source proof retains its own original height/results and receives no target Comet identity.

`pq_projection_test.go` builds an actual committed block containing a classic transfer, a separately signed native PQ member and six independently signed N1024 Wholes. The RPC payload exceeds 4 MiB. It checks one ordinary transaction + one explicitly unsupported native PQ reference + six Whole containers, exactly eight actual outer indexes, per-container results/fees, compact proof output, intact mixed history and adjacent classic lookup. Actual EVM HTTP calls reject the Whole container. Dedicated response-reader tests prove max+1 overflow rejection and separate large block read allowance.

Remote commands for the owner after a fixed commit:

```sh
go test ./internal/bftgateway -run 'TestGateway(PQ|CometRead)' -count=1
go test ./internal/bftgateway -count=1
go test ./internal/consensus -count=1
```

Existing full gateway/consensus CI prerequisites still apply. No local Go invocation, service, benchmark, deployment, stage or commit was performed by this owner.

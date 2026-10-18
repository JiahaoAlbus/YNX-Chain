# Existing client supply measurement and PQ receipt deduplication

The four-node client already verifies weighted CometBFT commits against its
isolated genesis validator set, per-transaction Merkle proofs and independent
local persisted fee/nonce state. PQ batch receipt parsing does not provide those
proofs. A durable PQ receipt remains a server checkpoint claim.

## Source changes

`readySenderStats.supply` now reports controller-owned sums from actual ready-pool
operations, including failed calls:

- `signAttempts` / `signNs`: successor `consensus.NewSignedTransfer` calls.
  This includes transaction construction inside that API, not only crypto CPU.
- `encodeAttempts` / `encodeNs`: successor signed-transaction encoding calls.
- `signedSuccessors`: successful signing plus encoding, not submitted or executed
  business transactions. Initial fixture signatures were created before the run
  and are excluded from these three fields.
- `journalSetupNs`: creation and synchronization of the signed-intent journal.
- `journalAppendAttempts` / `journalAppendNs`: complete wave JSON encoding,
  write and Sync, including failed attempts. These are not pure disk-write times.
- `journalDurableEnvelopes` / `journalDurableBytes`: only successfully synchronized
  wave records/bytes; header bytes are excluded. Failed/partial writes remain
  uncertain and do not enter these success counters.

Counters do not alter timing-window boundaries, nonce advancement, quarantine,
submission, consensus checks or durable journaling. They measure the existing
secp256k1 load client; they do not measure PQ signing. Supply totals are not
converted into capacity estimates. The existing report embeds readySenderStats,
so the fields accompany the actual run without a separate collector.

`createPQReceiptCounter(maxMembers)` extends the existing receipt parser with
run-scoped exact member-hash sets, capped by an explicit caller bound. No eviction
or approximate filter is used. Malformed receipts or capacity exhaustion fail
before any cumulative mutation. Only admitted identities occupy the bound.
Repeated original responses cannot double count even when `replayed=false`.
Uncertain observations may later become durable. A first observed durable replay
counts as an observed durable identity, but never as new execution. BFT counts
and actual inclusion remain null. This parser helper is not yet a PQ network
transport or connected to the legacy CometBFT client.

## Verification and remaining gate

Actual parser RED: six old tests passed and three new deduplication tests failed
because the run-scoped counter was absent. After implementation and an additional
capacity-retention control, all ten parser tests and three unchanged paired
recipe tests pass. Fixtures are unsigned parser inputs, not real business proof.

The existing Go test that executes six signed transfers and validates persistent
restart now checks three successor signatures and six synchronized intent
records, in full-history and reused-slot modes. Another focused test asserts
that an UNKNOWN predecessor does not produce a signature or mutate pending
identity. These Go changes have been formatted, but have NOT been compiled/run
in this stage pending a Root-scheduled local Go slot.

Requested bounded validation (not execution authority):

```sh
GOMAXPROCS=1 GOGC=50 GOMEMLIMIT=384MiB go test -p 1 \
  ./cmd/ynx-consensus-perf-client \
  -run '^(TestReadySenderFastAccountAdvancesBeforeSlowPeer|TestReadySupplyRejectsUnknownBeforeSigning)$' \
  -count=1 -timeout=30s
node --test scripts/loadtest/pq-batch-receipt.test.mjs scripts/loadtest/pq-paired-recipe.test.mjs
```

Go would need its normal owned-process guard, <=512MiB sampled RSS and fresh
scratch limits. The tests start no network nodes. A compilation may need a larger
scratch estimate than test data; the guard must admit actual capacity first.
No Go process, new N case or four-node window was started for this change.

## Production measurement contract requested through Root

Retain batchHash/wireHash, decimal executionHeight, original member index/hash,
original per-member outcomes, request status/replay and UNKNOWN identity. The
production owner should expose monotonic durationNs, attempts/completions/errors
for Whole verification, member execution, snapshot encoding and each durable
write boundary. A failed or uncertain write cannot claim completed durability.
The owner chooses the smallest API on the current production implementation;
this client must consume it without adding a second execution/persistence engine.

Actual network finality additionally needs the production chain's applicable
consensus evidence. The existing CometBFT verifier contract is at
`main.go:verifyBlockConfirmation` and `verifyTransactionInclusion`; local business
readback is in `durability.go` and publication gates in `verifiedBusinessInclusion`.
A producer receipt cannot fill those fields by assertion. Source changes alone
have no new TPS or network latency result.

Root subsequently granted exactly this two-function local Go validation with
512MiB owned RSS, 32MiB scratch and 30s test deadline. One fresh native admission
sample read `kern.memorystatus_vm_pressure_level` dispatchLevel=2. The existing
normal gate requires 1 and refused before any Go process. No repeated admission
loop or substituted runtime was used. The raw receipt is
`evidence/client-supply-go-admission-20261018.json`. Go compilation and execution
remain unverified; next scheduling must use a fresh actual resource window.

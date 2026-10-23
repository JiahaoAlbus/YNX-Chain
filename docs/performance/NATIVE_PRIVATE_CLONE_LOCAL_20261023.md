# Native private state copying: measured local candidate

The four-node pair 39964428468 measured 27 repeated private JSON reconstructions
costing 1.291 seconds cumulatively in prefix replay. This source candidate adds
`NewBlockJournalNativeClonePrefixDecoder`, explicitly selected by its caller.
The existing constructor, writer, full replay and runtime client defaults remain
the original control. No four-node measurement has run on this candidate yet.
Source commit: 43b769ca36960d764d95b74bb25f6b7eba9cd097;
internal tree: 5ce0d984ba9bdad226e10dc598747db0befe68b1.

Each newly certified prefix still undergoes strict canonical JSON decoding once.
An independent native snapshot is retained only for accounts and fee events.
Subsequent reads deeply copy account lots and fee records, preserve nil/empty
slice identity, remove shared empty-slice append capacity, verify the original
canonical payload hash and cached identity, and run the original full Validate.
Any populated other domain uses the original strict JSON path. Whole-schema
eligibility rejects newly introduced mutable fields without an explicit copier.
Failed validation or a changed certificate returns an error, not a fallback that
hides corruption. Caller mutations cannot change later snapshots.

The additional retained snapshot increases decoder memory. The original 16 MiB
canonical byte bound is not a bound on total decoded memory. Fresh runtime RSS
admission and measured peak memory are required before a network qualification.

## Real retained input, same conditions

Offline original four-store reader ABBA, Apple M4/10 logical CPUs, darwin/arm64,
GOMAXPROCS=1, GOGC=100, GOMEMLIMIT=160MiB. Each case reads the same eight original
journal prefixes across four stores: 32 snapshot validations, 24 observations of
the same original transaction, 2048 original mathematical native signature
verifications and exactly 2048 replayed inputs. All original prefix snapshot
hashes match the control, including the original final network state hash.
These observations are not newly submitted business transactions or network TPS.

| Order | Mode | Whole wall ms | User CPU ms | System CPU ms | Allocated bytes |
|---|---|---:|---:|---:|---:|
| 1 | Original prefix | 937.770458 | 893.520 | 29.735 | 671193376 |
| 2 | Native copy | 774.707459 | 736.147 | 28.241 | 549725264 |
| 3 | Native copy | 771.421792 | 726.985 | 26.703 | 549725704 |
| 4 | Original prefix | 936.093125 | 889.044 | 30.220 | 671192808 |

Two-sample means: whole wall -17.490%, user CPU -17.920%, cumulative allocation
-18.097%. This includes publication cost, retained-certificate bookkeeping and
fixture reads/writes. Allocation totals are not retained heap or peak RSS.
Only two samples per mode were collected, so no sustained or network improvement
is inferred.

## Work removed and work retained

Every sample has 31 prefix reuses and 31 private full validations. Control:
31 private JSON parses take 292.611/297.117 ms. Candidate: zero private JSON parses
on reuses; 31 native copies take 27.035/27.915 ms. Full private validation remains
117.263/115.757 ms in candidate versus 116.900/113.831 ms in control.

There is a measured tradeoff: eight certificate publications cost
102.309/94.728 ms in candidate versus 4.305/4.813 ms in control because newly
certified snapshots still receive one canonical JSON decode and private copy.
The total ABBA result includes this increase. First replay, suffix replay,
canonical output and all signature/fee/nonce/business checks remain exercised.

## Focused checks and retained failure

The same signed hot-reuse test, using an overlay that selects the old constructor,
fails with `hot reuse still decoded canonical JSON: calls=1 ns=59291`.
That is a concrete copying-cost difference, not a claim that the old behavior is
incorrect. The original RED test and overlay are retained unchanged.

Focused candidate checks cover all populated unsupported domains, nil/empty
identity, account lots/fee history isolation, future mutable schema rejection,
signed execution, duplicate nonce and malformed input rejection, canonical
state equality, repeated reads, restart recovery, corrupted retained fee history,
corrupted canonical bytes, and parallel caller mutations. Original prefix
regressions also pass. Tests use the existing `TestBlockJournalPrefix` prefix and
therefore run through the original chain-core CI test step.
Original prefix plus candidate tests passed in 0.920 seconds; final candidate
tests passed, and candidate race checks including concurrent caller mutation
passed in 1.854 seconds. The original offline reader ABBA passed in 4.321 seconds.

Raw logs and overlays are retained under
`artifacts/chain-performance-20261017/abci-drain-window-source/`. The matched
reader probe uses the original fixed journal/migration hashes and original
readback assertions; only the control/candidate constructors and ABBA mode labels
differ from the existing matched reader probe.

```sh
GOMAXPROCS=1 go test -p=1 ./internal/consensus \
  -run '^TestBlockJournalPrefix' -count=1 -timeout=20s
GOMAXPROCS=1 go test -p=1 -race ./internal/consensus \
  -run '^TestBlockJournalPrefixNativeClone' -count=1 -timeout=30s
GOMAXPROCS=1 GOGC=100 GOMEMLIMIT=160MiB \
  YNX_PREFIX_CLIENT_FIXTURE_DIR="$PWD/artifacts/chain-performance-20261017/shared-work-phases-source" \
  go test -p=1 \
  -overlay artifacts/chain-performance-20261017/abci-drain-window-source/native-clone-reader-overlay.json \
  ./cmd/ynx-consensus-perf-client \
  -run '^TestPrefixReplayMatchedOriginalFourStoreOffline$' -count=1 -timeout=20s -v
```

[Machine readout](evidence/native-private-clone-local-20261023-actual.json)
retains original samples, runtime conditions and exact source/raw input hashes.
Its 16432 bytes have SHA256
4f9743eb0fa64e96be9963eae6d339e5904082a3941e48c62d8e14e5eaccaafe.
Next: integrate explicit candidate selection and its strict new phase inventory
into the existing runtime client/controller; then obtain a fresh Root window for
an actual same-condition four-node comparison including extra retained RSS.
The sustained 1000 effective final TPS and queue-inclusive P95≤3s goals remain open.

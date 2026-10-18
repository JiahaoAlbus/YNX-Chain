# Prefix replay client integration and measured regression repair

The prefix candidate is now an explicit client option, `-prefix-durable-replay`,
off by default and exclusive with `-shared-durable-replay`. First scope is paced,
single-round block-scan with observer timings and the original16MiB reader; it
refuses streaming/slot retention/large-reader configurations. Original captures,
read leases, whole-file hashes, transaction signatures, fees/nonce, published Info,
quorum and per-row qualification remain on the original paths.

## Actual work and controlled selection

`durableReadback.prefixReplay` reports calls, successfulFullReplays,
successfulPrefixReuses, failures, duration, completed replayed blocks/input visits
and the16MiB canonical cache bound. Failed partial replay work is not included in
completed counts. A prefix hit is not called a full history replay. Native-fact
stats come from the actual prefix decoder, not an unused full decoder. Snapshot
counter values are independent copies.

The original controller supports `--prefix-replay` only for explicit
`supply-2048x1-data64` grpc/relative/observer timing. Recipe reading starts nothing.
The new workflow boolean `prefix_durable_replay` defaults false and requires those
same parameters before build/node execution. Original32MiB default, selected64MiB
case, RSS/process/thread/log/build/time guards remain unchanged. New selection
requires its own Root contract; no old window is reused.

Controller verifies exclusive actual backend, all2048 original fixture bytes/
hash/nonce/business flags, native verification facts and actual successful-work
counts. Original complete data64 readout remains exactly equal after this change.
The same-VM before/after pair execution route is not implemented by this individual
selector; it must be completed before requesting that comparison window.

## Negative client result was retained and repaired

The original API-only comparison showed reduced repeated execution. That was not
sufficient to establish a client gain: four-store client readback initially
regressed against the existing shared backend. The candidate unnecessarily
revalidated/re-encoded and replaced its certificate even for an unchanged complete
input. A real RED test found replacement of the same immutable certificate.

The exact-input path still hashes current complete prefix bytes, independently
strict-decodes cached state and performs full Validate. With no suffix, it returns
private original canonical bytes; it does not execute an empty suffix, repeat full
Validate or re-encode the same state. It retains the immutable certificate. Changed,
incomplete, extended and rotated input paths keep original suffix/full validation.
Cached-state tamper, caller mutation and cancellation tests remain mandatory.

The RED, pre-fix source overlay, every negative/variable timing sample and corrected
results are retained. No speed threshold was removed to claim success.

## Matched offline client measurements

Original run39164390241 journal, eight complete prefixes, four sequential private
store captures per prefix. Every mode uses new reader/backend instances and the
same original data/prefix order. The same original transaction is observed24 times;
these are not24 new business transactions. Each backend successfully verifies all
2048 original journal signature facts. Full-file capture/hash, native fee/nonce
checks and final canonical state identity remain equal. No RPC, new quorum/
publication proof, new blocks or network TPS is measured.

Local darwin/arm64, Go1.25.7, GOMAXPROCS1, ABBA/two samples per backend:

| Group | Shared wall ms | Prefix wall ms | Interpretation |
| --- | --- | --- | --- |
| Initial candidate | 1010.12 / 1020.74 | 1347.51 / 1347.72 | Regression retained |
| Exact-input repair, uninstrumented CPU | 1059.22 / 1078.26 | 6022.33 / 1987.00 | Large unexplained wall variation retained |
| Reconstructed pre-fix variant, with CPU | 1144.73 / 1199.62 | 2469.16 / 1742.95 | Regression confirmed with process CPU |
| Current candidate, with CPU | 1027.55 / 1034.11 | 910.59 / 901.35 | Small local group, not stable/network proof |

Process user-CPU in the current group: shared990.13/991.94ms versus
prefix870.56/865.84ms; mean991.036→868.196ms (12.40% reduction). Cumulative Go
allocated bytes822253764→671184196 (18.37% reduction), not peak RSS. In that group
wall mean1030.827→905.969ms (12.11%). All groups are retained: the uninstrumented
wall outliers cannot be assigned conclusively to host contention, I/O or algorithm.
No stable wallclock gain is claimed from these few samples.

The pre-fix CPU group had prefix userCPU1560.79/1524.93ms versus shared1076.61/
1129.40ms. Replayed-input counts alone had hidden the extra work. The corrected
prefix path still records1 successful full output and31 prefix outputs, with7
blocks/2048 input visits; original shared records8 full replays/28 blocks/7475
input visits. Both verify2048 unique original signature facts and perform32 fresh
snapshot validations plus24 original fee/nonce transaction checks.

## Focused validation and remaining work

Real signed independent stores/captured hashes, changed input, bad transaction,
state ownership, publication/quorum negative cases and observer/shared compatibility
PASS0.897s. Controller62 tests PASS2.804s. Prefix functional/cache/error tests
PASS0.929s (explicit offline cost test not selected in that command). The original
API-source CI39168672618 at01dda464c completed SUCCESS; that is not a new client
source CI result. Current changes still require their own matching CI.

Next: finish source qualification/CI, then original same-VM/ELF/workload/caps pair
orchestration and separate Root grant. The original full/32MiB defaults remain.
No fresh four-node run, ten-minute capacity or sustained1000 valid finals/s is
proved. Last actual four-node baseline remains332.22/s and offer-to-finalP95
4.388s; client-only offline probes do not replace it.

Source and all raw groups/pins:
`evidence/prefix-client-source-local-actual.json`.
Raw probe/source overlays and original compatibility readout:
`artifacts/chain-performance-20261017/prefix-client-source/`.

Exact current source qualification binds df556b61b7748254e364a9f193c4f599db9ecb71 / internal tree
08fd523362c16a578ae43655c30fce050671103a; internal delta from9cdaeb0a6 is 22597B,
SHA256 8956aa4a464c76f853a70f64206a8e006f8bb79708e9d6016b5108126299b89d. Original frozen diagnostic/anchor
source files and tests stay unchanged and continue running at their fixed sources.

Current source-qualification Make entry passed. Five source checks, including all
original frozen diagnostic/anchor suites, passed9.518s. Original assertions and
fixed-source contracts remain unchanged. No new network window is authorized by
this source-only validation.

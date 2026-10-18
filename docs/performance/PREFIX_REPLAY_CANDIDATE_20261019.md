# Opt-in validated-prefix replay candidate

Previous measured shared production included repeated replay of the same already
validated signed history. This candidate is a separate read-only API;
`DecodeBlockJournal` and `BlockJournalDecoder.Decode` keep their full behavior.
It is not yet wired into the CLI or network controller and changes no node writer,
protocol state version, hash format, signature rules, balances or nonce behavior.

## Source safety and bounded state

`BlockJournalPrefixDecoder` retains one private canonical snapshot of at most
16MiB, a SHA256 digest of exactly its complete original input prefix, complete
byte offset, logical block count and height. Input is explicitly limited to16MiB;
this does not raise existing default or long-reader budgets. Caller still must
capture stable current bytes and independently corroborate published/quorum and
business evidence. Cache bytes never authorize publication or persistence.

Reuse requires hashing that complete prefix from this call's freshly captured
bytes. The prior canonical state is decoded into private mutable state and fully
Validate'd. New suffix frames go through the exact original length/checksum/strict
JSON/before-AppHash/signature/execution/response-hash/Commit/final-state validation.
The original frame loop is moved verbatim into a shared helper; the full path
still enters immediately after its original header and NewApplication checks.
Logical original block counts are retained for the16-block checkpoint limit.

Changed/shorter prefixes and rotation use the original complete Decode. Older
captures cannot replace a newer cache entry. Incomplete tails do not advance
complete bytes or state prematurely. Errors/cancellation publish no new cache
success. Returned JSON/accounts are independent from both cache and other callers.
A context-aware serial gate bounds concurrent cached state reconstruction and
permits cancellation while waiting. Restart drops the in-memory certificate and
must fully replay again. No cache state is persisted or accepted from callers.

## Focused actual validation

Real signed transactions exercise18 blocks across checkpoint rotation, including
duplicate-nonce and malformed-transaction execution results. Every candidate state
matches complete original replay. Unchanged captures re-execute zero blocks;
appends execute only the new block. Original journal restart remains equal.

Counterexamples cover changed header, bad frame checksum, forged response with a
correct frame checksum, incomplete tail, older capture, caller mutation, corrupt
private cache state, cancellation while waiting, input cap and concurrent result
isolation. Original full decoder/fact guards plus abrupt-exit/failed-writer recovery
also pass. Focused command PASS2.782s; raw retained in `prefix-replay-source/`.

The RED baseline adapter explicitly delegates this new API to the original full
Decode. It preserves data correctness but fails the new identical-prefix reuse
contract, exposing repeated work. This is a labeled optimization baseline, not a
claim that a previously existing public prefix API was broken.

## Matched offline original2048 ABBA

Original run39164390241 journal1717048B SHA256
`7c2a5b38bdb057972462068772196e74e4ab5c8564712fea1f54a6e89bee4d0a`
and its pinned original migration. All eight complete prefixes (checkpoint plus
seven blocks) are read in identical order, with new decoders/native-fact caches
per mode. Every reconstructed canonical state digest matches the full baseline;
final digest matches the original network receipt. Each mode successfully verifies
all2048 original signature facts. No RPC/nodes/new business submission or fresh
quorum/published-info proof is involved.

Local darwin/arm64, Go1.25.7, GOMAXPROCS1. Two samples per mode, ABBA:

| Mode | Elapsed ms | Allocated bytes | Replayed blocks | Input visits |
| --- | ---: | ---: | ---: | ---: |
| Full | 636.997 | 367841624 | 28 | 7475 |
| Prefix | 510.174 | 223756264 | 7 | 2048 |
| Prefix | 522.577 | 223755752 | 7 | 2048 |
| Full | 684.552 | 365770984 | 28 | 7475 |

Mean elapsed reduction approximately21.85%; cumulative Go allocated bytes about
39.00%. Allocation is not peak RSS. This small offline comparison is not a Linux
four-node gain, network TPS, latency improvement or ten-minute capacity result.
Original4096-entry/4MiB native-fact limits stay unchanged; long-history fit is unproven.

Next: integrate a separately selected client readback candidate while retaining
correct actual-work counters and original proof gates, then prepare same-condition
before/after evidence under Root scheduling. No runtime activation, new profile or
network window follows from this local result. Sustained1000 valid finals/s and
queue-inclusive finalP95≤3s remain unachieved.

Source/raw pins and all four samples:
`evidence/prefix-replay-source-local-actual.json`.

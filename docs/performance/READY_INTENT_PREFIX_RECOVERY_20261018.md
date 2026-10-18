# Read-only intent-prefix recovery after an interrupted segmented run

The full completed-report gate remains unchanged. Missing, poisoned, mixed or
escaped segment receipts do not become full acceptance. A new separate prefix
diagnostic can identify only complete, consecutively linked waves whose actual
native signatures and nonce/template checks all pass.

The sealed-segment decoder is shared with full readback. A small reader adapts
one captured wave at a time to the existing incremental signature scanner.
Callbacks stage at most 64 envelopes; a whole wave is published to the diagnostic
only after every record passes. A bad later signature discards earlier valid
records from that same wave. A missing, truncated, corrupt, wrong-fixture or
oversize segment ends the prefix. Later files are never used across the gap.
The reader returns captured/validated bytes separately and preserves the last
fully validated file hash. Inventory is read in chunks; current 2,048-input,
32-round and 8MiB limits remain unchanged.

Every diagnostic explicitly has `acknowledgedInventory=false`. Reaching captured
inventory end does not prove workload completion, a returned Sync, submission,
execution or finality. A complete-but-uncertain file can identify possible writes,
never successful acknowledgements. Missing identities are not inferred to be
unsubmitted. No method signs, sends, retries or advances a nonce or writer counter.

## Integration

The stopped partial-window path selects diagnostics only if the original retired
window receipt explicitly says `segmentedIntents=true` and the final segment
receipt is absent or poisoned. A present nonpoisoned full receipt must still pass
its full gate; corrupted acknowledged files cannot silently downgrade. Mixed
legacy/segment evidence and escaped directories are refused.

The existing four-node read-only block signature/replay/fee/nonce reconciliation
remains responsible for any actual durable outcome. Its diagnostic output gains
`intentPrefix` and schema4. Prefix identity recovery does not revise original
ACK/status/latency or partial-run TPS. If missing inputs prevent authenticating
a node's actual block payloads, that full reconciliation still fails closed.
The diagnostic does not reconstruct intended transactions from unexpected blocks.

## Validation status

Go sources are formatted and whitespace checks pass. **These changes have not
been compiled or executed.** Four new Go test sources cover:

- Complete waves and missing/partial/corrupt/invalid-signature/fixture/budget
  boundaries, including no earlier-row leakage from an invalid wave.
- Missing final report and actual complete persistence followed by an uncertain
  return; diagnostics leave bytes, sender nonce and writer counters unchanged.
- Shared sealed decoder's actual raw-file SHA and prefix checks.
- Explicit-plan selection, missing/poisoned receipts and refusal to downgrade a
  corrupted acknowledged receipt or accept mixed/escaped evidence.

These use genuine local fixture signatures and private temporary files when run;
they do not launch network nodes or establish business acceptance. Proposed
focused selectors for a future Root-scheduled normal test step:

```text
TestReadyIntentPrefixRetainsOnlyWholeValidatedWaves
TestReadyIntentPrefixWithoutReportNeverPromotesUnknownToAcknowledged
TestReadyIntentSharedSegmentDecoderRejectsWrongPrefix
TestReadyIntentPartialSelectionRequiresPlanAndNeverDowngradesAcknowledgedCorruption
```

The original fixed27f nine-function and b654 overlay compile deliveries are not
modified or republished by this local source stage. Root confirmed the Protocol
turn ended with a service refusal, not a new CI failure or resource return.
Its queued work is preserved for the original owner's normal recovery; no new
owner, task, CI dispatch or local Go substitutes that stopped turn.

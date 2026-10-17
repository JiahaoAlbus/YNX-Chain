# Complete slot-report terminal history readback

Candidate c68642365 passed focused Go validation (scope below). These changes
complete the bounded successful-window readback implementation, not ten-minute
acceptance, general host recovery, or a new TPS measurement.

Schema12 reports retain only the latest per-account slots in memory. Existing
offline checks must reconstruct the complete original observation list from
the terminal stream before applying their ordinary full-window gates. They
must never equate the latest slot count with lifetime transaction count.

The reader enforces the expected fixture-bound segment chain, seals, exact
record/byte/final-hash receipt, unique global indices, positive completed row
gates and exact signed-payload hash identity. It reconstructs round/index order
without modifying statuses, payloads or recorded latency. The latest report
slots must be byte-identical after JSON encoding to the corresponding original
terminal rows. Missing, poisoned, truncated, changed or incomplete reports fail.

Scope stays bounded at the current 2,048 total transactions and 16 MiB aggregate
terminal bytes. Each read is limited to one bounded segment. Directory inventory
reads at most expected-segment-count plus one (at most33 entries), and rejects
unexpected entries, symlink directories/non-regular segments, escaped receipt
paths and files changed while captured. Relative output paths are recorded as
absolute when the stream is created, so a later reader in another working
directory can find the original evidence. No file is repaired, overwritten,
truncated, deleted, retried or resubmitted.

This reconstructs **reported observations**, not independent proof of execution.
The stopped-window replay still authenticates actual signed blocks and replays
actual inputs to an exact durable-state match. The account check still verifies
nonce, balances and fee history. Their original complete-window requirements
remain; the account check additionally requires a clean completed/retired window
receipt. Signature, nonce, fee and state verification remain at their existing
independent gates. The stream hash chain is not a signature or consensus proof.

Focused Go coverage passed (under TestTerminalStream / TestReadySender):

- restore all 96 original signed identities from the three-slot /32-cycle
  controller test, rather than only its last three results;
- restore a complete schema12 report while preserving every original terminal
  status and confirmation timestamp;
- reject receipt substitution, changed latest slots, directory substitution and
  symlinks without touching original bytes;
- reject a truncated tail without repairing or removing it;
- read a relative-output stream after a real working-directory change.

These fixtures contain real local signatures and explicit synthetic observation
flags; they are not four-node business-throughput evidence. Existing stopped
network tests remain explicit-env operations; no old window was rerun or its
exclusive output file replaced during this source work.

Partial slot-report reconciliation is intentionally still refused by the old
partial-window tool. Its latest slots are not full history. A future sealed-prefix
reader must distinguish reported terminal rows, buffered/uncertain terminal
outcomes, and original signed intents, then reconcile actual durable nodes
without changing any UNKNOWN or fabricating ACK/latency. The signed-intent
journal remains the recovery authority; no automatic resume is introduced.

Next: pin this candidate for Root's scheduled Go regression after native normal
memory pressure, then add partial-prefix reconciliation and run the actual
bounded network comparison before extending duration or claiming stable TPS.

## Focused Go validation actually completed

Candidate c68642365 passed the exact scheduled selector TestTerminalStream|TestReadySender. Go reported 2.144 s; the complete compiler/test/controller window was 6,867 ms with sampled owned/control peak398,671,872 bytes (<400MiB419,430,400). All13 valid native samples had pressure level1, firstCause was null, Go exited0 and original process groups were independently absent. No four-node run occurred. Full-package/race, standalone loadmetrics package tests (including600k/zero-allocation controls), and explicit-env stopped-network tests were not run.

[Original receipt, independent cleanup and source/binary hashes](evidence/ready-slots-focused-pass-20261018.json) preserve the exact scope. The selected fixtures validate local signature/execution/persistence/restart and bounded-controller/readback logic; synthetic observation flags remain unit inputs, not real BFT proof. Schema12 CLI has not completed a real four-node journey yet.

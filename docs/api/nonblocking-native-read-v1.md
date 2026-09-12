# Native RPC reads during local checkpoints

The native fee switch is an atomic runtime flag. Fixed chain, fee, Faucet model,
and durability model queries do not acquire the ledger lock or fetch the tip.

Balance display, transaction lookup, and transaction durability/receipt reads
try the current ledger read lock first. If a writer is busy and a completed
local checkpoint exists, they use its immutable account and transaction views.
These views are deep copies and are published only after snapshot and integrity
marker fsync completes. A retained checkpoint contains only transaction records
whose exact fingerprint, inclusion and fees remain in the replacement history.
Its balance view remains the previously completed checkpoint's account state.

Consequently, a concurrent write may temporarily return the preceding durable
balance or transaction inclusion. It cannot expose newly staged funds or attest
an unpersisted transaction. The receipt's existing checkpoint height/hash and
snapshot integrity identify its local persistence boundary; consensus finality
remains false. When no valid checkpoint view exists, the normal locked read is used. During a write, an admission absent from the previous checkpoint
can return not_found; clients keep polling the original hash after ambiguous
submission and do not create a new transaction.

Nonce allocation and mutation validation always use current locked state.
The atomic `/v1/native-snapshot` contract remains a current complete observation
under a single read lock. This change does not alter the disk format, acknowledgement
boundary, transaction identities, or legacy four-field `ynxNativeTransaction`.

Checkpoint files now omit presentation whitespace. Both old indented snapshots
and new compact snapshots decode to the same versioned state and use the same
canonical integrity algorithm. File byte hashes and sizes change; account,
transaction, block and module values do not. Temporary-file fsync, atomic rename,
directory fsync and integrity marker ordering remain unchanged.

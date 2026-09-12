# Native migration archive v2

`ynx-consensus-migration-bundle -source-snapshot <private-frozen-v2-json>
-output <new-private-directory>` reads an integrity-sealed native snapshot and
creates `native-origin.json` followed by `migration.json`. It does not start a
node or change the input. The output directory must not exist. Both files are
private and durably written; an incomplete export fails recovery.

All 38 native ledger and operational fields, including every block, transaction,
lot and product record, remain in the immutable origin file. Only snapshot
`SavedAt` is normalized to the committed tip time and the snapshot seal is
recomputed, making repeated exports from the same frozen source deterministic.
Pending admissions must be drained before export because native admission has
already changed balances. Export never labels those balances as belonging to
the older committed tip.

Migration version 2 uses source format `ynx-devnet-state-v2` and adds
`sourceArchiveRoot` to its hash-bound document. Version 1 retains its original
encoding/hash and remains a partial bootstrap format. Loading v2 validates the
origin integrity/history and reconciles the executable accounts, balances,
nonces, validators, DEX, resource policy and tip to the anchor. Validator public
key bindings may be added while preserving the original identities and powers.

Run ABCI with `-migration-state migration.json -native-origin native-origin.json
-state <mutable-state-path>`. Starting v2 without the matching verified origin is
an error. The application retains the origin once in memory and on disk; mutable
ABCI checkpoints contain its migration hash, not another copy of all historical
blocks. Cold recovery requires both the mutable state and the immutable origin.

ABCI queries `/native-origin/<module>/<id>` return original keyed native records.
`/native-origin/transactions/<hash>` uses an index built during origin load and
returns the original transaction, block height/hash and transaction index. A
hash duplicated across historical locations is reported as ambiguous, never
silently selected. Native source fields keep their original integer encoding;
consumers need lossless integer parsing.

The response contains `sourceArchiveRoot`, `module`, `id`, `recordHash`, `record`
and `signatureProvenance`. `recordHash` is SHA-256 of compact ordered JSON with
keys `domain`, `sourceArchiveRoot`, `module`, `id`, `record`, where domain is
`YNX_NATIVE_ORIGIN_RECORD_V1`. It binds a record reference to the locally validated
archive; it is not a standalone Merkle proof or an invented historical BFT
signature. Transaction IDs are normalized to lowercase `0x` plus 64 hex digits.

Preservation and active execution adapters are separate. Original unsigned Pay
records remain original records; they are not silently turned into signed BFT
Pay intents. A historical merchant string is not a signing identity, and native
records without payout addresses remain unbound. Explicit continuation actions
must bind new prospective authority with real evidence before mutating such
records. Full General EVM, complete continuation adapters and four-validator
same-ledger cutover remain implementation/validation requirements. The export
CLI truthfully reports `legacyExecutionAdaptersComplete: false` and performs no
production cutover.

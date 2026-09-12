# Recovered BFT application state v15

This candidate combines the existing AA, strategy mandates/vaults, staking,
solvency, snapshot and bounded Ethereum implementation from
`3a49306956eef0f5933714760f4cc34a7f93c584` with the Pay settlement, native transfer
and native DEX work in `d4857f24735cccc23f2034c110f966ad99273e2f`.
Application version is 20; committed state version is 15. It is an offline
compatibility candidate, not the currently running native Testnet ledger.

The state union retains all 55 top-level fields. Both execution-state clone
paths preserve native transfer receipts and Pay settlements, including across
multiple actions in the same proposed/finalized block. Native DEX migration
initialization and lot provenance remain intact.

`state_legacy.go` freezes the two original hash-document layouts, including JSON
field order and tags. Earlier full-lineage versions 7–13 and native-lineage
versions 8, 13 and 14 are authenticated against their original layout. Overlapping
version numbers are not assumed to identify a layout. A nonempty collection
excluded from a layout makes that layout ineligible. The decoder rejects unknown
fields and trailing documents. Upgrade changes only version and hash; it never
clears fees, DEX records or other collections. Empty-block states may retain the
original migration anchor, subject to exact migration accounts/DEX and no other
application records. All upgraded states pass current structural, supply,
provenance and hash validation before loading.

Validation includes both legacy lineages with a real executed transfer and fee,
nonce/balance/history preservation, v15 save/restart, unbound cross-lineage field
rejection, unknown-module rejection, Pay transfer-backed settlement/refund,
restored AA/staking/solvency and gateway/bundler suites. The bounded contract
fixture reused for tests has byte-identical Solidity source; it is not a release
artifact or proof of general EVM execution.

No consensus cutover is authorized by this format alone. The existing native
migration v1 still lacks complete native module/history/pending mapping. That
mapping, same-ledger reconciliation and four-validator continuity must be proved
before replacing the running native chain. The recovered Ethereum implementation
supports value-transfer envelope types and bounded contract behavior; arbitrary
EVM creation/calldata remains an implementation requirement.

# Offline execution-state preflight

This is a read-only release prerequisite. It inventories the complete frozen JSON
schema, verifies the checks described below, and reports `compatible` or `blocked`.
It never creates migrated state. **`migrationSafe` is always `false`.** The default
target `vnext` always blocks because this candidate has no canonical vNext schema,
full execution replay, or lossless cross-family conversion.

## Frozen source families

| Family | Exact schema source commit | Root fields | Reachable types |
| --- | --- | ---: | ---: |
| `native-baseline-v2` | `be9f03833ac3a7579bd96f22f6bf49f3d8dccc7b` | 40 | 97 |
| `native-a-v1` | `089265843926a4890a04f7ba4468491510defc80` | 40 | 97 |
| `native-a-v2` | `089265843926a4890a04f7ba4468491510defc80` | 40 | 97 |
| `abci-a-v14` | `089265843926a4890a04f7ba4468491510defc80` | 47 | 122 |
| `abci-c-v13` | `3a49306956eef0f5933714760f4cc34a7f93c584` | 53 | 141 |

A is the native repair lineage, including `96e1ede...`; the change from `96e1ede`
to `0892658` changes API authorization, not the chain/consensus schema. C is the
Core recovery lineage. C v13 contains `strategyMandates`, `strategyVaults`,
`assetAuditEvents`, `smartAccounts`, `paymasters`, `userOperationEvents`,
`stakeDelegations`, and `unbondings`, absent from A v14. A adds `nativeTransfers`
and `paySettlements`. Version order does not establish schema compatibility.

`native-baseline-v2` pins the separately observed public be9 baseline. Its native
reachable schema equals A's, but its runtime admission/persistence semantics
differ. Schema equality never relabels a snapshot's actual source as A. The newer
`0892658`/`1db7335` candidates were not public-runtime evidence when this catalog
was frozen. Capture the actual source identity for each input.

`native-a-v1` describes legacy version 1 against this exact A type graph. It does
not authorize arbitrary historical v1 schemas; legacy integrity is unavailable
and v1 always blocks. Any additional source commit must undergo explicit catalog
and semantic review. A caller cannot select a new commit merely by changing a flag.

`catalog.json` freezes every reachable struct field, order, type, pointer, map,
slice and `omitempty` tag, including the separate ABCI hash document. The generator
reads immutable Git objects; it does not read the current dirty source files.

## Run

From the repository root, build the CLI:

```sh
go build -o /tmp/ynx-execution-migration-audit ./cmd/ynx-execution-migration-audit
/tmp/ynx-execution-migration-audit \
  -input /secure/captured/devnet-state.json \
  -marker /secure/captured/devnet-state.integrity-version \
  -source-family native-a-v2 \
  -source-commit 089265843926a4890a04f7ba4468491510defc80 \
  -sha256 RECORDED_64_HEX_BYTE_SHA256 \
  -committed-height RECORDED_DECIMAL_HEIGHT \
  -committed-hash RECORDED_NATIVE_BLOCK_HASH \
  -durability unknown \
  -target-family vnext
```

Replace placeholders with independently captured metadata, not values invented to
obtain a passing result. Preserve every node's identity and capture time separately;
snapshots copied from different nodes at different times are not one shared anchor.
The native marker is the captured `devnet-state.integrity-version` bytes (`2\n`),
not a newly manufactured file. ABCI inputs omit the marker and declare their AppHash.
Optional `-reference /secure/captured/reference.json` compares full content against
a same-family reference. It does not authenticate that reference.

Only regular files are accepted. Full JSON parsing defaults to 256 MiB, the marker
is limited to 16 bytes, and JSON nesting to 128. `-max-parse-mib` permits an explicit
1–1024 MiB input budget. It is not a bound on resident memory: strict parsed data,
typed hash reconstruction and canonicalization can keep multiple representations
in memory, so a larger budget requires independently available resources.

When the input exceeds the parsing budget, the CLI streams the **entire file to
EOF** through SHA-256 with a bounded buffer. It returns exit 2, `blocked`, scope
`whole-file-byte-digest-only`, the exact observed byte count, and all expected
source modules in `unverifiedModules`. No schema, marker, height, reference,
embedded integrity or asset check is claimed. A large reference cannot be
substituted for this proof; references must fit the selected parsing budget.

The CLI only opens inputs for reading
and emits JSON to stdout. It has no network, output-file, signing, migration, repair,
or deployment option. Never redirect stdout onto an input or evidence file.

Exit codes: `0` means compatible **within the limited offline scope**, `2` means
blocked, `1` means invalid CLI arguments or an input/output error. Selecting the
same native family may give `compatible` for a minimal reconciled fixture. That
result is not a release gate or migration approval.

## What is verified

- Strict parsing rejects duplicate keys, unknown fields at any structured depth,
  missing required fields, wrong types, non-integer amounts/nonces, exponent or
  quoted integer representations, signed/unsigned overflow and trailing JSON.
  Opaque payloads remain content-inventoried and block semantic acceptance when
  their module is populated.
- Input SHA-256 is compared to the declared digest. A separate canonical hash
  ignores object ordering/whitespace without ignoring list order, field presence,
  nulls or numeric content. Each root module receives its own full-content hash;
  count equality alone never establishes equality.
- Native v2 integrity is reconstructed from the frozen typed serialization, field
  order and domain. ABCI uses its actual separate hash document/domain. Embedded
  integrity is consistency evidence, not a trusted signature.
- Native block heights, parent/genesis identity and non-genesis block preimages
  are checked. Transactions are checked for duplicate hashes, block identity and
  observed nonce continuity. Missing account nonce history blocks. Pending state
  always blocks because it can already affect accounts at an older committed H.
- Account address aliases, nonnegative balances/staking/resource usage, lot
  references and lot metadata are checked. Lot-versus-liquid differences are
  reported without minting lots, normalizing balances or changing source hashes.
- Native policy hash/constraints and basic validator identity/power are checked.
  Readiness flags cannot prove a quorum or four-validator CometBFT finality.
- Every non-native asset is reconciled exactly: all `dexBalances[asset][account]`
  plus each corresponding pool `reserve0`/`reserve1`, against its `totalSupply`.
  LP shares are claims on reserves and are not added again. Native lots are
  provenance backing and are not additional supply. Current A stores no separate
  DEX custody balance. Unknown or future custody modules require explicit review.
  Per-asset results contain a hashed asset identifier, decimals, account and pool
  totals, declared supply and an exact signed difference. A 50-unit excess blocks;
  historical DEX events lack recipient/full signed action evidence, so this tool
  cannot attribute or automatically reverse it.
- All aggregation uses `big.Int`; individual fields still obey their frozen Go
  ranges. Native YNXT stored whole units map exactly to wei with `10^18` for
  reporting only. Non-native asset amounts retain their own unit/decimals. `YNXT`
  is the exact native DEX identifier; `dexBalances["YNXT"]` would duplicate the
  account ledger and blocks. ABCI unit mapping is unresolved and blocks.

## Explicit evidence limits

`declared` holds operator-supplied source family/commit, digest, height/hash and
durability. `verified` describes only independently performed checks on supplied
bytes. `sourceCommitProven`, `durabilityProven` and `committedStateBindingProven`
are always false. A matching declared hash or `-durability confirmed` cannot change
these fields. `markerVerified` only means exact marker bytes were observed.

ABCI AppHash excludes height. Native block hashes include transaction count rather
than transaction content. Full execution replay, Ethereum raw signatures and the
native/Ethereum nonce mapping are not verified here; any populated transaction
history therefore blocks execution acceptance. Arbitrary resealed snapshots do
not authenticate account state, provenance, finality or a migration checkpoint.

DEX supply arithmetic is necessary but not sufficient. Its events/audit bindings
and all other populated business modules without complete invariant checkers emit
`MODULE_INVARIANTS_UNVERIFIED`. The source is preserved as input; a module hash is
not a replacement copy of its contents. ABCI also lacks a supplied/verified
migration anchor. Full target mappings, AA/vault/paymaster/locked funds,
history/raw indexes, persistence evidence, replay and activation/rollback evidence
remain release prerequisites. No amount shown here is a verified global supply.

The report never echoes account addresses, raw transactions, contract payloads,
unexpected JSON keys/values or input paths. It includes aggregate amounts, hashes,
fixed schema module names and caller declarations. Treat those metadata as local
audit evidence; do not place secrets in CLI metadata arguments.

## Reproduce validation

```sh
go test -race ./internal/executionstate ./cmd/ynx-execution-migration-audit -count=1
go run ./internal/executionstate/gencatalog > /tmp/ynx-state-catalog-check.json
cmp internal/executionstate/catalog.json /tmp/ynx-state-catalog-check.json
```

Regression fixtures cover real source serialization, an actual in-memory pending
transfer changing balance/nonce at old height, missing/downgraded markers, missing
or unknown modules, duplicate keys, integer boundaries, alias conflicts, policy,
nonce/block tampering, ABCI height excluded from AppHash, cross-family module loss,
same-count changed contents, non-native decimals and DEX self-transfer inflation.
The CLI test checks input bytes, modification time, permissions and directory
contents remain unchanged. It also confirms an oversized file is hashed fully
without claiming schema/module verification. Fixtures create no public requests
or signatures.

On this macOS host, a 33,554,446-byte synthetic regular JSON file run with a 1 MiB
parsing budget used 6,520,832 bytes maximum resident memory (`/usr/bin/time -l`),
returned its independently matched complete digest, and left all 40 native
modules unverified. This measures the digest-only path, not full JSON parsing.

## Strict bounded streaming mode

Add `-stream-native` and select the exact `native-baseline-v2` family / be9 source
commit to validate a large captured native baseline without materializing its
whole history. This is an explicit mode; the default oversized-input path above
continues to return a digest-only report. Other families and a `-reference` input
are not implemented in streaming mode and cannot silently use this validator.

`AuditNativeStream(io.Reader, Options, StreamLimits)` checks the entire frozen
schema, duplicate keys, required/optional fields, types and integer bounds. It
keeps at most one block with its transactions, then releases it; all other arrays
are reduced incrementally. It retains only config/accounts/lots/DEX/validators/
policy data needed for selected reconciliation. It checks native block height,
parent/genesis/header preimage and transaction block bindings, but does not prove
execution or nonce replay. Account and per-asset DEX arithmetic uses the same
checker as full mode. Missing business validators still block.

The encoded token scanner enforces **1 MiB while reading**, before string decoding
or numeric conversion. It rejects invalid UTF-8 and unpaired surrogate escapes
instead of silently substituting text. Each object's key/digest index is budgeted
at 8 MiB; live nested indexes total at most 24 MiB. Retained semantic data plus the
current block has a conservative 32 MiB capture budget. The CLI sets a 128 MiB
Go soft memory limit; sampled heap and process peak RSS guards stop on 128 MiB /
256 MiB breaches. Darwin and Linux expose RSS measurements; unavailable RSS
measurement blocks. Exceeding any limit produces an explicit incomplete report,
not a truncated success. These budgets do not promise a hard OS memory cap;
resource measurements must still accompany any release evidence.

`moduleDigestAlgorithm` is **`ynx-json-tree-sha256-v1`**, distinct from full mode's
`canonical-json-sha256-v1`. Every node hashes the UTF-8 prefix
`ynx-json-tree-sha256-v1`, NUL, its kind (`null`, `bool`, `string`, `number`, `array`,
or `object`), NUL, then its body. Scalar bodies are decoded string bytes, exact
JSON numeric text, `true`/`false`, or no bytes for null. Arrays concatenate the
32-byte child digests in array order, followed by their uint64 big-endian count.
Objects sort decoded keys by bytes, then concatenate each uint64 big-endian key
byte length, key bytes and child digest, followed by the entry count. This permits
incremental arrays while retaining exact content distinctions. Object key order
and whitespace do not change the digest; array order and same-count value edits
do. These tree hashes must never be compared as if they were canonical JSON or
the native snapshot's embedded seal.

`inputReadComplete`, whole-file SHA, `schemaVerified` and
`fullModuleInventoryVerified` become true only after the parser reaches EOF with
the complete schema. On an early failure, `inputSha256` is empty and `inputBytes`
is the observed prefix byte count, potentially including a bounded read-ahead;
unfinished modules are listed in `unverifiedModules`. Completed module digests
remain a partial inventory. A matching last block only establishes
`anchorMatchesDeclaration`, not a committed-state binding. The original marker
is checked only for exact anti-downgrade bytes.

**Streaming mode always returns blocked/exit 2.** Embedded seal reconstruction,
execution/nonce replay, cross-family/vNext mapping, source/durability/consensus
proof and `migrationSafe` remain false. A complete strict parse and balanced DEX
supply do not authorize a release or historical repair. Future work must extend
the frozen typed seal computation and business invariants with independently
verified equivalence; it must preserve this distinction.

Block preimage mismatch diagnostics count all mismatches and retain only the
first three plus last public header sample. Validators are hashed, and transaction
payloads are omitted. A mismatch against the be9 formula is a blocker requiring
historical algorithm lineage review; it is not automatically evidence that an
old block was corrupted. The original header/hash is never rewritten or silently
accepted under a guessed legacy formula.

## Native ledger category diagnostics

The exact-be9 streaming path also emits `nativeLedger`: fixed transaction-type
counts and stored amount/fee/lot-flow sums, fixed account-role category totals,
and per-lot conservation across account holdings plus native DEX pool backing.
It never emits addresses, lot IDs, action payloads, or arbitrary transaction
types. Unknown types are counted as `other`. Resource delegation, rental and
income records use the existing bounded module capture budget; additional lot
indexes are charged to that budget. Per-lot positive and negative differences
are checked separately so offsetting corruption cannot hide in a net zero.

Genesis liquid balances without lots, staking without lot segregation, ordinary
transfer fees without lot movement and DEX escrow are different storage
categories in be9. `lotMinusLiquid` is therefore a diagnostic, not a missing
funds figure. Metadata issuance versus account-plus-pool lot holdings is checked
separately. Counts and arithmetic do not establish historical execution,
ownership mapping, provenance, finality or a safe migration. No balance or lot
is created, deleted, or assigned by this tool; all existing blockers remain.

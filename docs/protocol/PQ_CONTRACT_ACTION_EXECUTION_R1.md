# Bounded native PQ contract actions R1

Status: source candidate. No local Go build or test was run for this change. The
new tests require the real pinned compiler artifacts and real dual-PQ keys on
the remote gate. This document does not establish public deployment, a new ABCI
contract action executor, mixed-action Whole admission, or fork activation.

## Authority and supported calls

`Devnet.SubmitPQAction` accepts the existing canonical Action v1 inside its
original Member wire. All eleven earlier action encodings remain unchanged.
The new typed payloads are `contract_deploy` and `contract_execute`, restricted
to `SampleEVMWriteCounter` and `SampleYNXTCompatibleERC20`. The auth codec checks
canonical shape; execution compares the actual source/runtime/compiler hashes
against the existing single pinned registry and compiler material.

The same ledger write lock covers current historical-policy `VerifyMember`,
the exact next account nonce, prestate comparison, actual bounded bytecode
execution, fee/resources/lots, pending transaction and persistence. Both PQ
signatures are required. No exported verified flag or classic recovery path
grants execution. An exact original Member replay returns the earlier outcome,
including after revocation, without executing or charging again.

Deployment signs the exact contract name, source hash, deployed-bytecode hash,
compiler-config hash, one constructor seed and value zero. Although the Solidity
constructors declare `uint256`, the existing constructor-seed implementation
parses `uint64`; R1 retains that actual boundary. The address is deterministically
`0x || first40hex(hashParts("ynx-pq-contract-deployment-v1", originalMemberHash))`.

Execution signs the name, canonical target, the same three identities, complete
execution-prestate commitment, exact canonical calldata and value zero. Counter
accepts only `increment(uint256)` (`0x7cf5dab0` + one exact word). ERC20 accepts
only `transfer(address,uint256)` (`0xa9059cbb` + canonical padded address + word).
Call arguments may span uint256; the real interpreter handles overflow, balance
checks and reverts. Native call value, arbitrary contracts/selectors and dynamic
arguments are outside this executor.

## Complete execution-prestate commitment

The wire field retains the name `ExpectedStorageCommitment`; it means more than
storage. Its lowercase 64-hex value is:

```
SHA256(E(UTF8("YNX-CONTRACT-EXECUTION-STATE/v1"), UTF8(target),
         immutableArtifactJSON, canonicalStorage))
```

`E` is the original framing: a big-endian U32 field count, then for each field a
big-endian U32 byte length and the exact bytes. `immutableArtifactJSON` is Go
`encoding/json.Marshal` of the declared `ContractArtifact` with only these six
public verification metadata fields zeroed: `Verified`, `VerifiedAt`,
`VerifierStatus`, `ReproducibleBuild`, `ReproducibilityStatus`, and
`DeployedBytecodeComparisonStatus`. `RuntimeStorage` is nil in that projection
because it is encoded separately. All remaining fields, including owner,
address, constructor, deployment time, ABI, compiler identity, slot metadata,
runtime fields and `PQAnchorTransactionHash`, remain committed. Struct field
order, JSON tags and this projection are protocol material; future schema
changes must not silently redefine existing commitments.

`canonicalStorage` is U32 entry count followed by entries sorted by exact key,
each U32(66), UTF8(key), U32(66), UTF8(value). Both key and value must be lowercase
`0x` plus exactly 64 hex digits. Missing and explicitly present zero slots
differ. Aliases, normalization, whitespace and noncanonical words are rejected.
The independent minimal vector in `TestPQContractCommitmentCompleteIdentityAndPublicMetadata`
has an 815-byte immutable JSON projection, a 1052-byte complete frame and digest
`880a1cb968cbf3a7e881ca71f6ebce22cc44239b2c7c28f50423aff34dbca2a1`.

## First anchor, retained evidence and replay

`ContractArtifact.PQAnchorTransactionHash` is optional/omitted for preexisting
contracts. A first PQ execution signs an actual prestate with an empty marker.
Its deterministic poststate initializes the marker to the original Member
transaction hash. PQ deployment also begins with an empty marker in its initial
receipt and initializes its stored poststate to that hash. Later executions
include the marker in their signed prestate and preserve it forever. Public
source verification updates only its six metadata fields and preserves it.

The historical memo retains the exact original Member and canonical bounded
receipt JSON. The receipt contains the complete before artifact (or initial
deployment artifact), runtime bytecode and, for execution, the actual complete
after storage, storage writes, VM logs, instruction count and encoded result.
At the first anchor only, it also retains the normalized pinned source and
actual compiler artifact file. Bounds are 512 KiB receipt JSON, 128 KiB artifact
file, 64 KiB source, 12 KiB runtime hex, 16 writes, 4 logs and the existing
2048-step interpreter limit. Oversized fresh receipts fail before mutation.

Fresh admission reads the actual confined artifact and build-info files and
calls `ValidateConsensusContractMaterial`. Historical replay performs no file
access or compilation: it checks the unique existing pinned source/runtime
identity, retained creation/runtime/ABI hashes, functions/events/slots and exact
static compiler configuration, then executes the actual retained runtime code.
This compact historical material does **not** independently reconstruct or
re-authenticate the original complete build-info file. Full compiler provenance
remains a separate evidence layer; no missing material is replaced by a claimed
compiler name or a mock. Source-to-consensus export retains its own existing
full material/blocker requirements.

No-anchor legacy snapshots keep their previous validation boundary. The first
PQ execute anchors the actual current state; it does not retroactively claim
to replay forgotten old calldata or previous public-verification resets. From
that point onward, all PQ and legacy calls to the target are replayed in actual
block transaction order, then pending order. Each PQ before-state must equal
the preceding replayed state. Every full transition, final storage and complete
execution artifact must match; only the six public metadata fields may differ.
The final marker and first receipt must cover one another in both directions.

Old Counter calls retain a checked post-count log, not their original calldata.
Replay reconstructs the unique equivalent `increment(postCount - preCount)`;
it does not recover original text, case or trailing calldata bytes. Old ERC20
memo retains the caller, recipient, decimal amount and event topic. Their true
pending forms differ: Counter retains one raw VM log; ERC20 retains no raw
logs, but its memo supplies the arguments. These actual forms are checked and
replayed. Missing or inconsistent evidence after an anchor is rejected; no
invented calldata, synthesized successful result or silent storage recomputation
is used to excuse a mismatch. Both mined system/VM logs are checked against
actual block identity, transaction index and cumulative log index.

Legacy eligibility is checked at each original execution height. Later key
rotation/revocation cannot erase earlier lawful signatures or classic calls.
Account revocation does not freeze a public contract for other eligible callers.
The old caller-based authority boundary remains in effect.

## New fee and durability semantics

These values describe actual mutation, not just a transaction's `Fee` field:

| Path | Balance / fee recipient / traceable lots | Nonce | Resource usage |
| --- | --- | --- | --- |
| Existing legacy deploy | Deducts 10; existing code does not credit validator or move lots | +1 | compute +5 |
| Existing legacy execute | Reports Fee 2; existing code does not deduct it or move lots | unchanged | unchanged |
| PQ deploy | Transfers 10 to the admission-selected validator with exact lot flows | exact signed next nonce | bandwidth +1, compute +5 |
| PQ execute | Transfers 2 to the admission-selected validator with exact lot flows | exact signed next nonce | bandwidth +1, compute +1 |

R1 preserves the existing legacy behavior; these are explicitly different new
PQ charging rules, not fee-equivalent compatibility. Fee aliasing to the owner
is a net-zero asset transfer and still consumes the nonce/resources. Insufficient
balance/lots, recipient/resource overflow, stale prestate, code mismatch and
runtime revert fail before ledger mutation. Native value is always zero.

Fee history checks positive, sorted, exact owner/one-recipient flows, their total
and complete earlier faucet issuance/catalog binding. The wire does not sign
the admission-selected validator address; the eventual block validator is not
proof of that earlier recipient. This is not a replay of every past monetary
balance/holding or independent proof of the original fee-recipient choice.

Successful mutation uses `persistMutationLocked`. Definite pre-rename failure
restores the complete original contract, accounts, lots and pending list.
Post-rename durability failure retains the exact result as UNKNOWN. Retrying
the same original bytes reconciles persistence without executing again. New
code does not change legacy direct-persistence behavior.

## Import and trust boundary

Complete snapshot validation, cold load, final replication candidate and source
runtime restoration all reach the ordered contract replay. Partial batch state
defers replay until complete history is attached. The live replication commit
also calls `validatePQContractContinuation` under the final write lock: known
markers and known target deployment/call history cannot be removed or replaced.
Pending-to-mined changes to inclusion/log positions are accepted only after
complete incoming replay; original receipt and execution fields stay exact.

A marker catches local deletion and inconsistency; it is not an external trust
root. An attacker who deletes all related PQ transactions, the marker and final
account state and fabricates an entirely new self-sealed cold snapshot cannot
be distinguished from an earlier history by a mutable marker alone. A trusted
checkpoint or retained local continuation is required to establish no rollback.
An unkeyed snapshot checksum is not such a checkpoint.

The candidate tests use actual compiled Counter/ERC20 code, fresh dual-PQ
signatures and original historical policy. They include legacy interleaving,
pending cold load, full/final-batch copy, source export/restore validation,
pre/post/artifact/log/flow tampering, marker/history rollback, real VM reverts,
fee alias/overflow, terminal revocation, UNKNOWN reconciliation and raw replay.
They are source tests awaiting the remote Go gate, not a claim that they passed.

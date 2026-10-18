# PQ contract actions in the ABCI ledger, R1

Status: implemented source candidate, not yet verified by the fixed remote CI.
No local Go/C build, test, node or service was run for this change. The existing
workflow recompiles both actual Solidity fixtures and runs chain and consensus
tests; this document does not assert their future result, network activation,
validator PQ wire compatibility, deployment or Wallet acceptance.

## Authorization and transport

`pq_action` is a canonical JSON transport for the existing original native Action
Member wire. It adds no signature scheme, alternative principal or verified flag.
Only the already specified `contract_deploy` and `contract_execute` kinds are
enabled here. The other native Action kinds remain outside this ABCI adapter.

The envelope is `{version:1,type:"pq_action",wireHex,source?,material?}` with the
exact Go JSON field order/spelling. `material` holds the original artifact and
build-info byte arrays. Deployment requires those bounded files and source;
execution rejects replacement source/material. Size is at most 24 MiB, including
at most 16 MiB build-info, 128 KiB artifact and 64 KiB source. Proposal byte budgets
still apply. No local file, network request or wall clock supplies execution code.

The complete original Member is verified against the trusted network, owner,
activation/revision/revocation policy at the actual execution height, then the
exact next account nonce is checked. Both PQ components are mandatory. Reusing
the original native Member after commitment fails even if someone rewraps it.
The Comet transaction hash covers the full canonical transport; the native hash
covers the original Member. Both are retained without conflating them.

The existing native codec still binds name, source/runtime/config hashes, bounded
u64 constructor seed or target plus complete execution-prestate commitment and
canonical calldata. It permits only value zero. Solidity declares uint256; the
existing constructor-seed subset is u64, not a complete uint256 constructor VM.

`Application.PQContractArtifact(address)` returns a detached copy of the exact
currently signable complete artifact. `ContractExecutionStateCommitment` excludes
only the six existing public verification metadata fields and separately encodes
sorted exact storage. It includes owner, address, compiler/ABI/slot identity,
constructor, deployment time and the original native PQ marker. It is not merely
a storage-map hash. A client must obtain the current prestate again after any
intervening lawful write.

## Actual compiler and runtime

Source and runtime retain the one `boundedPinnedContracts` registry. That same
registry now also binds the actual creation bytecode hash and exact raw ABI hash:

| Contract | Creation bytecode hash | Raw ABI hash |
| --- | --- | --- |
| SampleEVMWriteCounter | `2be6502d8d00d4ee3741b63489b091e99118dec3b211641f1e95dd15d91512ed` | `97c6a1aa39019cfdd36d1d7af58a5495dcdfc035989d23ce86fb6e75212864a4` |
| SampleYNXTCompatibleERC20 | `febbf4a7554d7fcddaf1c434e11e5c44f5c5e34ef79f4a972c3d58e2a0c12893` | `c8e6dcc86de074f5653e7503ecb3c71e3fd393514205c9e4d7d49030382a1659` |

These use the existing NUL-delimited `hashParts` domains `solc-bytecode` and
`solc-abi`. They were read from the canonical checkout's existing actual Hardhat
artifacts, whose source/runtime hashes exactly match the existing registry and
whose build inputs identify Solidity 0.8.24, optimizer enabled and 200 runs. The
new chain regression requires the existing CI's fresh actual compiler output to
match all pins; no local recompilation was used to claim verification.

The deployment assembler is shared with native source-ledger artifacts. ABI
selectors and event topics are recomputed from the actual ABI, slot metadata and
constructor seeds from the pinned source, and every execution uses the existing
`ExecuteConsensusSourceContract` and bounded bytecode interpreter. Supplied
build-info settings and source must agree, but a build ID is a retained provenance
label, not independent proof of a compiler run. Executable/source/creation/ABI
authority comes from the fixed registry, never self-reported build output.

## Effects and compatibility

PQ deployment really charges 10 YNXT and execution 2 YNXT. Each consumes one
bandwidth unit and respectively five or one compute units, advances the exact
owner nonce once, transfers positive sorted traceable fee lots to the configured
fee recipient, and records the actual fee event. All credit arithmetic accounts
for sender/recipient aliasing and overflow before changing the detached candidate.
The actual contract storage, receipt, fee, resource, nonce and history changes
belong to the same candidate and existing ABCI commit/persistence boundary.

These are the explicit new PQ rules. Existing ABCI classic IDE deploy/call actions
continue their existing fee of 1 and existing resource behavior. Source Devnet
legacy call receipts historically report Fee2 without the same PQ fee/nonce
mutation; this adapter does not rewrite that history or claim fee equivalence.

The live authoritative runtime remains `BFTContract`; actual VM results, writes
and logs remain `EVMReceipts`/`EVMLogs`. No second contract database or placeholder
execution is added. Full native artifacts and original transport are retained in
the existing append-only `PQHistory` with `ynx-abci-pq-contract-v1:` receipts.
Existing committed-state hashing, deep cloning and continuation checks cover them.

Imported source contracts retain their original complete artifact, owner,
deployment time, constructor and source-history marker. New PQ deployments obtain
that artifact deterministically. Older ABCI-only classic deployments did not
retain the full original artifact; this initial adapter rejects PQ execution of
those targets rather than inventing absent metadata. Their legitimate classic
path remains unchanged. A separately authenticated metadata bridge is still
required to make that older subset PQ-callable.

## History and persistence

Every new PQ history entry verifies its historical original Member, exact fee
flow/event, nonce consumption, transport hash and real native transition. Native
Devnet block hashes/system logs are not fabricated for Comet transactions.

For every PQ target, replay begins at its complete imported checkpoint or genuine
PQ deployment and processes actual global EVM log order. PQ calls must match the
entire preceding artifact/storage. Intervening classic calls must have been
lawful under policy at their own height and reproduce all VM output, steps,
writes, logs and exact final storage. Counter logs reconstruct the equivalent
canonical increment amount; they cannot recover omitted original legacy calldata
bytes. ERC20 transfer semantics come from the actual ABI topics/data. This is
runtime replay, not a fabricated historical classic signature.

Deployment receipts, all call receipts, final BFT artifact fields, resources,
fee events and retained proofs have bidirectional coverage. New PQ deployments
may be called in the same block through proposal execution; ordinary CheckTx
still sees only committed state. Read-only CheckTx has no block timestamp: its
discarded candidate uses a deterministic placeholder, while FinalizeBlock
constructs the committed deployment with the supplied real block timestamp.

Commit errors before rename keep the original committed state and exact pending
candidate. Errors after rename retain the existing durability-uncertain fence;
cold recovery must confirm the directory and repeated Commit confirms the same
candidate without reexecuting code or charging twice. The original wire is not
automatically resubmitted as a new action.

Append-only local continuity rejects removal/rewrite of known proofs. As with
other state-hash formats, an arbitrary completely rewritten cold snapshot cannot
prove that no whole-history rollback occurred without an independently trusted
checkpoint/AppHash. The receipt or marker does not replace that external root.

## Regression scope

New source tests use real PQ signatures and actual compiled Counter/ERC20 files:
deployment, PQ call, lawful classic interleaving, subsequent PQ call, historical
terminal revocation, unaffected caller, actual cold restart, imported source
artifact, same-block calls, and same-block deployment plus call. Negative cases
include each damaged PQ component, foreign owner, nonce/fee, stale complete
prestate, creation/ABI replacement including forged self-consistent build output,
insufficient balance/trace lots, resource and recipient overflow, fee alias,
resealed before/after storage, owner/result/write/log/order/fee/resource/history
tampering and original UNKNOWN persistence/reconfirmation. The tests do not
replace acceptance with mocked signatures or a second simulated interpreter.

Required integration hooks are the `pq_action` dispatcher, common PQ-history
chronology/metadata routing, the complete `validateConsensusPQContracts` pass,
and the narrow real-PQ deployment identity/same-height exception in IDE validation.
Relaxing only an old envelope or version gate is not this integration.

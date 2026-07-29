# YNX StreamBFT Specification

| Metadata | Value |
| --- | --- |
| Version | 0.1.1-candidate |
| Effective date | 2026-07-22 |
| Source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Shadow-candidate source reviewed | `9c2d39799b9eef0be06e3b04d4ffe2e9087cc5b8` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Engineering specification; independent consensus and security review required |

## 1. Scope and terminology

YNX currently has two distinct consensus tracks. CometBFT `v0.38.23` with the
YNX ABCI 2.0 application is the accepted safety baseline. A newer StreamBFT
implementation exists only as a disabled-by-default, locally tested shadow
candidate on the reviewed candidate source commit. The public network is not
claimed to run StreamBFT, and the shadow candidate is not integrated into the
central source identified above.

Sections 2 through 17 first define the accepted CometBFT/ABCI behavior represented
by the central source. Section 18 separately records the newer StreamBFT shadow
candidate. Mainnet parameters, permissionless validator admission, slashing
economics, formal verification artifacts, public StreamBFT deployment, and
production decentralization are outside the proved scope.

Normative terms `MUST`, `MUST NOT`, `SHOULD`, and `MAY` describe candidate
behavior. A requirement is a release claim only after its directly relevant test
and deployment evidence pass on the identified source commit.

## 2. Network and software identity

| Property | Candidate value |
| --- | --- |
| Network | YNX Testnet |
| Numeric application/EVM chain ID | `6423` |
| Comet chain ID | `ynx_6423-1` |
| Native Testnet asset | YNXT |
| CometBFT | `v0.38.23` |
| ABCI application name | `ynx-abci` |
| ABCI default transport | Socket |
| ABCI default listener | Loopback TCP port 26658 |
| Migration state version | 1 |
| Committed state version | 7 |
| Native transaction version | 1 |

The production-candidate package MUST bind one exact binary/source release,
migration state hash, genesis, validator public manifest, and packaged-file
digests. A candidate package MUST NOT contain validator or node private keys.

## 3. Trust and fault model

CometBFT provides consensus networking, proposal, vote, commit, and validator-set
mechanisms. The YNX application assumes the configured validator set and key
bindings are authentic. The four-role candidate uses `primary`, `singapore`,
`silicon-valley`, and `seoul` as operational identities; these labels do not
prove independent ownership or geographic decentralization.

The candidate’s safety depends on:

- CometBFT’s quorum assumptions holding for the configured voting power;
- byte-identical genesis and migration anchors;
- correct Ed25519 validator-key bindings;
- deterministic application execution;
- durable committed-state integrity;
- protected operator and host access; and
- rejection of malformed, replayed, unauthorized, or wrong-chain actions.

The local four-validator fault test proves continued block production after one
local validator and its ABCI process stop. It does not establish behavior under
Internet partitions, correlated host failure, Byzantine operator behavior,
denial-of-service at public ingress, or compromise of a voting-power quorum.

## 4. Migration anchor

The application starts from `ConsensusMigrationState` version 1. The migration
document includes:

- source format `ynx-devnet-state-v1`;
- network identity;
- last committed height and block hash;
- unique accounts sorted by address;
- unique validators sorted by address;
- resource policy;
- liquid and staked YNXT totals; and
- a deterministic state hash.

Every account MUST have non-negative balance, stake, resource use, and lot
amounts. Aggregate liquid and staked totals MUST equal the account sums without
integer overflow. Every validator MUST have a unique identity, positive voting
power, and valid consensus-key binding when a binding is present. At least one
active validator with positive voting power MUST exist.

The migration hash binds the canonical migration content. The ABCI application
MUST reject a malformed, unsorted, mismatched, or hash-inconsistent migration.
The initial AppHash equals the validated migration state hash.

## 5. Validator identity and key custody

Consensus public keys use the Comet/Tendermint Ed25519 key type. A production
manifest MUST contain exactly the approved active roles and MUST reject missing
roles, duplicates, malformed public keys, wrong role bindings, non-positive
voting power, duplicate endpoints, public or loopback private-P2P addresses, and
derived-address mismatches.

Each operator generates validator and node private keys on the assigned host.
Private key files MUST be readable only by the intended owner and MUST NOT be
printed, retrieved into the evidence package, committed to source, or sent in
chat. The key checker derives public identity locally and compares it to the
approved manifest.

An overlay key ceremony and WireGuard deployment are separate operational gates.
Creating an overlay key does not authorize route changes; deploying the overlay
does not authorize public consensus cutover.

## 6. Native transaction envelope

The version-1 native transaction is a single strict JSON value no larger than
16 KiB. Unknown fields and trailing JSON values are rejected.

| Field | Constraint |
| --- | --- |
| `version` | Exactly `1` |
| `chainId` | Positive and equal to configured chain ID |
| `type` | Exactly `transfer` |
| `from` | Canonical lowercase EVM-compatible address |
| `to` | Canonical lowercase EVM-compatible address, different from sender |
| `amount` | Positive signed 64-bit integer within state bounds |
| `fee` | Exactly `1` YNXT unit in the current bounded model |
| `nonce` | Positive and equal to authoritative next account nonce |
| `publicKey` | Hex-encoded compressed secp256k1 public key |
| `signature` | Hex-encoded DER ECDSA signature with canonical low-S value |

The native address is the last 20 bytes of legacy Keccak-256 over the
uncompressed secp256k1 public key without its format prefix. The derived address
MUST equal `from`.

Signing bytes are canonical JSON over the fields above, excluding the signature,
with domain `YNX_NATIVE_TX_V1`. The SHA-256 digest of those bytes is verified by
the supplied secp256k1 key. A wrong chain, sender-key mismatch, non-canonical
signature, self-transfer, invalid amount, fee mismatch, stale or future nonce,
insufficient balance, or replay MUST fail closed.

## 7. Application action envelopes

The application also supports signed, domain-separated action envelopes for
bounded AI permissions, Pay, Resource, governance, Trust, IDE, and related state.
Each action type defines its own payload validation, signer authority,
idempotency, expiry, fee, and audit behavior. Presence of an action type does not
authorize an external provider action or user-asset movement beyond the exact
committed state transition.

Application actions MUST be deterministic and MUST reject unknown action types,
wrong-chain signatures, replay, malformed identifiers, unauthorized transitions,
scope widening, expired approval, and inconsistent idempotency inputs.

## 8. ABCI transaction lifecycle

### 8.1 CheckTx

`CheckTx` clones committed execution state and applies the candidate transaction
without persistence. A valid transaction returns success, deterministic
transaction-hash data, and the bounded gas accounting currently represented by
the implementation. A validation or state-transition error returns a non-zero
code and no state mutation.

Mempool acceptance is not finality. A transaction that passed `CheckTx` may later
be excluded or become invalid because earlier committed transactions changed the
relevant nonce, balance, permission, or idempotency state.

### 8.2 PrepareProposal

`PrepareProposal` starts from committed state and evaluates candidate
transactions sequentially. A transaction is included only if:

- it fits the provided maximum transaction bytes when that bound is positive;
- decoding and signature checks pass; and
- applying it after all previously selected transactions succeeds.

Invalid or oversized candidates are skipped. The selected order is the incoming
order after deterministic filtering; the current implementation does not claim
a public fee auction or maximal-extractable-value policy.

### 8.3 ProcessProposal

`ProcessProposal` rejects a non-zero height that is not exactly the next height.
It replays every proposed transaction sequentially from committed state. Any
failed transaction rejects the entire proposal. Only a fully valid ordered list
is accepted.

### 8.4 FinalizeBlock

`FinalizeBlock` requires the next sequential height and refuses to finalize a new
block while another finalized state is pending commit. It evaluates transactions
in order, emits per-transaction results and bounded events, seals a deterministic
candidate state, and returns the resulting AppHash.

The implementation records failed execution results without applying their state
changes. Proposal processing is expected to reject such transactions before
finalization; tests and remote evidence MUST detect divergence between proposal
validation and finalization behavior.

### 8.5 Commit

`Commit` requires a pending finalized state. The state is validated and written
atomically to the configured durable state file. Only after persistence succeeds
does pending state become committed state. A write failure MUST leave the prior
in-memory committed state authoritative.

## 9. Deterministic state and AppHash

Committed state version 7 binds the migration state hash, chain ID, sorted account
state, application records, and audit data under domain `YNX_ABCI_STATE_V7`.
The hash document covers accounts; AI permissions/actions/audit; Pay records;
Resource records and sponsorship; governance and Trust records; bounded contract
records; EVM receipts and logs; and IDE idempotency.

Height is persisted for restart recovery but excluded from AppHash. Therefore an
empty block that changes no application state retains the preceding AppHash. The
state validator checks unique sorted identities, non-negative values, transition-
specific invariants, total liquid-plus-staked YNXT conservation, migration
binding, and exact AppHash reproduction.

Nodes processing the same migration anchor and ordered transactions MUST produce
byte-equivalent committed application state and the same AppHash.

## 10. Supply, fee, and account invariants

Native transfer execution MUST:

- preserve aggregate liquid plus staked YNXT;
- debit the sender by amount plus the exact current fee;
- credit the recipient by the amount;
- allocate the fee according to the current deterministic validator rule;
- increment the sender nonce exactly once;
- update resource usage without negative values; and
- move traceable lots in deterministic sorted order.

The fixed fee and current fee recipient rule are Testnet implementation details,
not final economic policy. Any fee-market or validator-economics upgrade requires
a new version, compatibility plan, tests, migration, governance approval, and
release disclosure.

## 11. Query behavior

ABCI query paths expose bounded committed views for migration and state,
accounts, AI, Pay, Resource Market, governance, Trust, bounded IDE contracts and
calls, EVM receipts/logs, and transparency records. Queries MUST return committed
state and MUST NOT mutate state. Unknown paths fail with an explicit supported-
surface message.

Gateway, Indexer, Explorer, or third-party caches are derived views. They MUST
identify source, observation time, version, and stale/unavailable state and MUST
NOT override authoritative committed state.

## 12. Packaging and deployment boundary

The candidate generator produces a public-key-only package containing the
migration anchor, common genesis, per-role configuration, candidate-specific
service units, and install, health, backup, and rollback scripts. SHA-256 coverage
binds every packaged file.

Candidate RPC, ABCI, and metrics bind to loopback. P2P binds to the approved
private address. Candidate services use distinct names and data roots and MUST
NOT replace the authoritative service before an approved cutover transaction.

Package generation and dry-run deployment prove input validation and packaging,
not remote installation, live quorum, fault tolerance, public ingress, or public
availability.

## 13. Evidence gates

| Gate | Directly checked behavior | Does not prove |
| --- | --- | --- |
| Migration check | Deterministic export, validation, hash and supply invariants | Remote consensus |
| ABCI check | Application lifecycle and state behavior | Multi-node quorum |
| Signed-transfer check | Envelope, signature, nonce, fee, balance and persistence rules | Public transaction availability |
| Local quorum check | Four local nodes, convergence, signer participation, one-node stop/restart | Independent operators or remote resilience |
| Production-package check | Manifest, hashes, key binding, binaries and dry-run deployment | Installation or public cutover |
| Candidate verifier | Common remote height/hash, validator set, signatures and peers | Fault recovery or public reachability |
| Remote fault drill | Continued candidate progress and restart/catch-up | Byzantine fault tolerance beyond the tested fault |
| Owner-signed transaction drill | Converged remote account transition and transaction evidence | General public submission |
| Public proof | Independent endpoint identity, progress, release and transaction evidence | Mainnet readiness or future availability |

Every evidence package MUST bind source commit, package digest, network identity,
observation time, command or procedure version, result, and failure state.

## 14. Security boundaries

- CometBFT consensus keys are separate from user secp256k1 transaction keys.
- Candidate host keys and overlay keys remain host-local and mode-restricted.
- ABCI does not store user private keys.
- Public RPC does not imply access to admin, ABCI, metrics, or signer paths.
- Signed public transaction bytes may cross a gateway; raw private keys may not.
- Operator approval flags authorize only the named bounded transaction.
- Evidence collection must redact secrets while preserving public identities,
  transaction hashes, heights, block hashes, release identity, and digests.

## 15. Recovery and rollback

Before installation or cutover, operators require a backup of authoritative state,
configuration, and release identity. Restore must validate state integrity and
network identity before service activation. A failed candidate check must preserve
or restore the authoritative service. A rollback is incomplete until chain
progress, account state, release identity, monitoring, and public routes are
re-verified.

Restart persistence is not a restore drill. A release claim requires recorded
backup creation, isolated restore, integrity comparison, recovery-time evidence,
recovery-point evidence, and cleanup.

## 16. Known limitations and open review items

- StreamBFT currently composes CometBFT and a YNX ABCI application; no independent
  formal consensus proof is claimed.
- The named four-role topology does not prove independent validator ownership.
- The current fixed fee is not a congestion market.
- Permissionless validator onboarding, delegation economics, unbonding, slashing,
  jailing, rewards, and governance are not specified by this document.
- Internet partition, Byzantine validator, public denial-of-service, storage
  corruption, long-range recovery, and upgrade-interoperability testing require
  additional evidence.
- Public deployment and public transaction evidence are release-specific and must
  not be inferred from local or operator-controlled tests.

## 17. Accepted-baseline source map

| Concern | Source |
| --- | --- |
| Native envelope and signature verification | `internal/consensus/transaction.go` |
| ABCI lifecycle and deterministic application | `internal/consensus/application.go` |
| Durable state and AppHash | `internal/consensus/state.go` |
| Migration anchor and validator bindings | `internal/chain/consensus_migration.go` |
| Genesis and candidate package | `internal/consensus/genesis.go`, `internal/consensus/production.go` |
| Candidate manifest constraints | `chain/consensus/production-validator-manifest.schema.json` |
| Operational evidence procedures | `chain/consensus/README.md`, consensus verification scripts |
| Test coverage | `internal/consensus/*_test.go`, consensus validation targets in `Makefile` |

If this specification and source disagree, the identified source commit and its
tests are authoritative for implementation behavior; the discrepancy must block
publication until corrected.

## 18. StreamBFT shadow candidate

The reviewed shadow candidate separates data availability, ordering, and
execution. It is not part of the accepted central baseline and MUST NOT vote,
commit, or change authoritative public state.

### 18.1 Data availability and ordering

Workers form canonical DAG batches. A batch becomes orderable only after
Ed25519 votes representing more than two thirds of configured validator power
bind its digest. Ordering uses deterministic leader rotation, domain-separated
quorum certificates, persistent locked-QC voting, and a three-certified-chain
commit predicate. An asynchronous fallback uses a separate certificate domain.
Aggregate or threshold signatures are not trusted by candidate version 1;
individual Ed25519 verification remains required.

### 18.2 Semantic lanes

Transactions are assigned to nine fixed lanes in deterministic order:

1. consensus and governance;
2. oracle, bridge, and risk;
3. liquidation;
4. cancellation and mass cancellation;
5. trading orders;
6. Pay and stable settlement;
7. general EVM;
8. service settlement; and
9. bulk data commitment.

Each lane has independent capacity and minimum-fee configuration. Canonical
sorting places cancellation before new trading orders. Saturating General EVM
must not consume consensus/recovery or Pay lane budgets.

### 18.3 Deterministic parallel execution

Transactions declare unique sorted read and write sets. The candidate rejects
empty, oversized, unsorted, duplicated, or undeclared write keys. Non-conflicting
transactions may execute concurrently; writes commit in deterministic dependency
waves. A sequential path executes the same proposal. Differential tests require
parallel and sequential state roots to match for different worker counts.

Resource meters cover compute, storage reads, storage writes, bandwidth, and
state growth with overflow checks. State roots hash length-delimited sorted keys.

### 18.4 Candidate local fee markets

Each lane can maintain a bounded base fee derived from prior base fee, target
compute use, observed compute use, a change denominator, and configured minimum
and maximum. Resource cost is the checked sum of metered resource units multiplied
by configured prices. Overflow fails closed.

This mechanism is candidate code only. It is not active fee policy, is not
integrated into the central consensus state, has no governance activation, and
has no public fee or burn evidence.

### 18.5 Promotion gate

Candidate modes are `disabled`, `shadow`, and `canary`. Canary resolution fails
back to shadow unless all of these direct evidence classes are true:

- formal safety verification;
- differential replay and state-root equality;
- validator-count evidence for 4, 7, 13, and 21 validators;
- at least three WAN regions;
- Byzantine, partition/loss, state-sync/restore, long-soak, and rollback tests;
- and a composite operational win over the accepted CometBFT baseline.

The current repository evidence deliberately does not satisfy that promotion
gate. A finite TLA+ model source exists for four validators and one Byzantine
validator, but no TLC or Apalache run artifact has been recovered; model source
alone is not formal verification evidence.

### 18.6 Shadow-candidate source map

| Concern | Reviewed candidate source |
| --- | --- |
| Candidate modes and promotion evidence | `internal/streambft/mode.go` |
| DAG, proposal, quorum certificate, safety and pacemaker | `internal/streambft` candidate modules |
| Semantic lanes and access sets | `internal/streambft/types.go` |
| Deterministic executor and state roots | `internal/streambft/executor.go` |
| Per-lane base fees and resource pricing | `internal/streambft/fees.go` |
| Finite safety model source | `docs/formal/streambft` |
| Local candidate gate | `scripts/verify/streambft-candidate-check.sh` |

These paths identify the reviewed candidate commit, not files in the accepted
central source. Publication must preserve that distinction until integration is
approved and reverified.

## Change log

- 0.1.1-candidate (2026-07-22): Distinguished the accepted CometBFT/ABCI safety
  baseline from the newer disabled-by-default StreamBFT shadow candidate and
  documented its lanes, deterministic execution, fee markets, and fail-closed
  promotion evidence.
- 0.1.0-candidate (2026-07-22): Initial evidence-bounded specification of the
  CometBFT/ABCI candidate, migration anchor, native envelope, transaction
  lifecycle, deterministic state, packaging, security, recovery, and evidence
  boundaries.

# Account policy permanent revocation R1

This is the policy-package candidate for explicit permanent dual-PQ revocation.
It is not a deployed route, a completed ledger adapter, an account migration, or
a network activation. At authoring, only `gofmt`, diff whitespace checks and the
independent unsigned Node framing vector have executed. The genuine-crypto Go
tests are source awaiting the parent's isolated remote CI; no local Go compile,
test, heavy service, account signing, production write or private-key export ran.

## Meaning and authority

Ordinary rotation keeps an account usable: the current lawful pair authorizes
replacement and both new independent keys prove possession under the existing
`YNX-ACCOUNT-REGISTRATION/v1` intent. Permanent revocation instead makes the
account unusable for new authorization from its next execution height onward.
The current lawful ML-DSA-87 AND SLH-DSA-SHA2-256f pair must authorize it. A known
new public key, old classic mnemonic, device signature, recovery token or
delegation does not authorize revocation or undo it.

The operation is terminal for the account in this protocol version. There is no
unrevoke, replacement registration, classic recovery fallback or owner-change
operation. A compromised or lost pair cannot be repaired by this operation
without its lawful dual signature; a usable account should rotate beforehand.
An already admitted pending rotation can be revoked by the currently active
pair. The signer must explicitly bind the latest registered revision, so the
request cannot silently omit a newer pending pair. Both full key records remain.

The intent binds exact execution height H; revocation is effective at H+1 only.
This preserves legitimate earlier transactions in block H and makes delayed
inclusion invalid. Ordinary transactions signed by the current pair may still
execute at H, including after the revocation transaction; they cannot execute at
H+1. The terminal record prevents further registration as soon as it is admitted,
including during H. H=MaxUint64 is rejected. The ledger nonce must equal current
nonce+1 without overflow, and cannot precede the latest registration's nonce.

## Compatibility and public state

`PolicyVersion` remains exactly `YNX-ACCOUNT-POLICY/v1`. The original `Record`
layout, v1 JSON field order/omission, registration/transfer messages and their
vectors are unchanged. The first successfully admitted revocation explicitly
returns state version `YNX-ACCOUNT-POLICY/v2`. `State.Revocations` is serialized as
`revocations,omitempty`, so v1 output has no new field. A v1 state containing a
tombstone is invalid. A v2 state without a tombstone is invalid. Historical v1
snapshots remain v1; do not relabel them or rewrite their hashes.

Each immutable `RevocationRecord` contains:

| Field | Meaning |
| --- | --- |
| owner | Existing canonical lowercase native `0x` address. |
| authorizingRevision | PQ registration active at the original execution height. |
| throughRevision | Last registered revision, including any pending rotation. |
| registeredAt | Original revocation execution height H. |
| revokedFrom | Exactly H+1. |
| ledgerNonce | Nonce consumed by the original revocation transaction. |

The original genesis bytes, enable height and every original full registration
remain in the same state. There is at most one tombstone per owner, sorted by
owner. A tombstone must reference that owner's active revision at H and latest
complete record. Registrations after H are invalid. `State.Validate` checks shape
and consistency; it is not proof of lawful admission. Durable snapshot/history
validation must also retain and verify the exact original signed revocation wire
and enforce immutable continuation. A structurally valid fabricated record must
not be accepted without this proof coverage.

`PolicyAt(owner,height)` still selects the registration for that historical
height. Its true result means the account has an activated PQ registration; it
is deliberately still true after revocation so classic guards cannot reopen.
It is **not** signing eligibility. `RevocationAt(owner,height)` returns a
tombstone only when effective; pending tombstones remain in `State.Revocations`.

`TrustedRegistration(owner,purpose,height)` is the shared authoritative resolver
for new and historical Member/Whole verification. It validates the entire state,
selects the full registered pair and rejects effective revocation. Before that
height, it includes `RevokedAt` in the trusted registration; therefore adding a
pending tombstone changes authenticated-handle/cache identity immediately while
fresh historical verification remains valid. Never construct `Enabled:true`
from a bare `PolicyAt` result. Callers hold a state lock or use an immutable
complete snapshot throughout verification and transition.

`VerifyMember` uses this resolver. `AdmitMigration` rejects any new registration
for an owner with a tombstone. Unrelated accounts retain their own policy and can
still migrate/rotate in a fully integrated v2 ledger. The policy package alone
does not install v2 in any live ledger or grant an API operation.

## Independent revocation wire

E is the unchanged U32BE field count followed by each U32BE byte length and raw
field. Every U64 is two independently framed U32BE values, high then low. Client
code must use BigInt/decimal strings, never rounded JS Number. No JSON or
application hash substitutes for the signed full message.

The intent is exactly 17 fields:

```
E("YNX-ACCOUNT-REVOCATION/v1", U32(1), originalGenesis32, owner,
  "YNX-BATCH/v0.1", currentPKA2592, currentPKB64,
  authorizingRevision.high, authorizingRevision.low,
  throughRevision.high, throughRevision.low,
  ledgerNonce.high, ledgerNonce.low,
  executeAt.high, executeAt.low,
  revokeAt.high, revokeAt.low)
```

The complete request is exactly three fields:

```
E("YNX-ACCOUNT-REVOCATION-ENVELOPE/v1", fullIntentBytes, currentPQMemberWire)
```

The Member proof has N=1, index=0, purpose `ACCOUNT-REVOCATION`, original network,
owner and the complete currently registered pair. Both branches must pass over
the full canonical intent. There is no classic field, new-key field or alternate
proof branch. The total envelope is bounded at 128 KiB and the intent at 4096
bytes. Unknown versions, framing/trailing bytes, wrong complete message, purpose,
network, owner, key pair, revisions, nonce or execution height reject.

`AdmitRevocation(request,height,currentNonce)` returns a detached state only. It
does not debit fees, consume a ledger nonce, store a receipt or write a file.
Those effects and full proof persistence belong to one locked ledger mutation.
The adapter must implement UNKNOWN durability and identical-wire reconciliation
using the original transaction; calling `AdmitRevocation` twice is rejected.
The signing wire does not choose a fee; a future adapter must specify its fixed
fee as part of the versioned execution rule and record it in historical checks.

## Required integration before enabling v2

This is an exhaustive candidate-source inventory from the inspected production
worktree at base `a5466bebcf1b298360db1a9bbeb7f57dc745e59a`, plus the concurrent
new action owner. Recheck these searches when integrating later changes:

```
rg -n 'PolicyVersion|YNX-ACCOUNT-POLICY/v1|PolicyAt\(|ResolveTrustedOwner:|ynxbatch.Registration\{' internal docs/protocol
rg -n 'AccountPolicy|accountPolicy|account-policy' internal/chain/consensus_migration*.go internal/consensus
```

| Location / symbol | Required integration and present boundary |
| --- | --- |
| `internal/chain/pq_snapshot.go`: `validateAccountPolicyShape` | Exact v1 gate currently rejects v2. Add explicit v2 support only with tombstone proof validation, v2 snapshot identity/hash version rules and readback. A package-level Validate success is not permission to lift this gate alone. |
| Same file: `validateAccountPolicyContinuation` | Currently rejects any version change and compares original Records. Allow only authenticated v1→v2 once; keep network/EnableAt/all full records unchanged, preserve every existing tombstone exactly, allow only properly proved new tombstones, prohibit v2→v1/removal/rewrite. |
| Same file: `validateAccountPolicySnapshot` | Count original revocation proofs and tombstones bidirectionally exactly once, including pending transactions. Reject orphan/duplicate proof, missing tombstone, altered nonce/height/key reference, pre-enable event and revocation beyond execution tip. Existing migration proof coverage must remain. |
| `internal/chain/pq_authorization.go`: `validateHistoricalPQTransaction` | Add a distinct revocation memo/type with complete raw wire, wire identity, fixed fee/owner/nonce/height checks. For each original migration/revocation, rebuild state immediately before that event. Remove tombstones admitted later, including same-height tombstones later in this owner's nonce order; merely filtering `RegisteredAt >= height` loses earlier same-height independent-account events. Restore v1 only when rebuilding a historically v1 view without tombstones, not by mutating current state. Do not apply current revoked eligibility to older transactions. |
| Same file: `SubmitAccountMigration`, `verifyPQSignedTransferLocked`, future `SubmitAccountRevocation` | Migration/transfer already use policy methods, but require full durable v2 adapters before state admission. New revoke must hold d.mu, verify real pair, atomically consume nonce/fee/resources and append original proof/tombstone; definite pre-rename failure rolls back all, after-rename UNKNOWN keeps terminal policy and exact original receipt for reconciliation. |
| Same file: `EnableAccountPQ` | Creates initial v1, and must continue doing so. Enabling PQ globally is not a terminal-revocation event and cannot create empty v2. |
| `internal/chain/pq_batch.go`: `authenticatePQBatch` | Existing exact v1 gate safely rejects v2. Its resolver manually creates `ynxbatch.Registration{Enabled:true}` from `PolicyAt`; replace with `TrustedRegistration` before widening versions. Verify full Whole branches once, preserve the caller's state lock and per-member state refresh. |
| Same file: `pqBatchAdmission.transfer` | Existing exact v1 gate plus full Record equality does not detect a tombstone. Each member must refresh `TrustedRegistration`, including RevokedAt and effective height, before any balance/nonce effect. Do not rely only on a certificate verified before revocation. |
| `internal/chain/pq_batch_snapshot.go` | Historical Whole verification must use the same resolver at each proof's original height; no current-time revocation rule may invalidate earlier proof history. Preserve proof↔transaction coverage. |
| `internal/chain/pq_action.go` (concurrent owner) | New locked action path is planned to call `State.VerifyMember` directly; retain that exact current/historical height rule. Do not add a separate Enabled:true resolver. New historical action envelopes must coexist with revocation proof reconstruction. |
| `internal/chain/consensus_migration_runtime.go` and `consensus_migration.go` | Full source runtime, AccountPolicy and original genesis anchor must retain tombstones and raw proofs; continuation currently forwards the source v1-only gate. Never import v2 by discarding Revocations or copying only Records. Export must preserve pending/UNKNOWN rejection and exact hash identity. |
| `internal/consensus/account_policy.go`: envelope encode/decode/apply and `validateConsensusPQState` | Current transport recognizes only transfer and migration. Add explicit revocation kind and real execution, nonce/fee/audit persistence, exact historical transport hashes, tombstone proof coverage and continuation. Existing VerifyMember/RequireLegacy calls inherit package behavior but do not implement a revoke executor. |
| `internal/consensus/state.go`, `application.go` | New immutable tombstones must participate in clone/seal/AppHash/commit/restart validation and query. `/account-policy` currently serializes State, but must only expose a fully verified committed v2 state. No empty initial policy or v1 downgrade is allowed. |
| `internal/api/pq_authorization.go` | Current query converts any PolicyAt result to active, including in committed view. Add explicit `active`, `revocation_pending`, `revoked` statuses and full decimal-string tombstone records; compute current and committed views independently at their actual heights, with admission height included. Keep original full records, no-store, checkpoint/UNKNOWN and raw-genesis binding. Do not present a revoked `activeRevision` as usable signing authority. |
| `internal/appgateway/account_policy.go` | Exact v1 response gate currently rejects v2; its public DTO parses Records only. Preserve that closed behavior until it parses and validates complete tombstones, independently recomputes state/status and denies revoked classic/PQ sessions. Simply permitting a new version string would silently drop the terminal record. |
| `internal/ynxauth/policy.go`: proposed-key resolver in `AdmitMigration` | Deliberately remains a temporary new-pair possession resolver after the current lawful authorization check. It is not a chain trust resolver. The new terminal check must precede it and can never be replaced by successful possession proof. |
| Wallet SDK / Auth trusted-query adapters outside this repo | Their currently frozen v1 query schema must explicitly version and preserve complete tombstones/status, reject unsupported v2, recompute at committed and next heights, retain owner/network/full-pair checks and recheck before session completion. Operator TLS/producer checkpoint is not a BFT proof. No normal-source admission should be created from a public test DTO. |

Existing exact v1 gates remain untouched in this package-only change. Therefore
new v2 state cannot be installed through current snapshot/continuation paths and
Whole admission fails closed. Do not deploy a partial v2 relaxation while any
remaining resolver, history adapter, consumer or query still ignores tombstones.

## Verification source and independent syntax vector

Seven Go tests in `revocation_test.go` use freshly generated real CIRCL keys for
all accepting revocation and transaction paths: terminal revocation, full public
history, JSON restoration, pending rotation cancellation, both independently
damaged signature branches, wrong pair/purpose/message/owner/network/nonce/height,
N=2 rejection, cache-handle invalidation, high-U64 values, malformed state,
multiple independent owners and detached public storage. They do not install a
fake acceptance resolver. These tests must run in the parent's remote Go lane.

The unsigned independent vector uses network bytes 0..31, owner
`0x1111111111111111111111111111111111111111`, PKA byte i%256 for 2592 bytes, PKB
byte 255-i for 64 bytes and the five U64 values:
`34359738371`, `34359738372`, `36028797018963973`, `281474976710675`,
`281474976710676`. Independent Node Buffer/BigInt E-framing actually produced
17 fields, 2885 bytes, and SHA256
`4a79f4f550d9f297b9d6bbff1a6413a1d1a8d477f1b8d52dea14d1a085e27a10`.
The Go syntax test compares against those exact bytes through that digest.
These patterned public bytes are not account registrations or acceptance proofs;
SHA256 here is a byte-equality test oracle, not a replacement for dual signing.

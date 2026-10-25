# Candidate Comet object signer R1

This source adapter signs the actual pinned CometBFT v0.38.23 protobuf
`Proposal` and `Vote` objects with the existing durable dual-PQ `Signer`.
It is a candidate integration component. It does not complete a Comet fork,
engine deployment, remote-signer transport, light client, or network upgrade.
The new source and real-cryptography regression tests await authorized remote
CI; no local Go compilation or execution was performed for this handoff.

## Public API

```go
func NewObjectSigner(signer *Signer, source ObjectSigningStateSource) (*ObjectSigner, error)
func (s *ObjectSigner) SignProposal(chainID string, proposal *cmtproto.Proposal) error
func (s *ObjectSigner) SignVote(chainID string, vote *cmtproto.Vote) error

type ObjectSigningStateSource interface {
    ConsensusSigningStateAt(chainID string, localAddress []byte,
        height int64, round int32) (ObjectSigningState, error)
}
```

`ObjectSigningState` contains the exact chain ID, height, round, local validator
address and index, selected proposer address, and the full native
`cmttypes.ConsensusParams`. The source must read authenticated state for these
coordinates and detach its view under its state lock. It must neither use a
peer's proposer/address/index/extension-enable assertion nor mutate returned
storage concurrently. The adapter immediately copies both addresses and the
parameter slice; primitive parameter values are copied by value. It passes a
copy of its local address into the source. Stale/wrong coordinates or unavailable
state fail before reserving any signature.

The returned full params must pass the pinned Comet `ValidateBasic`; an empty
parameter object cannot silently mean extensions are disabled. This retains
the pinned parameter schema and does not add a PQ key type to that schema.

Proposal authorization requires the local durable signer's address to equal the
trusted selected proposer. Vote authorization requires the object's validator
address and index to equal trusted local membership. Index is checked against
trusted state even though Comet's canonical vote bytes omit it. The existing
PQ registry independently resolves and authorizes the full public-key pair and
epoch on every durable signing call, including retries.

## Full bytes and extension policy

The adapter calls the existing `NewProposalRequest`, `NewVoteRequest` and
`NewVoteExtensionRequest`. It changes none of their complete-message domains or
their ML-DSA-87 AND SLH-DSA-SHA2-256f signing rules. Both pure algorithms use
empty context. Every extension request includes the complete ordinary vote,
including block ID, timestamp, height, round, chain and local validator identity.

Only `state.Params.ABCI.VoteExtensionsEnableHeight` enables extensions. A
non-nil precommit at an enabled height always obtains an extension signature,
including when the extension payload is empty. Prevotes, nil-block precommits,
and disabled heights reject extension content/signatures and acquire no
extension signature. Negative activation height is invalid. There is no peer
boolean parameter. The adapter does not silently trim unwanted extension data.

Input block hashes, address, extension payload and existing signature sizes are
checked before copying. The extension payload retains the existing 1 MiB bound;
nonempty existing signatures must parse as exact candidate envelopes. Existing
signature fields must match the original durable result or the call fails
without overwriting them. Old 64-byte signatures do not become PQ credentials.

## Durability and object ownership

The caller exclusively owns the input object during a call. The adapter first
copies its nested bytes, validates trusted state, and constructs all required
requests. It calls the original `Signer.Sign` for the ordinary vote and then for
the extension. Only after both succeed does it assign the two signature fields.
Proposal follows the same rule with its single signature. No timestamp or other
input field is normalized or replaced to make a conflicting retry work.

Any error, including `ErrSignerDurabilityUncertain`, leaves the caller object
unchanged. A completed ordinary signature is kept private when extension
signing fails; the transient local copy is cleared. The adapter returns only an
error, never a partial result object or raw signature. A caller's own preexisting
fields remain its own input and are not erased on failure.

The existing signer's durable reservation and signature history remains the only
anti-equivocation state. Exact retries and restart resume that history. An
extension reservation binds its exact bytes to the prior ordinary precommit.
If a failure occurs before an extension reservation becomes durable, there is
no claim that those as-yet-unreserved extension bytes have been signed. Once
reserved, conflicting extension bytes fail even if no signature was emitted.

Copied `ObjectSigner` handles share one operation mutex and the same `Signer`.
The adapter copies local signer authority under the signer's mutex, releases it,
and then calls `Signer.Sign`; it never recursively holds that mutex. The original
signer's guard still protects direct calls made elsewhere, but callers should
route engine object signing through this adapter rather than mix concurrent
raw requests into a two-phase object operation. Such interleaving may cause a
guarded failure and does not publish a partially signed object.

The caller continues to manage the underlying signer's lifetime with
`CreateSigner`/`ResumeSigner`/`Close`. This adapter does not expose its underlying
signer, a new raw signing callback, private keys, or a second reservation store.
Lost or rolled-back signer state still cannot be recreated as a recovery method.

## Verification scope and remaining integration

Tests use generated real candidate keys and actual durable temporary files.
Coverage includes protobuf object roundtrips and dual verification; proposal,
prevote, precommit and empty/nonempty extensions; trusted source/proposer/index
and activation checks; full vote tampering; H/R/step conflict/replay; repeated
pre-rename and UNKNOWN failure; restart with retained signatures; every extension
write phase; unchanged objects on failure; and copied-handle concurrency.

Suggested focused remote CI invocation:

```sh
go test -p 1 ./internal/ynxconsensusauth -run '^TestObjectSigner' -count=1 -timeout=120s
```

The object protobufs can carry candidate signature bytes, but stock Comet's
64-byte signature validation and existing remote-signer message bounds have not
been changed. `ObjectSigner` intentionally has no `GetPubKey` and does not claim
to implement stock `PrivValidator`. No synthetic Ed25519 key represents the PQ
pair. A real fork must still integrate key types, validated object/wire size
bounds, proposer/validator-state sourcing, consensus engine signing/verification,
authenticated transport, evidence, light-client verification and upgrade rules.
Source tests or durable local signatures are not evidence of network consensus
or public finality.

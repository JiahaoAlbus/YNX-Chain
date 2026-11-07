# YNX Comet engine key/verifier slice R1

Status: implemented, not compiled or executed locally. No node, public activation,
genesis rewrite, root module edit or deployment is included.

This is the repository-owned copy of CometBFT v0.38.23,
commit feb2aea4dc271d612129afc958cb844713ec792b, from the existing Go module cache.
The immutable original 1,399-file SHA inventory is YNX_UPSTREAM_SOURCE.sha256;
YNX_UPSTREAM_PROVENANCE.json records the original module sums and source. The
module cache was not edited. The upstream LICENSE remains intact.

## Actual code paths

- crypto/ynxpq implements an immutable full public key, using exactly the frozen
  ynxconsensusauth LogicalPublicKey/v1 bytes. It binds both full public keys,
  original validator address, genesis, chain, epoch, effective height and
  registration hash. PubKey.Bytes returns this entire binding. ValidatorSet
  hashing therefore commits to it through SimpleValidator, not an abbreviated
  key or a new hash-derived validator identity.
- crypto/encoding and tendermint.crypto.PublicKey field 3 (ynx_dual_pq) transport
  this complete key. The generated oneof methods and registered gzip descriptor
  were updated together with keys.proto. cmtjson uses ynx/PubKeyDualPQV2.
- Actual consensus.defaultSetProposal uses Proposal.VerifySignature, retaining
  the original proposal type before canonicalization. Actual Vote verification
  supplies the full vote, rejecting negative index and illegal extension
  metadata. Commit/evidence canonical verification enters the same full key.
  Vote extension callers pass the full ordinary vote and extension, preserving
  BlockID/time/address/type binding.
- The exact frozen YNX-CONSENSUS-MESSAGE/v0.2 and SIG/v0.2 domains are used.
  The real CIRCL ML-DSA-87 and SLH-DSA-SHA2-256f verifiers both run; acceptance is
  their conjunction. There is no transaction batch signature, prehash, alternate
  context, v1 fallback, digest-only key, fake provider or extension-as-vote path.
- JSON/proto/DB decoding grants no authority. The per-instance Authorizer must
  authenticate the full binding against an immutable committed history and
  independently pinned activation policy for the actual H/R/kind. Nil rejects.
  ValidatorSet.WithConsensusAuthorizer returns a detached set, including a copy
  of the upstream-aliased Proposer, without changing hash or mutating its source.
- Legacy 64-byte signature and 109-byte commit-sig constants remain unchanged.
  Larger signatures are admitted structurally only as the exact 54,534-byte v2
  envelope; actual key verification still decides authorization and validity.
  CreateProposalBlock now budgets at least the actual lastCommit protobuf size,
  retaining the old reservation as a floor. A commit exceeding the configured
  block limit fails explicitly; MaxTxBytes is reduced rather than silently
  exceeding the block limit. No transport or block cap is increased.
- The validator type is known as ynx_dual_pq_v2 but the default key allowlist is
  still Ed25519 only. No PQ ValidatorUpdates or activation schedule are emitted.

## Fixed integration requirements

Root module integration, owned by the parent:

    replace github.com/cometbft/cometbft => ./third_party/cometbft

The fork requires Go >=1.25.0 for CIRCL v1.6.5. Its x/crypto v0.55.0,
x/net v0.58.0, x/sys v0.47.0 and x/text v0.41.0 match the existing production
root versions; their recorded checksums were copied from the actual root
go.sum, not invented. Root currently selects its own Go 1.25.13 toolchain.

Required authoritative adapter:

    AuthorizeConsensusKey(binding []byte, height int64, round int32, kind ynxpq.Kind) error

It must enforce the pinned genesis, committed schedule and step policy, call
KeyHistory.AuthenticatePublicKeyBinding at the actual historical height, and
check actual historical full membership. Binding this to loaded current,
last-height, evidence and light-client validator sets is required. The generic
callback and a green cryptographic package are not an engine activation.

## Validation to execute on a fixed remote CI commit

From the root after its replacement:

    go test github.com/cometbft/cometbft/crypto/ynxpq github.com/cometbft/cometbft/proto/tendermint/crypto
    go test github.com/cometbft/cometbft/crypto/encoding github.com/cometbft/cometbft/types github.com/cometbft/cometbft/state github.com/cometbft/cometbft/consensus
    go test ./internal/ynxconsensusauth ./internal/consensus

The new tests use actual independent CIRCL keypairs/signatures and exercise
actual Vote/Commit/Proposal/extension verification, either-branch corruption,
cross-genesis/chain/type/epoch refusal, preactivation/revoked-height refusal,
historical acceptance, immutable outputs, no authority through serialization,
detached proposer isolation, proto reflection/schema/oneof equality, legacy
signatures and actual commit-size accounting. They have not yet run.
Root-level interoperation tests must additionally compare SigningBytes and
successful ObjectSigner envelopes directly against the frozen root package.

Local checks completed: gofmt parses changed Go sources; a static internal
import traversal found no cycle; generated descriptor readback contains fields
1/2/3 with the original upstream options retained. These are not Go test passes.

## Remaining engine work

The committed activation schedule/profile and registry root must enter the
application commitment and actual header-consensus policy. Registration
EffectiveAt is not engine activation. Original Ed history must remain valid at
old heights. Params/validator updates require the real H+1/H+2 sequence and
must match the new full-key validator hash; the old bootstrap fixed Ed hash
cannot be retained forever.

PrivValidator/ObjectSigner, remote signer transport (currently stock 10 KiB),
trusted source attachment during each state/light/evidence load, cross-rotation
light trust, extended-commit block sync, state sync and bounded large-extension
transport remain incomplete. This slice leaves the stock 1 MiB consensus/WAL
and other caps unchanged. The maximum 1 MiB extension plus PQ signatures cannot
be claimed to fit those envelopes. Actual multivalidator, remote-signer,
restart, state-sync and cross-activation light-client tests have not run.

The public authoritative_producer source is not proven historical CometBFT.
No old Commit is fabricated. Original native genesis/data/history identities
remain distinct from the independently pinned Comet bootstrap genesis.

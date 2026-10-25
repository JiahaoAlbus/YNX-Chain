# CometBFT PQ engine integration R2 — source-backed implementation boundary

Status: read-only source audit and implementation plan. This document is the sole new write in this handoff. No Go/module-cache/go.mod edits, compilation, tests, nodes, deployment, staging or commits were performed for it. Existing package tests do not establish engine activation. The plan is not authorization to deploy or to raise network limits.

## 1. Audited identity and evidence scope

YNX source root (YNX): /Users/huangjiahao/.codex/worktrees/ynx-pq-public-upgrade/YNX Chain

YNX HEAD at this handoff: 6a3b8f813bcc5a2ee8ab0280783b6ebddf3d9c71. The worktree is shared and can contain concurrent owner changes; HEAD alone is not a claim that every inspected working file is committed in that revision. Source references below identify the inspected implementation and functions; line numbers are navigation aids.

Comet source root (CMT): /Users/huangjiahao/go/pkg/mod/github.com/cometbft/cometbft@v0.38.23

The complete module source is present on disk. YNX/go.mod:7 requires github.com/cometbft/cometbft v0.38.23, with no replace directive; go.mod:106 names the stock Comet command as a tool. Local available identity:

| Identity | Value |
| --- | --- |
| Module | github.com/cometbft/cometbft v0.38.23 |
| go.sum module content checksum | h1:jtCe5Do4EcHVf/FCyZMvkBm+AmsRGGyvswImXYAabdM= |
| go.sum go.mod checksum | h1:jtH//cs5e2U5dNiaYIPMBwWXZsedXJfIie77gVhuRaA= |
| Cached origin VCS / URL | git / https://github.com/cometbft/cometbft |
| Cached origin commit | feb2aea4dc271d612129afc958cb844713ec792b |
| Cached origin ref | refs/tags/v0.38.23 |
| Cached module timestamp | 2026-05-08T14:02:33Z |
| Origin metadata file | /Users/huangjiahao/go/pkg/mod/cache/download/github.com/cometbft/cometbft/@v/v0.38.23.info |

These checksums and origin fields were read from go.sum and the local cache metadata. No Go checksum command, upstream fetch or rebuild was performed; the cached origin is not presented as a freshly fetched upstream verification. A source-controlled fork must independently retain and verify this provenance when it is created.

The previously recorded public endpoint identity in YNX/docs/protocol/evidence/rpc-identity-20261018.json is ynx-chaind build 65efa82e0615, chain 6423, height 1931741, authoritative_producer with blockProductionEnabled=true. It is a recorded observation, not a new live query in this audit. It does not establish historical Comet consensus. Explorer identity likewise cannot establish node-engine identity.

## 2. Current package-to-engine gap

The inspected production internal/consensus, internal/chain and cmd Go source has no ynxconsensusauth import. Actual current boundaries:

| YNX source | Current behavior |
| --- | --- |
| internal/chain/consensus_migration.go:20, validateConsensusValidatorKeyBinding around 360–386 | ConsensusPubKeyTypeEd25519; canonical 32-byte base64 key and SHA256-derived 20-byte consensus address |
| internal/consensus/genesis.go:15 BuildCometGenesis | Casts validator keys to cometed25519.PubKey; default Comet params; initial height is migration.Height+1; migration.StateHash supplies AppHash |
| internal/consensus/key_ceremony.go:61,135 | Uses privval.GenFilePV and Ed25519 inventory metadata |
| internal/consensus/production.go:538,593 | Checks FilePV inventory and emits a stock cometbft start service command |
| cmd/ynx-abci/main.go:19,48 | Separate TCP ABCI server, normally port 26658; not an embedded engine |
| internal/consensus/application.go:185 InitChain | Validates migration and returns AppHash; no validator or parameter update |
| internal/consensus/application.go:559 FinalizeBlock | Returns execution results and AppHash; no validator or consensus-parameter update |
| internal/consensus/state.go:36 CommittedState | Contains account policy and native PQ histories/batches, but no committed validator key registry |

The candidate package already supplies immutable KeyHistory, full-key LogicalPublicKey bindings, registry replay against an independently supplied root, object-domain construction, durable signing and candidate Commit/evidence adapters. These are useful implementation pieces, not engine hooks. RegistrationStateSource and ObjectSigningStateSource still need real implementations. LogicalPublicKey intentionally is not a stock crypto.PubKey; ObjectSigner intentionally is not a stock PrivValidator and has no synthetic GetPubKey.

The independent crypto owner is repairing the ordinary request/genesis binding in signing profile v2. Root identified actual Run12 39086730691 at e908 as the original RED, with both assertions and the same-genesis positive control executed. This document neither duplicates that repair nor claims the new source has passed. The inspected working v2 envelope tag is YNX-CONSENSUS-SIG/v0.2 followed by NUL; its fixed envelope remains 54,534 bytes.

## 3. Fork-required wire and verification closure

All CMT paths in this section resolve against the exact absolute module root in section 1. The module cache remains read-only.

| Boundary | Exact source/function | Required implementation |
| --- | --- | --- |
| Public key codec | crypto/encoding/codec.go:20 PubKeyToProto and :42 PubKeyFromProto | Add a distinct full PQ key type. Current switches only accept Ed25519 and Secp256k1, with 32/33-byte checks. Add strict canonical decoding and JSON registration, not an Ed25519 wrapper. |
| Public key proto | proto/tendermint/crypto/keys.proto:9 PublicKey oneof and generated keys.pb.go | Preserve existing tags and add a distinct field. ABCI ValidatorUpdate, validator sets, remote GetPubKey, RPC and database codecs all use this representation. Pin/regenerate the actual generated code. |
| Validator key allowlist | types/params.go:24–30, DefaultValidatorParams, ValidateBasic | Register the new type and versioned activation rules. The default currently allows only Ed25519; the known map contains Ed25519/Secp256k1. |
| Validator identity/hash | types/validator.go:37 ValidateBasic, :118 Bytes, :159 ValidatorFromProto | ValidateBasic compares Address with PubKey.Address. Bytes hashes only SimpleValidator{PubKey,VotingPower}, because stock assumes address is redundant. New fullkey bytes must authenticate preserved logical address, original genesis anchor, chain, epoch and complete key pair/registration binding. Decode/validation must not accept an unrelated address. |
| Proposal signing / receipt | consensus/state.go:1240 SignProposal and :1903 defaultSetProposal, direct VerifySignature at :1924 | Publish actual selected proposer/H/R and use the object-domain verifier against the trusted profile and registry. Preserve POLRound, block ID, timestamp and proposer selection. |
| Vote signing | consensus/state.go:2364 signVote; types/vote.go:415 SignAndCheckVote | Keep WAL FlushAndSync before signing, actual membership/index, H/R/type, nil-vote behavior and extension-enable decision. Reuse the same durable H/R/S authority; do not create a second signer history. |
| Received vote | types/vote.go:222 verifyAndReturnProto, direct VerifySignature at :228; types/vote_set.go:157 AddVote | Preserve H/R/type/index/address checks, conflict handling and voting power. Route genuine PQ verification before counting. |
| Vote extension | types/vote.go:246 VerifyVoteAndExtension, :267 VerifyExtension, direct verification at :258/:273; consensus/state.go:2206 | Bind the full original vote plus extension using the independent PQ domain. CanonicalVoteExtension in proto/tendermint/types/canonical.proto contains only extension/H/R/chain: it cannot reconstruct BlockID, timestamp or ordinary vote type. A bytes-only crypto.PubKey implementation is insufficient for the selected object protocol. |
| Commit verification | types/validation.go:28 VerifyCommit, :62/:75 light variants, :126/:142 trusting variants, :390 verifyCommitSingle | Route the actual reconstructed vote object through height-specific authorization. Preserve absent/nil/commit distinctions, duplicate guards, exact block/height and strict quorum conditions. Do not replace trusting verification with a full-current-set quorum check. |
| Batch dispatch | types/validation.go:15 shouldBatchVerify; crypto/batch/batch.go | Stock batch supports specific existing key types. PQ must fall back to real per-object dual verification unless a separately implemented and verified batch verifier exists. No advertised fake BatchVerifier or transaction-batch reuse. |
| Duplicate-vote evidence | evidence/verify.go:17 Pool.verify and :168 VerifyDuplicateVote; direct signature calls :220/:223 | Use evidence-height membership, keys/profile and original block time; retain age, voting power, equal H/R/type and distinct BlockID requirements. |
| Light-client-attack evidence | evidence/verify.go around :111/:124/:136 | Preserve common/trusted-header checks, trusting quorum and full new-set checks, including all-signature variants where stock requires them. |

The fork should expose narrow object-verification/context interfaces that have no dependency on YNX internal packages. The YNX adapter implements those interfaces with ynxconsensusauth. A global mutable registry singleton is not an acceptable historical or concurrency model.

## 4. A real committedRegistry and authenticated activation

### Required application state

Add a versioned validator-auth state to the actual application committed schema and execution clone: original genesis anchor, chain ID, full immutable operation history, authenticated root, activation schedule and required migration provenance. Commit/persistence/restart/history replay must preserve them together. Older serialized states and their AppHash must retain their original hashing path; do not retroactively reinterpret them with the new schema.

Registration, rotation and revocation must be real state transitions with canonical operation bytes and execution results. For registration approval at execution height H, RegistrationStateSource must resolve the actual historical validator membership/power and authorized old key at H. Operation payloads and unverified RPC responses are not that source. Validate old authority and both new-key proofs; append to a candidate KeyHistory; publish only after the actual application commit. CheckTx/PrepareProposal/ProcessProposal may read immutable committed state or operate on independent candidates and may not publish it.

Validator operation history must be append-only and replayable; engine startup and state sync must reject missing history, mismatched roots, wrong genesis and downgraded profile. Key retirement does not restore classical signing authority. Historical verification continues to use the rules valid at the signed height, including before a later rotation or revocation.

### Root and schedule must be authenticated by a trusted header

CMT/types/params.go:272 ConsensusParams.Hash currently hashes only HashedParams{BlockMaxBytes,BlockMaxGas}. CMT/light/rpc/client.go:249 accepts RPC params by comparing that hash with the trusted header's ConsensusHash. Validator key type, vote-extension activation height and any newly added registry metadata are not automatically authenticated by that mechanism.

Recommended minimal fork contract: add an explicit versioned AuthParams commitment to the consensus-parameter protobuf/HashedParams and to Hash, containing the original genesis binding, profile/activation schedule and the committed registry checkpoint/root with its effective height. With AuthParams absent, legacy HashedParams marshaling and hash must be byte-identical. Mirror the complete registry/history in application state and its AppHash, and cross-check the engine commitment with the committed application checkpoint during handshake/replay. Define effective-height semantics before writing the patch.

An alternative is to authenticate the registry and schedule solely through a verified AppHash inclusion proof. The current application Query JSON is not such a proof. Choosing that alternative requires an actual commitment/proof construction, verification by light/state-sync consumers and historical membership proofs; copying root fields into RPC or snapshots is insufficient.

Keep the normal Comet AppHash lag explicit: state after execution H is authenticated in the later header carrying that AppHash. The root/checkpoint height carried in AuthParams must name that committed state precisely. Do not compare a newly finalized but uncommitted root with an earlier header as if they were the same checkpoint.

### H+1/H+2 ordering

CMT/state/execution.go:598 validateValidatorUpdates checks the new key type against the current ValidatorParams. updateState around :624–647 applies validator changes to H+2; parameter changes around :655–669 apply at H+1. A type added by the same FinalizeBlock response cannot be assumed to authorize that response's validator updates under the prior allowlist.

For activation at A, one minimal staged sequence is:

1. Before A, commit the full validated registration history and required profile/schedule under the old authorized consensus.
2. At A−3, commit params enabling decoding/allowlisting the new key type and the authenticated future activation schedule. The update takes effect at A−2. Merely allowing the type must not activate PQ signatures early.
3. At A−2, emit the actual full-key validator updates, validated against the now-effective allowlist. They take effect at A.
4. At A, signing and every verification path require the designated PQ profile for the actual height. The A block's LastCommit still concerns A−1 and follows the historical preactivation rule. A validator missing usable registration/key state fails closed; there is no automatic Ed25519 fallback.

This is an implementation sequence to validate, not an already deployed schedule. Exact membership changes, initial-chain bootstrap and later epoch transitions must obey the same effective-height accounting. Retain CMT/state/store.go LoadValidators/LoadConsensusParams history needed by evidence, replay and light verification.

## 5. Public interfaces that can be reused, and lock boundaries

CMT/types/priv_validator.go:15 defines GetPubKey, SignVote and SignProposal. CMT/node/node.go:267 NewNode accepts a custom PrivValidator and ClientCreator; CMT/proxy/client.go:35 NewLocalClientCreator accepts the existing Application. These are useful public injection points. They do not bypass the missing key codec, object verifier and committed-registry work.

Minimal first engine adapter: a new candidate command embeds the existing durable YNX Application with NewLocalClientCreator and the fork engine. It injects a real local PQ PrivValidator wrapper with the full registered public identity and the existing durable ObjectSigner. Existing business execution is reused, not copied into a parallel ledger.

The current separate TCP ABCI process cannot directly implement an in-process engine-state interface. Retaining that deployment shape instead requires an explicitly authenticated state-view mechanism. A peer-provided proposer, validator list or extension flag is not trusted state.

Lock/publication contract:

- The engine creates an immutable, deep-copied H/R snapshot containing original genesis, chain, actual selected proposer, validator address/index/set and historical consensus params/registry checkpoint while holding its consensus-state mutex.
- Publish the detached view before invoking the signer, or make it available by immutable generation. ObjectSigningStateSource reads it without reacquiring the consensus mutex already held by the caller. Never hold the app/persistence mutex while calling back into engine methods that acquire the reverse lock order.
- RegistrationStateSource uses committed historical engine membership and the matching committed application registry checkpoint, with explicit height/generation equality; it cannot silently use a changing current set for historical requests.
- Application candidates remain detached. The durable app commit and engine handshake/replay must reconcile the exact root and height before a new signing generation is exposed. A crash between the app and engine stores must be recovered through that reconciliation; it is not a two-store atomic-write claim.
- Ordinary and extension signatures share the existing durable signer authority. If either stage fails or is UNKNOWN, do not mutate the original caller object into a partially signed success. Preserve the exact request identity for recovery.

CMT/node/node.go:333 overrides an injected signer when PrivValidatorListenAddr is configured. First-stage local-only integration must explicitly reject that configuration instead of accidentally falling back to stock remote handling. CMT/node/setup.go:64 DefaultNewNode uses LoadOrGenFilePV; default key generation remains Ed25519 until the candidate command/key ceremony explicitly replaces it.

Node P2P node_key/secret-connection authentication is a separate transport boundary. A PQ validator signature patch does not by itself upgrade that transport cryptography.

## 6. Remote signer, light client and sync closure

### Remote signer

CMT/privval/signer_endpoint.go:95 limits one remote message to 10 KiB, already smaller than a single PQ signature envelope. CMT/privval/signer_client.go:108 and :130 replace the complete original vote/proposal with the returned object. GetPubKey at :85 uses the stock two-type codec. proto/tendermint/privval/types.proto has no selected PQ profile/genesis/key-epoch negotiation. node/setup.go:614 wraps the client in retries (50 attempts, 100 ms interval).

Both endpoints need the new fullkey codec and bounded profile-aware framing, authenticated original genesis/profile negotiation, exact unsigned request/response equality checks and trusted state sources. Network retry is not permission to change H/R/S, timestamp, extension or key epoch after UNKNOWN. Reconcile the original durable request; do not introduce an independent remote H/R/S journal that can disagree with the signer. Local signer closure may precede remote support, with remote mode explicitly unsupported until its tests pass.

### Light client and state sync

CMT/light/verifier.go:32 VerifyNonAdjacent first verifies a trusting quorum against the old trusted set, then a full quorum against the new set. VerifyAdjacent around :87 verifies the prior NextValidatorsHash binding. Stable logical address does not make a newly rotated key a valid signature under the old trusted key. The minimal safe initial behavior is to force adjacent verification through profile/key-epoch transitions; nonadjacent jumps across them need an authenticated transition proof, not a new RPC key substituted into the old trust set.

CMT/statesync/stateprovider.go:89 authenticates AppHash via a later light header, and State around :125 loads H/H+1/H+2 validator sets and consensus params. The snapshot must carry the full registry/history and validate against an independently authenticated root/anchor. History replay must have the authentic membership source for each approval height. Missing retained membership evidence is a real state-sync blocker, not a reason to trust snapshot-supplied approval metadata.

CMT/blocksync/reactor.go:505 verifies the ordinary commit. For extended commits it calls EnsureExtensions and at :522 verifies extCommit.ToCommit(). ToCommit strips extensions; the latter call does not cryptographically verify extension signatures. The fork must verify the full extension object against original vote context and historical params before persisting the extended commit.

## 7. Real byte boundaries and bounded profile

The inspected v2 envelope has ML-DSA-87 signature 4,627 bytes and SLH-DSA-SHA2-256f signature 49,856 bytes, plus framing: 54,534 bytes total. Both full public keys occupy 2,592+64 bytes before identity/framing. One ordinary precommit plus its independent extension signature needs 109,068 signature bytes before extension payload and protobuf framing.

| Boundary | Source / actual current value | Required check |
| --- | --- | --- |
| Signature | types/signable.go:12 MaxSignatureSize=64 | Proposal.ValidateBasic, Vote.ValidateBasic, CommitSig.ValidateBasic and ExtendedCommitSig.ValidateBasic all need height/profile-aware acceptance. |
| Commit reservation | types/block.go:597 MaxCommitSigBytes=109; :608 MaxCommitBytes; MaxDataBytes | Recompute the actual protobuf upper bound for the supported validator count/profile. Leaving the old reservation can overfill a block even if individual signatures decode. |
| Consensus P2P | consensus/reactor.go:30 maxMsgSize=1,048,576 | Measure complete proposal/vote/extension messages. |
| WAL | consensus/wal.go:25 maxMsgSizeBytes=maxMsgSize+24; writer :318, reader :385 | Reader and writer must support the same actual serialized message profile and reject overflow. |
| Extension payload | types/vote.go:19 extension size limit=1 MiB | The existing maximum payload plus two PQ signatures exceeds the current consensus message cap. Choose a bounded payload profile or an explicit versioned transport change. |
| Evidence | evidence/reactor.go:19 1 MiB; types/params.go default Evidence.MaxBytes=1 MiB | Measure duplicate-vote and light-attack evidence with full validator sets; do not budget only two signature arrays. |
| Remote signer | privval/signer_endpoint.go:95 10 KiB | A single PQ response already fails; both endpoints require a bounded supported profile. |
| Block | types/params.go default 22,020,096 bytes, hard MaxBlockSizeBytes=104,857,600 | Include actual commit overhead and bounded validator count; voting-power caps are not validator-count caps. |
| Block sync | blocksync/msgs.go:16 bound derived from maximum block plus framing | Include extended commit carried outside the block; do not assume the block-only bound covers it. |
| State sync | statesync/messages.go:14 snapshot metadata 4,000,000 bytes; :16 chunk 16,000,000 bytes | Bound registry history/chunks before allocation and verify the final authenticated history/root. |
| RPC / JSON | Validator/commit/block key and signature representations grow substantially; stock RPC request body default is 1,000,000 bytes | Audit actual client/server limits and base64 overhead separately. No silent read truncation, no claim that a successful pure decoder proves a network submission. |

Do not raise every cap. First freeze a profile with maximum validator count, extension payload, evidence and registry-history ingress, then use actual protobuf/RPC serialization at the exact boundary and one byte beyond. Generated protobuf decoding may allocate before ValidateBasic, so frame limits must precede decode and strict envelope limits must follow it.

## 8. Repository-owned fork and minimal review sequence

No fork copy or go.mod change is part of this document. When separately authorized, create an isolated repository-owned fork from the exact upstream origin above; retain upstream license, commit/checksum evidence, patch manifest and pinned protobuf tooling. Keep the Comet module import identity and pin the chosen fork revision or tracked local source snapshot explicitly. Never patch the shared Go module cache. Do not copy a second consensus engine into internal/consensus.

Suggested independently reviewable order:

1. Finish the original owner's v2 genesis/HRS repair against the preserved actual RED and fixed-SHA remote tests. No new engine claim follows from that PASS alone.
2. Specify and implement the real committedRegistry, historical membership source, activation/root commitment, atomic application persistence and replay/handshake reconciliation. Freeze old-state hash compatibility and effective-height rules.
3. Fork the fullkey type, proto/JSON codecs, validator hash/identity validation and versioned AuthParams hash. Test old bytes/hashes plus complete new-key roundtrips through genesis, ABCI, RPC and state storage.
4. Add narrow object-verification interfaces and wire every proposal/vote/extension/Commit/evidence/light/blocksync site. Keep legacy historical verification unchanged before activation. Complete the size reservation and framing profile needed to make those objects admissible.
5. Add the repository-owned candidate node command using the public NewNode/local Application interfaces, the actual local PrivValidator and detached state publication. Explicitly prohibit unsupported remote configuration.
6. Implement both remote-signer ends, exact response/request binding and original-identity UNKNOWN recovery. Complete RPC/WAL/state-sync histories and authenticated light transition behavior.
7. Only after fixed-source correctness closure, run actual isolated multi-node activation and fault tests; evaluate performance separately on the same identified artifact/profile. No time-to-upgrade guarantee is established here.

Potential YNX write areas in that later phase: new internal/consensus/engineauth adapter files, a new candidate node command, committed-state/application/genesis/migration integration, and the owned fork plus its generated code. Precise ownership must be assigned before edits. Existing account PQ execution and transaction Whole are reused for their original roles; future consensus votes never reuse transaction-batch authority.

## 9. Original genesis/history and remaining validation gates

The recorded public source is authoritative_producer, not proven historical Comet. Preserve original genesis bytes/hash, source checkpoint height/hash, all business data and original authorization history. Preserve the original height-specific verification rules. A Comet cutover may start at source.Height+1 with a genesis record anchoring the exact imported checkpoint, but must not fabricate Commit records for earlier source blocks or claim those blocks acquired retrospective BFT finality. Preserve the distinct original-genesis and candidate-Comet-genesis identities explicitly.

For an existing actual Comet history, retain original genesis, block/validator/consensus-param storage and preactivation signature/hash rules. At activation, select the protocol by the signed object's historical height, not by today's active profile. Evidence and historical queries must continue to verify old heights without reinterpretation by future key retirement.

Still unverified in this handoff:

- Actual nodes using the new fullkey and object verifier; mixed-version upgrade behavior and fail-closed old nodes.
- H−1/H/H+1 activation and restart, key rotation/revocation, wrong genesis/chain/epoch, one-bad-branch rejection, and historical evidence.
- Proposer changes, rounds, partitions, missing validators and genuine quorum/liveness behavior under larger signatures.
- Local/remote signer crash and UNKNOWN recovery, WAL replay, exact response matching and no double signing.
- Block sync including full extensions; state sync including authenticated complete registry history; adjacent/nonadjacent light verification through transitions.
- Complete maximum-size messages, storage growth, RPC transport, actual latency and throughput.

These require fixed-source tests and actual multi-node/remote/light-client runs. Pure package green, ABCI green, configuration generation, or source inspection alone does not satisfy these gates.

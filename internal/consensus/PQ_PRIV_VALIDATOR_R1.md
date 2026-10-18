# Actual PQ private-validator adapter

Source slice based on `66d29db440c7e3864ec855734f77bf5a0ae65ee2`. This slice implements the fork's actual `types.PrivValidator`, `HeightPrivValidator` and `ConsensusSigningContextSetter`; it is not proof of a running BFT network or remote key custody. No local Go build, test, node or benchmark was run. Its Go tests are intended for the next fixed normal CI head with the matching engine-source/caller leaves.

## Construction and actual consumers

```go
registry, err := NewPQCommittedSignerRegistry(source, independentBootstrap)
signer, err := ynxconsensusauth.ResumeSigner(existingStatePath, existingKey, registry)
pq, err := NewPQPrivValidator(signer, source)
pv, err := NewPQTransitionPrivValidator(originalLegacyPV, pq, independentBootstrap, independentSchedule)
```

`source` implements `CommittedPQEngineSnapshot() (*PQEngineSnapshot, error)`. Production sources are the in-process `Application` and `PQEngineFileSource`. The file source must first receive the engine's exact trusted Comet height/AppHash through `ConsensusAuthorityForState`; the adapter never primes it from a self-reported file checkpoint. Node construction consumes `pv` through `NewPQConsensusNode`; actual engine callers obtain `GetPubKeyForHeight(chainID, H)` and then call `SetConsensusSigningContext(chainID, H, R, actualValidatorSet)` before signing.

The constructor does not create or reset H/R/S state or generate identities. `Signer.Identity` copies only policy/genesis, original address, epoch and the two complete public keys under the existing signer/key locks. Closed or destroyed handles fail. The new `CandidateKey.RegistrationPossession` is restricted to the original complete registration/rotation new-key PoP domain and matching fresh full keys. It cannot sign an arbitrary message, old-authority approval or consensus vote.

## Startup, historical keys and activation

Node initialization asks `GetPubKey` before handshake. The transition wrapper initially returns the independently authenticated original Ed25519 identity only; no signing method can use that startup exception. The first height-aware lookup, context setter or signing attempt permanently leaves this startup mode. Every later lookup uses fresh committed authority and errors never fall back to the startup key.

At `H < A`, only the explicitly injected original legacy signer is used. At `H >= A`, only the durable PQ signer is used. The activation height is independently pinned and must match the durable signer's policy, genesis and chain. The full PQ binding is resolved from committed history and matches the signer's exact epoch and both public keys. Returning a historical legacy key does not allow signing at an old height: signing requires `H = committedHeight + 1` and the actual engine context.

No classic key is synthesized from PQ material, no registry is supplied by peers, and legacy canonical bytes retain their original historical rules. Old Ed25519 signatures do not retroactively contain genesis. This adapter does not import private keys, solve cross-process key custody, or introduce a second signing history.

## Locking and failure behavior

The engine supplies its actual selected proposer and priorities while holding its own state lock. The adapter binds the full set through `PQEngineSnapshot.BindValidatorSet`, saves a detached bounded view, and never calls back into the engine lock. A failed context setter clears the previous context. Sign operations refresh committed state, check the precise H/R and original local address/index, and rebind the set before the existing `ObjectSigner` runs. Proposer selection is never reconstructed from a sorted membership list.

PQ handles and transition-wrapper copies share their operation mutex/context. The lock order is transition -> adapter -> ObjectSigner -> durable Signer -> key; committed sources must not acquire the engine lock. `Signer.Identity` releases its lock before signing starts. One bounded observed committed height/root/schedule guard rejects source regression or a conflicting same-height authority; this is not an alternative H/R/S store. Cold anti-double-sign safety remains in the original durable state, whose rollback protection still requires trusted storage.

`ObjectSigner` reserves and persists the ordinary signature and enabled extension through the original signer. Even an empty enabled non-nil-precommit extension must complete; no new signature is published until both stages succeed. A failed read, stale set, pre-rename reservation failure, conflicting retry or second-phase failure leaves the caller's object unchanged. UNKNOWN cannot be treated as a new request or erase the original reservation. The adapter adds no arbitrary signing callbacks or verified flags.

## Validation sources and limits

`TestPQPrivValidator*` uses newly generated `CandidateKey` handles, true dual PoP, original Ed25519 registration approval and actual ABCI Finalize/Commit to create the committed registry/schedule. It exercises:

- Actual fork Proposal/Vote/extension verification and protobuf roundtrip; invalid branches, altered full objects and wrong chain rejection.
- Cold exact retry with byte-identical signatures, timestamp conflict rejection, wrong proposer/index/address/H/R, nil and old sets, unknown future keys and detached context storage.
- Real filesystem reservation failure with original durable bytes preserved; observed authority rollback and destroyed-key failure.
- Real original `FilePV` signing before A and full PQ after A; no fallback after signer closure.
- Real ordinary durable signature followed by a controlled registry failure at the extension stage, proving no partial vote publication; exact original retry completes both signatures.
- Actual file-source startup/handshake boundary and failed context replacement; actual application post-rename UNKNOWN keeps the candidate height unauthorized, preserves original exact retry, and resumes after confirmation.
- Actual node-constructor guards reject wrong genesis, remote override, wrong original validator and missing arguments before database/service creation.

The pre-existing `TestObjectSignerDurabilityFailuresNeverMutateObjects` and `TestObjectSignerExtensionSecondPhaseFailureNeverLeaksPartialVote` remain the direct signer-write UNKNOWN injection tests. The new adapter test does not relabel a controlled registry error as a real filesystem UNKNOWN. Normal successful node construction needs a matching real Comet state/blockstore; these guards do not claim that construction or node startup passed.

Focused selectors:

```sh
go test -p 1 -count=1 ./internal/ynxconsensusauth -run 'Test(SignerIdentity|CandidateRegistrationPossession|ObjectSignerDurabilityFailures|ObjectSignerExtensionSecondPhase)'
go test -p 1 -count=1 ./internal/consensus -run '^TestPQPrivValidator'
```

The latter package must include the simultaneously owned `pq_node.go`, actual file/application source and fork engine interface changes. Keep the frozen `ynxbatch` parallel-provider implementation and existing wire formats untouched.

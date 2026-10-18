# Production certificate-cache consumer, R1

Source candidate; this consumer and its new tests/benchmark have not run locally.
The earlier pure cache was actually tested in CI run 39096249974. Its warm-cache
microbenchmark is not a measurement of this consumer, ledger TPS or finality.

## Actual consumers and default admission

- Devnet transfer/action members use `VerifyDecodedMember` with the member they
  have already strictly decoded. N=1 bypasses the shared cache and policy-root
  computation. N>1 can reuse a certificate across distinct members.
- Source Whole authentication shares the same instance for N>1; N=1 bypasses it
  because source replay reconciliation precedes verification and there are no
  repeated proposal stages.
- ABCI member admission uses the parsed member and the same N=1 bypass. ABCI
  Whole admission, including N=1, uses the application instance across CheckTx,
  PrepareProposal, ProcessProposal and FinalizeBlock. Business simulation still
  runs on detached state at every stage.
- Source snapshot history uses one temporary holder for the complete validation
  pass, including members, actions, contract actions and shared Whole proofs.
  ABCI member/Whole history likewise uses one temporary holder per pass. These
  holders never survive as persisted authorization state.
- Existing public wire-verification APIs and historical wrappers remain usable.
  The new typed auth API still validates current policy, full certificate, owner,
  full message, both real signatures (unless exact successful cache hit), and
  both membership paths. It exposes no verified flag or signer callback.

## Trusted scope and bounded ownership

`PQCertificateCache` is a disposable Devnet/Application field, never part of
JSON, AppHash, snapshot, authoritative history, or a public receipt. It lazily
owns a 16-entry pure certificate LRU (at most 1,114,112 retained key bytes).
The holder keeps exactly two policy memo slots and at most two lazy root objects.
There is no growing map keyed by execution clones or retained policy JSON copy.

Scope is SHA-256 of the original four-byte E framing of the local domain
`YNX-ACCOUNT-POLICY-CERTIFICATE-CACHE/v1` and complete typed policy JSON. Empty
records/revocations normalize to nil consistently with `State.Clone`; this
normalization does not alter persisted JSON or consensus hashing. Full network,
all immutable records, and terminal tombstones are included. Only local trusted
state supplies this root. Certificate caching also binds its own complete
certificate and freshly resolved registration; scope is not sufficient authority.

`ClonePolicy` creates the clone itself and shares only a lazy root object. It
does not accept an external target or a submitted root. Legacy and ordinary N=1
clones do not compute a root. A shared certificate computes the complete root
once while retained, then subsequent trusted clones reuse it. The fixed two-slot
memo may evict under concurrent distinct candidates; recomputation is safe.
Version, network, enable-height and record/tombstone counts detect legal in-place
append transitions. Existing records/tombstones remain immutable. Load or
same-shaped replacement must call `Invalidate`; Root's constructors, source
load/migration/revocation and definite rollback hooks provide this boundary.
UNKNOWN retains its original business state; invalidation never resets it.

Every signature success hit still refreshes full keys and current policy at the
actual requested height. Activation and revocation are not frozen in the cache.
Provider work is outside the holder mutex. Duplicate concurrent misses may each
verify independently; ordinary transactions never wait to form a batch.

## Required integration group

Root-owned `Devnet` and `Application` fields/constructors must instantiate the
holder. `Application.cloneExecutionState` must call its `ClonePolicy`; source
snapshot application and revocation replacement/rollback must invalidate it.
The current `sealCommittedState` makes a new plain policy clone: the first
shareable proof after that Commit can recompute a root. This is a performance
boundary, not permission to reuse a root for an untrusted external object.

The two new contract branches in `account_policy.go` must land together with the
complete `CommittedState.Validate` contract validator and contract dispatch.
They retain common metadata/height/replay gates; only the complete contract
validator may verify the contract-specific receipt, fee lots and final state.
No source contract replay, identity, log or continuation assertion was relaxed.

## Focused validation and bounded comparison

The frozen old authentication consumer is the implementation at
`internal/ynxauth/policy.go` Git blob
`11df5a27179a3020d293d3686e4b15af23b26e5b`, present at
`a50f7bc4fd28ca5a17780c1be674c54c66657c1b`. A test-only copy preserves its repeated
decode for direct old/new comparison; it cannot become a production verifier.

Root's normal remote CI can use these selectors; no local Go execution occurred:

```sh
go test -p 1 -count=1 ./internal/ynxauth -run 'Test(Member|DecodedMember)CertificateCache'
go test -p 1 -count=1 ./internal/chain ./internal/consensus -run '^Test(PQCertificateCache|ABCICertificateCache)'
go test -p 1 -run '^$' -bench '^BenchmarkPQCertificateConsumer$' -benchtime=10x -benchmem ./internal/chain
```

Tests use real test-only keys, source transfer/action/Whole, ABCI proposal stages,
historical field tamper, restart, rotation/height transitions, terminal revocation,
definite rollback and post-rename UNKNOWN. Ordinary N=1 checks explicitly require
zero cache misses and zero root computations.

The consumer benchmark includes strict initial member decode, actual trusted
policy clone and verification. It reports old/new N=1 cold verification, N=16
first-member miss, and all 16 distinct members with one shared certificate.
Each iteration starts cold; reset and fixture signing are outside timing, while
the initial policy-root computation is inside. Two bounded independently signed
fixtures alternate. Observed cache misses/hits/root computations are asserted
and reported. This excludes business execution, durability, network inclusion
and consensus finality; no consumer performance gain is claimed before CI.

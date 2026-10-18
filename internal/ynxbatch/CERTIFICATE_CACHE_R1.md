# Bounded certificate success reuse

Source baseline is `253e5c035fd4438be00fb2204c06e892304ef3d0`. The exact Git
blobs and SHA-256 values are in `CERTIFICATE_CACHE_BASELINE_R1.json`. No local Go
test, compilation or benchmark was run for this slice. Performance numbers remain
pending remote execution. The provider, tree algorithm and YNX-BATCH/v0.1 wire
are unchanged.

The measured target is repeated real ML-DSA-87 **and** SLH-DSA-SHA2-256f
certificate verification by newly constructed member/history verifiers. This
does not accelerate a genuinely new certificate by avoiding its first check.

## API and integration

`ynxbatch.NewCertificateCache(entries int) (*CertificateCache, error)` accepts
1..64. The application owns the instance and its lifetime. There is no global
cache. `VerifierOptions.CertificateCache` selects it;
`VerifierOptions.CacheScope` is required to be exactly 32 bytes whenever a cache
is supplied. The verifier copies the scope. A zero-value cache is disabled and
is rejected as an enabled verifier option.

Use a locally computed digest of the immutable trusted policy state or an
already authenticated root that commits that policy as the scope. Compute it
once per immutable policy snapshot, before walking that snapshot's history.
Never take it from the submitted certificate, an HTTP field or a peer's
unverified root. A changed trusted root must supply a different scope. Sharing
one cache across different scopes is safe and bounded, but will miss.

The existing `State.VerifyMember` API remains uncached and source compatible.
The new account-policy entry is:

```go
state.VerifyMemberWithCache(owner, purpose, fullMessage, memberWire,
    executionHeight, cache, trustedScope)
```

It still validates the complete current `State`, selects trusted registration at
the original execution height, compares the complete application message and
owner, and verifies both membership paths. Callers continue holding their state
lock or providing an immutable state snapshot. No `verified bool`, callback or
importable success handle is exposed by the cache.

Actual integration sites owned by other agents:

- `internal/chain/pq_batch.go`: pass the owned cache and scope to its direct
  `NewVerifier` options; the batch's individual business/state checks remain.
- `internal/consensus/account_batch.go`: same options on its direct verifier.
- `internal/chain/pq_authorization.go`, `pq_action.go`, and
  `pq_action_contract_snapshot.go`: use `VerifyMemberWithCache` for live/historical
  member verification, threading the cache from the application/history boundary.
- `internal/consensus/account_policy.go`: use the same account-policy entry.

Do not serialize this optimization into ledger state, AppHash, snapshots or
replication. Restart begins with an empty cache and full checks. Do not compute a
fresh cache instance per member; doing so cannot share successful certificates.
Conversely, the owner must not reuse a mutable policy object without the existing
state lock merely because its cache is concurrency safe. These caller changes
are outside this pure-package slice and must be tested by their owners.

## Invariants and bounds

The key is exact `E(scope, canonicalCertificate, trustedRegistrationStamp)`.
The full certificate includes protocol version/suite, both full public keys,
network, owner, purpose, batch identity, N, both roots and both signatures. The
registration stamp includes the algorithm version, full keys, network, owner,
purpose, revision, activation and revocation bound. No hash-only, batch-ID-only,
key-only or owner-only cache lookup is used.

Both real provider checks must succeed, then the registration must resolve again
to the same complete stamp, before a success is inserted. Failed parsing,
signature, trust refresh or hasher construction cannot insert. A successful
certificate may be reused even when an independent membership proof was bad;
every such membership proof is still checked anew and cannot become authorized
through this cache.

Every lookup starts after current registration validation. A hit rechecks that
registration again and constructs a fresh issuing verifier's private handle.
Every handle use still refreshes trust and validates both tree paths. Different
height alone does not force cryptographic rework when the same registration is
lawful at both heights; activation and revocation are always checked at the
requested height.

The cache retains at most 64 exact keys, each at most
`MaxCertificateBytes + 4096` bytes: at most 4,456,448 retained key bytes plus
bounded map/list metadata. `Stats` exposes actual retained key bytes, entries,
hits and misses. Existing `Verifier.Stats().SignatureChecks` counts only real
provider branch checks, including zero on a shared-cache hit; its `CacheHits`
counter continues to mean that verifier's own handle-state cache hits.

The mutex protects only lookup/LRU/insertion. It is never held while resolving
policy, hashing a tree or running a provider. Concurrent misses may independently
verify the same certificate; they do not queue for a batch or wait on another
call's signature check. An ordinary N=1 request requires no other request.
`Clear` removes retained successes and fences insertions from prior in-flight
misses. It does not revoke existing verifier handles; `Verifier.Clear` retains
that separate behavior.

## Remote selectors

Focused real correctness, no benchmark:

```sh
go test -p 1 ./internal/ynxbatch ./internal/ynxauth -run 'Test(CertificateCache|MemberCertificateCache)' -count=1 -timeout=90s
```

Retain the existing complete pure-package gates, particularly JS byte-for-byte
interop, ACVP vectors, AND mutations, activation, revocation and contract codecs.
The new correctness tests compare the uncached provider/trust/tree path with the
cache path, including each signature, root, key, message, proof branch, scope,
policy refresh, cold/multiple verifiers, height, LRU eviction and clear fencing.

Bounded initial benchmark (single process, N=1/16/64/1024, fresh verifier each
iteration, real signatures, setup excluded):

```sh
go test -p 1 ./internal/ynxbatch -run '^$' -bench '^BenchmarkCertificateCache$' -benchtime=10x -count=1 -timeout=90s
```

The three modes are `uncached`, `miss`, and `hit`. `uncached` is the current
compatible uncached path using the unchanged frozen provider/tree functions,
not a claim that a whole old checkout was benchmarked. `miss` clears outside
timing, then measures lookup/insertion plus both signature checks. `hit` starts
from a real verified success and still measures decoding, trust refresh, key
construction, fresh handle and member proof verification. Each mode reports
allocations, time and `sigchecks/op`, and asserts 2/2/0 checks respectively.
N is the signed tree's member count, not a throughput or finality claim.

# YNX-BATCH/v0.1 Go candidate

This package implements the original fixed protocol. It does not register an
account, activate a chain upgrade, grant a Wallet session, or replace consensus.
The combination is a research candidate, not a NIST-certified new algorithm.

## Format and cryptography

* Every E field count, field length and protocol integer is exactly four-byte
  big endian. Tags, suite, field order and tree coordinates match the supplied
  original and standalone JS candidate. Decoders reject trailing bytes.
* ML-DSA-87 and SLH-DSA-SHA2-256f both authenticate the complete descriptor through
  separate `CERT/A` and `CERT/B` domains, using the standard pure APIs and empty
  context. Verification requires both. Public key lengths are 2592/64 bytes;
  signature lengths are 4627/49856 bytes.
* SHA3-512 and SHA-512 each hash the complete specified messages, with separate
  trees and original position numbering. Optional prefix reuse serializes and
  restores Go hash state; it does not hash a shared context or transaction digest.
* N is a power of two from 1 through 1024. Single messages, aggregate messages and
  certificates are limited to 1 MiB, 8 MiB and 65536 bytes respectively. Framing
  and proof limits are checked before large data copies or signature operations.

The provider is `github.com/cloudflare/circl v1.6.5`, upstream commit
`cfa7c70defd831ffb0792ab2af560bfef43d60ca`; repository `go.mod`/`go.sum` are owned by
the coordinating agent. This release requires Go 1.25 and the selected module
graph uses `golang.org/x/crypto v0.54.0` and `golang.org/x/sys v0.47.0`.
Sources: https://github.com/cloudflare/circl/tree/v1.6.5/sign/mldsa/mldsa87 and
https://github.com/cloudflare/circl/tree/v1.6.5/sign/slhdsa .

## Call surface

`KeyGen` returns an opaque signer and detached full public keys. `BatchSign`
accepts complete messages already authorized by the caller, creates its own
fresh 16-byte batch ID and returns a private Batch only after both signatures.
`Extract`, `Batch.CertificateWire` and `Batch.WholeWire` return detached public
values. `PrivateKey.Destroy` disables further signing but does not promise
physical erasure of Go/upstream allocations. No key export or recovery format
is defined in this package; the Wallet owner controls protected backup handling.

`NewVerifier` requires a trusted 32-byte chain identifier, purpose and registration
resolver. A resolver must read authoritative state for the supplied execution
height, not use self-reported keys. It must return the complete double-key
binding, algorithm version, policy revision, activation and revocation state.
Resolver callbacks must not reenter the same Verifier.

`AuthenticateCertificate` creates an opaque handle privately tied to the
issuing verifier. `VerifyMember(handle, message, proof, height)`, `VerifyOne` and
`VerifyWhole` refresh the trusted registration. A policy revision/key change,
revocation or `Clear` invalidates existing handles. A bounded LRU (0–64 entries)
stores only successful full-certificate/full-trust matches. Failed signatures
never enter the cache. No public-key or certificate reference format is added.

Verification is safe for concurrent calls on one Verifier; signing is serialized
per private handle. Callers must not concurrently mutate passed byte slices;
doing so is a Go data race. Retained state and returned public values are copied.

Cryptographic membership can be checked repeatedly. It is not an execution
permit or anti-replay check: Chain must still enforce nonce, balance, account
policy, business semantics and historical-height rules. An individual member
does not prove the aggregate size of unseen messages; v0.1 makes the 8 MiB bound
a builder/Whole receiver constraint. Non-atomic transaction semantics remain
the responsibility of the Chain execution layer.

## Reproducible validation

`testdata/js-interop.json` contains only fresh research public keys, signatures,
messages, every node and every proof of an N=8 batch. The generation script uses
Node 26.7.0/OpenSSL 3.6.4 and independently checks both signatures with pinned
Noble 0.6.1. Source hashes are recorded in the fixture. This is not an account
registration or production network identity.

`testdata/nist-acvp.json` copies the published ACVP selection from the independently
versioned JS candidate at NIST ACVP-Server revision
`975de31eb83d87039ec88934fdc47d8c312b892d`: 29 external pure sigVer cases and 35
keyGen cases for the two exact algorithms. Public NIST test seeds are test data.
These primitive vectors include contexts other than empty to test the library;
the YNX protocol itself always supplies empty context. The source manifest is
`testdata/acvp-sources.json`.

After obtaining the shared-machine compile slot:

```sh
GOMAXPROCS=1 GOMEMLIMIT=768MiB YNX_BATCH_INTEROP_OUT="$PWD/internal/ynxbatch/testdata/go-interop.json" go test -p 1 ./internal/ynxbatch -count=1 -timeout=90s
```

The generated Go fixture is public only. Independently verify it through JS:

```sh
node internal/ynxbatch/testdata/verify-go-fixture.mjs "/absolute/path/to/standalone-js-candidate" internal/ynxbatch/testdata/go-interop.json
```

Tests cover real signatures, standard vectors, exact cross-language bytes,
original/prefix tree equivalence, N=1/N=1024, either signature/path rejection,
message reorder/missing messages, strict framing/limits, private-handle rejection,
policy changes, revocation, mid-verification trust changes and cache invalidation.
`FuzzWireDecode` supplies round-trip invariants. Normal `go test` executes only
the seed corpus; an actual bounded fuzz run must be reported separately.

No deployment, installation, consensus finality, real-account recovery or TPS
acceptance is established by these tests. No benchmarks run automatically.

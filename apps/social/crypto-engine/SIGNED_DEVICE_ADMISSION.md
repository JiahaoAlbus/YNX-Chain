# Native signed device admission

Status: implemented and source-composition tested, NOT production-enrolled,
NOT connected to a public directory, NOT activated. This does not complete
the Social cryptographic rebuild or replace the Matrix message protocol.

`VeilSignedDeviceGrantVerifier` implements the existing native
`VeilDeviceGrantVerifier`. Its issuer SPKI and SHA-256 pin must be provisioned
by independently authenticated native enrollment. Never take a new pin from
the grant response, JavaScript, SSO, a Wallet address or a Matrix profile.
Missing enrollment stays unavailable. No default issuer or automatic genesis
is supplied, and no private key is requested from the user.

## Original native caller

Construct the verifier with the existing exact `VeilDeviceBinding`, enrolled
issuer SPKI bytes, independently enrolled lowercase SHA-256 pin, and the same
native monotonic elapsed clock used by `VeilNativeAuthority`. Generate a
request with the original current minimum revocation generation. Submit only
its public bytes to the authenticated directory's admitted device-approval
flow, then pass the returned proof to the original authority's `admit`.

The directory must independently authenticate and authorize the complete
binding and its current revocation state. Signing fields supplied by a client
without that authorization is NOT an implementation of the directory.
This component neither invents nor mounts a directory HTTP endpoint.

## Canonical public wire format

All integers are big-endian. No JSON coercion, UTF replacement, trailing
fields or per-call verification callback is accepted.

Request bytes:

1. ASCII domain `YNX/SOCIAL/DEVICE-GRANT/V2` followed by one zero byte.
2. One version byte, exactly `1`.
3. Owner, device, independent Social identity fingerprint, and key alias,
   in that order. Each is a two-byte length followed by 1-512 printable ASCII
   bytes. Existing native binding validation remains in force.
4. Eight-byte nonnegative signed minimum revocation generation.
5. A fresh native-generated 32-byte unpredictable challenge.

Signed payload: exact request bytes, followed by eight-byte nonnegative
approved revocation generation, one approval byte (`1` trusted device or `2`
user-held recovery), and eight-byte lease duration in milliseconds (1-120000).
Approval must represent the directory's actual reviewed decision.

Proof frame: four bytes `YDV2`, four-byte payload length (1-4096), exact
payload, two-byte signature length (1-144), and DER ECDSA signature over the
entire payload using SHA-256 and the enrolled P-256 issuer key. Whole frame
is bounded to 8192 bytes. The key must be canonical X.509 SPKI and secp256r1;
signature and pin verification use standard JCA, not custom curve arithmetic.

P-256 here authenticates a device-admission directory response. It does NOT
replace libsignal PQXDH/Triple Ratchet/SPQR, choose Chain account/consensus
algorithms, or claim post-quantum protection of this admission channel. This
new admission format still requires independent protocol/enrollment review
before any production use; no compatibility or activation grant is implied.

## Freshness and lifecycle

Expiry starts when the native request is issued, not when the response arrives.
Signature, exact binding, current minimum, approved generation, approval and
expiry are verified before consuming the request. A valid response consumes
its challenge once; malformed or unauthenticated responses cannot consume it.
At most 32 live requests are retained. Requests are native-process-local;
a restarted process must obtain a new challenge rather than replay an old
signed lease. Expired requests can be pruned, and native clock rollback fails.
The original authority still owns lease issuance, expiry, generation advance,
revocation exclusion and protected-effect ordering.

This does not implement durable cross-restart generation storage. The original
trusted checkpoint protector and actual enrollment/revocation producer remain
required; Android Keystore is not treated as a monotonic rollback counter.

## Actual checks and remaining gates

`VeilSignedDeviceGrantCheck.kt` uses real JCA P-256 signatures and ephemeral
synthetic QA enrollment, including wrong signer/pin/curve/binding/generation,
tampering, replay, cold-process replay, expiry, clock rollback, budget and
valid recovery after invalid responses. It also calls the original authority.
The original 13 native authority/budget checks remain unchanged.

The current native source, current libsignal Java bridge and original Matrix
Kotlin pipeline compile together. The artifact is a dormant JVM source
composition, NOT an Android installer, Keystore/device execution, public
directory, relay, backup restore or MONSTER acceptance result. Actual native
directory/context verification, accepted Matrix routes, independently durable
checkpoint protection, full signed enrollment and final installed/public
journeys are still required before activation.

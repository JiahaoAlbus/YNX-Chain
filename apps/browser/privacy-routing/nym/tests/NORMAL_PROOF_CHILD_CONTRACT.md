# Normal Nym proof child consumer

This successor implements the actual normal parent/child consumer. It does not
construct an original release issuer, substitute the root app identity for the
child, or reuse `SyntheticTrialAuthority`/the QA XPC selector.

## Actual call order

1. The normal root retains `BrowserRouteProtection` and its opaque production
   qualification. Supply/profile/numeric peer checks and the real Root deny
   preparation remain required by the existing lifecycle.
2. Before preparing the proof child, `normalProofBinding(profileID:profileSHA256:
   proofRunID:)` creates lookup **DATA**, using the same preparation receipt.
   It does not need an initial full graph that cannot exist until the child has
   been prepared. `rootRunID` identifies the Root/control epoch;
   `proofRunID` separately identifies the explicitly requested proof URL path.
3. Prepare both original children suspended and enroll the exact full graph.
   Resume the vendor only with its original ACK and fresh blocked lease.
   Observe the official startup marker and the real discard acknowledgement.
4. After the final graph/listener ACK, call
   `registerNormalProof(binding:proofURL:responseSHA256:helper:readyBackend:)`.
   Its Core producer requires the same real normal qualifier, a fresh blocked
   lease, original child pins and actual vendor discard acknowledgement.
   Registration is adopted before checking cancellation, including late replies.
5. Resume the registered proof child with its original Gate/ACK. After its actual
   response passes the original bounded byte/hash validator, require a fresh
   `RoutedNormalProofParentRegistration.requireLive()` before Root connection.
   Status checks use that same registration. Concurrent refresh callers join
   one task rather than racing the signed protocol sequence.
6. Stop cancels/closes the registration before joining original startup, then
   adopts/closes any late registration and joins any original refresh. Existing
   Gate child-reap, cleanup confirmation, observed remote Root closure and
   profile-lock rules still govern final cleanup. UNKNOWN never authorizes a
   replacement or replay.

The native helper's exact new argv is:

```text
--ynx-nym-normal-proof-v1 <base64-RoutedNormalProofBinding> <port> <proofRunID> <reviewedOrigin> <proofURL> <responseSHA256>
```

Binding bytes are limited to 4096, their Base64 representation to 8192. Argument
count, numeric port, binding purpose/mode/IDs, dedicated profile/hash pins and
original proof URL rules are checked. Decoded lookup bytes are never authority.
The old `--ynx-nym-proof-v1` parser remains available only as a DATA fixture;
its actual dispatch always returns 78 and cannot request a URL.

## Independent child identity and current scope

The child keeps its existing immutable role and bundle:
`com.ynxweb4.browser.route.nym.probe`, `YNXNymProofHelper=true`, background-only,
no privacy mode or URL callbacks. Actual Team/self/executable/signature/seal
checks precede lookup decoding or IPC. Core then obtains
`RoutedNormalProofChildAuthority` through the real signed normal Provider
channel and actual self peer token. It does not call root
`RoutedProductionQualification.acquireCurrent(.nym)`.

Before creating a request, Native compares the authority's URL, reviewed
origin, response hash, loopback port and proofRunID byte-for-byte with requested
DATA, and reconstructs the original `NymControlledProbe` validator. Every GET
uses `authority.authorize(request:)`. Revocation cancels the same ephemeral
URLSession, whose proxy has no direct failover, TLS remains system-validated,
redirects are refused, and the response is at most 4096 bytes. The transfer has
no default empty authorization callback. The child continues checking its real
lease while idle, keeping its registered token alive until owned shutdown.

Normal provider identity uses sealed `YNXRouteFilterProviderSHA256`. Parent
packaging validates the actual signed provider before setting this operand in
root/proof bundles. No `YNXAcceptanceProviderSHA256` fallback is permitted.
Original production qualification and actual system isolation remain separate
requirements; a child registration/health ACK cannot grant either.

## Diagnostics and regression scope

`firstProofScopeFailure` retains its original typed error. Missing normal
provider pin is `proofScopeNotSupplied`; revoked/transport-lost/expired RPC scope
is `proofScopeLost`; signature and malformed target bindings keep their own
diagnostics. None is a DDG/CAPTCHA observation. TransportReady,
BrowserRouteReady, LeakSafe, SearchAvailable and ReleaseApproved remain separate.

New local checks were run only for this module: 24 identity/lookup/scope checks
(including a real NoTeam self-identity rejection), followed by seven new scope
failure mappings. These are not a qualified positive, real signed XPC, backend,
Browser window, system extension, or public proof test.

```sh
/usr/bin/python3 apps/browser/privacy-routing/nym/tests/test_normal_proof_consumer_delta.py \
  --output /absolute/dedicated/external/evidence
# Select only the later seven new error mappings:
/usr/bin/python3 apps/browser/privacy-routing/nym/tests/test_normal_proof_consumer_delta.py \
  --failure-only --output /absolute/dedicated/external/evidence
```

The existing CI synthetic-Nym probe now includes all 31 new checks once. Its
`--normal-proof-delta` selector runs only this group after current-source
compilation. Old backend, CAPTCHA, gateway25 and qualification13 were not
repeated. The original authenticated production issuer is still absent; Team,
provider pin and deployed proof resource have not been supplied as a usable
installed qualification. No normal protected window is enabled by this change.

# Normal privacy qualification intake

This delta implements actual normal intake and owner lifecycle checks, rather
than treating a constant `current=false` as the complete implementation. It does
**not** supply an original release issuer or grant a production qualification.

`RoutedProductionQualification.acquireCurrent(mode:)` is the only normal opaque
factory. It accepts no JSON, file path, public key, caller build hash, ready
Boolean, environment variable or QA capability. Its real intake sequence is:

1. Read the reviewed Team operand from the actual application's sealed Info.
   Missing Team fails before executable/helper reads, Root IPC, backend or WK.
2. Check actual mode bundle identity and running `SecCode` against the existing
   Apple-anchor + reviewed Team + exact identifier requirement; obtain the real
   signing Team, identifier, code hash and executable path.
3. Check the app's sealed resources/all architectures with strict static code
   validation. Hash the actual executable through an `O_NOFOLLOW` descriptor,
   checking held file identity/size/mtime before and after reading.
4. Check the existing owned helper's exact identifier/Team signature and hash
   against its sealed existing `YNXBackendStartGateSHA256` operand. Record the
   app/helper/code/OS installation binding and recheck the app seal/current code.
5. Require the original release owner's authenticated qualification supplier.
   No such contract/callee has been supplied. The actual factory therefore
   throws `qualificationIssuerNotSupplied` here; it never interprets a sealed
   resource, successful signing, `NEFilterManager.isEnabled`, RootDeny, health
   lease or QA canary as full-window/release permission.

Team in Info is an identity-comparison operand, **not** proof that an arbitrary
Apple team is the authorized original release approver. That approval and its
trusted signer binding must come from the original owner's genuine supplier.
No original A key/root/issuer is invented or used here.

The factory's positive branch is intentionally unavailable until that genuine
contract is integrated. This remains a specific owning CODE/contract boundary;
it is not reported as fully implemented production qualification waiting only
for an Apple certificate. The opaque class has a private constructor, is not
Codable, and cannot be constructed by the caller or a test approval flag.

## Actual consumers

`RoutedPlatformIsolationAdmission.current` now reports the actual normal-intake
failure, preserving historical unqualified RTC surfaces. The normal
`PrivacyRouteSession` constructor consumes the factory and stores the first
failure. Missing qualification starts/status-checks no provider and cannot bind
WK. A search-site observation cannot change route/LeakSafe/release permission.
Every request/binding/status and relevant async boundary rechecks the owned
qualification. Continuity failure synchronously clears endpoint/generation/WK
binding before the independently owned original-provider stop is awaited.
Existing internal state-machine fixtures remain separate from normal creation.

`BrowserRouteProtection` normal construction performs intake before creating
Root/control ownership. Its backend begin/enroll/update, fresh blocked lease
getter, connect, WK request and download paths recheck the same owned capability
before/after actual effects as appropriate. Loss synchronously invalidates the
existing content lifetime and closes the existing client, so a healthy control
lease cannot keep WK/downloads admitted after lost static qualification.
First qualification failure is retained. No route-provider, main, page or shared
Gate code is changed in this delta.

The normal window uses the protection owner's qualification for its route
session. Both consumers validate the same capability and receive its revocation.
When intake fails, the window keeps that first failure for its readiness display
without making another acquisition or starting a provider.

The compile-only synthetic path remains separate: `prepareAcceptance` uses its
original signing preflight/private identity constructor, actual signed Root and
canary capability; shared bootstrap methods select that existing typed authority.
It cannot satisfy or bypass normal qualification. It still requires genuine
signed-provider canaries. Positive signed QA/NE execution remains NOT_RUN.

The continuity reducer independently handles exact nanosecond deadline expiry,
wrong browser/helper/OS binding, permanent revocation and once-only synchronous
invalidation notification. An expiry already recorded before notification must
still deliver the callback once, without replacing its first cause. These are
DATA lifecycle tests, not authentic positive-qualification fixtures.

## Specific missing original-owner inputs and callsites

The following must come from the existing original release owner. This list is
an integration requirement, **not a proposed replacement schema or issuer**:

- The actual private supplier/capture ABI and immutable matching component,
  together with the existing authority that authenticates its approver/signer.
- Exact normal artifact and mode binding: Browser/code, helper, provider,
  backend/policy cohort, OS/API qualification scope. A QA binary and normal
  binary have different hashes; their qualification mapping cannot be inferred.
- The independently authenticated required leak-surface observations and their
  evidence semantics, including DNS/source attribution, IPv4/IPv6, WSS,
  downloads/redirects, in-flight route loss, UDP/QUIC and auxiliary resources.
- Separate original `ReleaseApproved`, finite original validity/current epoch,
  trusted time conversion and revocation/current/loss semantics. No local expiry
  refresh or arbitrary Boolean can fill these.

The original supplier acquisition belongs at the explicit boundary in
`RoutedProductionQualification.acquireCurrent(mode:)`, after actual identity
intake and before its private constructor. The same retained original current/
revocation reference must also be checked in `requireCurrent` and connected to
its synchronous `revoke` callback; the current implementation checks local
identity/finite continuity only because no authentic issuer reference exists.
`currentFailure` and normal owner construction must consume that **same** original
authority when it arrives, not create a second global status permission.

Current `product-release.json` describes an old ad-hoc Web-era preview and is not
a privacy qualifier. Existing `build.py` creates a reviewable original-signer
recipe but does not supply approved rows/credentials/qualification. The original
Root deny and health-control selectors explicitly disclaim isolation authority.
Auth's selected-page Source Root belongs to another namespace and is not reused.

## New targeted verification only

```sh
/usr/bin/python3 apps/browser/native/Tests/ProductionQualificationTests/test-intake.py \
  --output "$RUNNER_TEMP/ynx-production-qualification"
```

The driver freezes current Core and Native source to external scratch. It builds
the probe, typechecks the full normal and QA Native targets against their matching
Core modules, and verifies the private-constructor compiler rejection. Actual
normal factories reject NoTeam, and the shared-window path preserves both modes'
first refusal with zero provider calls. The probe also verifies independent
readiness and search states. Expiry/wrong-build/revocation
groups are explicitly DATA-only and never construct a qualification. Qualified
positive, signed NE/capture/whole-window results remain NOT_RUN. No keys,
signing, inventory, GUI, vendor, network or system configuration action occurs.
Parent-owned upstream source changes are recorded separately from C-owned drift;
only the frozen source snapshot is the subject of the compile result.

Apple primary references checked for this implementation:

- https://developer.apple.com/documentation/security/secstaticcodecheckvalidity(_:_:_:)
- https://developer.apple.com/documentation/security/seccodecheckvalidity(_:_:_:)
- https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
- https://developer.apple.com/documentation/xcode/configuring-network-extensions
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.networkextension
- https://developer.apple.com/documentation/systemextensions

Signature validity establishes code/resource identity under a requirement. It
does not establish observed all-flow isolation or original release approval.
No NE preference or system-extension setting is read or changed by this intake.
# Continuous-expiry delta (2026-11-08)

`test-continuous-expiry.py --output /absolute/fresh-external-output` compiles the
verbatim production DATA continuity type and runs only the new expiry boundaries.
The private qualification constructor, current checks and expiry sleeper now use
one `ContinuousClock.Instant` domain. Handler registration calls fresh current
before adopting the handler; local expiry tasks are cancelled on deinit.

The test's advanced instants model time spent asleep deterministically. It does
not put the system to sleep, manufacture a qualification or test signed NE.
Optional `--previous-source` requires exact original `8cc2d8a5...69a601` bytes and
demonstrates the old uptime reducer counterexample; absent old bytes are explicitly
not a legacy RED. `--typecheck-core` checks the affected current normal/QA Core
snapshot with the direct frontend and does not build an application or provider.
The prior eight groups are not run by this command. Their fixture only changes
literal numeric times to explicit synthetic instants for source compatibility.


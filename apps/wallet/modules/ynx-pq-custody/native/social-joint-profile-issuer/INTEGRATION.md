# Social joint-profile Native implementation

This directory alone owns the 17 strong functions in the original Auth private
issuer ABI. It does not implement an installer, Root enrollment or public
signer. The frozen NativeAI supply at `1b647491` is unrelated and unchanged.

## Actual implementation

`SocialJointIssuer.cpp` implements Source, binding, public-view and finite-role
inventories. Handles are bounded permanent tombstones; lookup retains the state
before rejecting a foreign PID/UID/thread. Parent release is blocked by actual
child counts. Reentrant operation/close is fenced. Presence and numeric-zero
failures remain separate. A nonnull failed acquisition is still a cleanup owner.

`CaptureLoan.cpp` and `CapturedSource.cpp` implement the actual Source factory
with Auth's SAME-process capture loan. SourceInput must be version 2, size 112
on the selected 64-bit ABI, with a nonzero privately minted capture reference.
The Go inventory independently recognizes it and compares all four original
buffers and the resource. Raw copies/resource IDs cannot construct authority.
Current rechecks the original capture and immutable window. R6 body comparison
uses the actual Native holder views and the Go actor's privately sealed plan,
scope7, policy10, original history/epochs and sole body inspector. No C++ JSON
body parser or time-window renewal is present.

`borrowCapturedSourceLoan` recognizes only that concrete Source and checks
current before and after borrowing its nonzero SAME-process Go loan. Failure
leaves zero output. The Native binding retains the Source until both original
holders close; this helper adds no retain, setter or cross-process authority.

Native binding acquires the independently registered Social fullpair and
DEVICE/session holders separately. Both currents and the SAME Source are
required. Views retain two real child loans, and release them even after a late
first-code-zero failure. Uncertain release is retained as debt, not retried.

`CommittedSocial.cpp` now defines `acquireCommittedSocialPair` through original
Main's five private SAME-process operations. It borrows only the recognized
Source loan and uses the actual F06 record digest as a locator. Main's original
directory owner checks the committed pair and Source association. Views use
caller-owned 8192-byte storage; all returned spans are checked before copying.
Private account namespace spans remain outside `SocialData`. Real children are
adopted before late failures and block holder close until physical release.
Malformed empty outputs do not become a physical release receipt.

`copyOriginalCommittedPairAccountNamespace` copies private issuer/subject facts
only from a recognized concrete holder's actual child view. It checks current,
copies before late errors, releases the view and retains uncertain children in
the holder. Its result never means physical holder close or DEVICE admission.
The account facts stay outside `SocialData`. Registered remote holders need
their own concrete implementation of the same private matching port.

Each role captures one role locator, the binding locator, body and original
SOURCE-PROOF frame. `enterOriginalOnce` must durably select the original intent
before `signOnceOriginalSourceProof` can enter a key. No new input is accepted
at signing. UNKNOWN permits the original query, never another sign/nonce/body.
The backing registered role service must independently perform both role
policy10 checks and its own UID/key/wrapping/current validation.

`FiniteRole.cpp` now defines `acquireOriginalFiniteRole` and calls the original
Auth finite custodian's 10 private lifecycle/data C operations. The separate
registered service-launch entry is never called by this adapter. It sends the
three independent
Source/binding/role resources and exact raw4/body/frame constraints; the
process-local capture reference is never sent. Metadata open does not enter an
intent or key. A nonnull failed open remains held for query and cleanup. A cold
UNKNOWN query requires no new enter. Each enter/sign is selected at most once,
and durable intent is rechecked before signing. Failed retire prevents join,
failed join prevents close, and an uncertain physical close is never retried.
Returned public bytes are retained before a late status error. The current
private header is a frozen WIP interface snapshot, not service qualification.

The cold-open query check currently assumes the same Source can still pass
current qualification. Role acquisition checks Source/binding current before
it reaches the service. It therefore does not establish cold recovery after
the original signing Source/window expires. That path needs the original
independent account-owned history/query authority and its normal caller; the
signing Source checks must remain intact.

`SourceFrame.cpp` calls only Auth's actual
`ynx_auth_social_source_frame_prepare_v1`, fixed to `record-issuer` or
`record-anchor`. The original source writer is pinned in `PRIVATE_PINS.json`.
The three independent limits are body 32768, frame 49152 and outer envelope
65536 bytes. The domain includes its original NUL (27 bytes). Pure DATA is not
an authority, and the PUBLIC extracted Go fixture archive is never a production
input.

## Required normal composition

Use the matching frozen R6 Auth header, not the old R4/104-byte header or mutable
supplier directory. The original same kernel/ONE Go runtime must contain the
actual capture-loan/window/body-compare and frame definitions. SDK's two body
DATA exports remain their sole implementation; no additional Go archive is
imported here.

`CMakeLists.txt` requires an actual registered-service adapter target and may
attach objects only to the original selected combined target. It has no PUBLIC
or always-unavailable fallback. Object compilation is not a successful normal
whole-image link.

The remaining concrete holder definition is:

- `acquireRegisteredDeviceSession`: now implemented in
  `RegisteredDeviceSession.cpp`, calling the original held Device source and
  retaining partial owners before any status/fence. Social classic33/PQ2592 are
  not its E5 pair. Postaccepted facts do not construct a first-device registration.

The dedicated finite role service body is supplied by original Auth as R1 plus
mandatory R2 and its matching registered-read successor in the SAME crate. SDK
f38e952 also supplies that matching normal consumer. This does not establish a
normal combined service link. Existing Source families 1..4, InitialPrekeys and QA
ApprovedSourceFrame are not this permission. Only legal lower storage/math
primitives may be reused. The service independently checks Root/Source4,
binding/current, peer and role policies. Its response must be the retained
actual original envelope using Auth's sole SAME-kernel Go DATA writer, not a
digest or another C++/Rust envelope codec.

Remaining normal CODE intake is specific: SDK must adopt Auth's R7 capture
route/header/provider into its Source3 profile, and the private Device namespace
projection must be merged minimally into the actual current SourceAuthority and
sole verifier. Never replace a whole shared mother or hot-mix a sealed candidate.
The combined Linux target and its ONE Go aggregate still require actual linkage.
Genuine Root
profiles, registrations, keys, approvals and placement are separately absent;
no tests provision them.

Main's directory getter also needs its actual normal admitted directory in
each selected process. The standalone role process does not acquire that
authority merely by linking the five exports or receiving public pair bytes.
`MainPairRoute.cpp` now selects the immutable local/registered route from Auth's
actual capture inventory before acquisition. `RegisteredMainPair.cpp` calls
Auth's seven private client operations and keeps the role's Source current
before and after projections. Raw4/F06 are constraints and the Go reference is
zeroed at this boundary. Remote views retain opaque owners, copied public and
private namespace DATA, and uncertain physical debt. Failed local acquisition
never selects a remote fallback. The concrete Auth Rust/C client and source
route bodies are now supplied separately; normal combined Linux integration
and actual registered Root/channel placements remain unverified.

`DeviceNamespace.cpp` now calls the actual additive private C matcher
`ynx_auth_device_v4_view_match_account_namespace_v1`. Its issuer/subject tuple
comes only from the independently current genuine Main holder; it is comparison
DATA. Auth compares private facts derived after the full verified primary
DEVICE enrollment/profile/current chain on the SAME held view and deadline.
The Native adapter does not parse Root JSON or derive an issuer from app origin.
An absent paired failure must be all-zero and `matched` must be exactly 0 or 1;
presence with code0 is still failure. The full original failure, including
origin/platform code, is retained before a later view/parent fence.

The normal object target now has ten C++ units and requires
`YNX_SOCIAL_JOINT_DEVICE_INCLUDE_DIR` with the matching C12 and namespace headers.
Its original-services dependency must supply actual Auth Borrow/Clock plus
exactly one Darwin or Linux backend and the matching sole verifier. Fixture
definitions, a second archive/runtime and a caller-selected provider are forbidden.
All modules using the private `Result` header belong to the same rebuilt cohort.

Device cleanup keeps the original owner/view debt. A pending original join
before physical close selection may progress on the SAME owner. Once physical
C close or release-closed has been selected with UNKNOWN, it is never dispatched
again. This permits cleanup progress, not acquisition/signing/operation replay.
The full current/matcher calls perform actor I/O and cannot run under Store locks.

## Verification boundaries

The test binaries exercise the real Native implementation with visibly PUBLIC
authority/custody seams. ASAN/UBSAN, once ordering, first-code-zero, partial
adoption, view debt, reentrant/foreign-actor rejection and lookup/close races do
not establish Root, real key entry, real signing, installation or finality.
The old R4/104 controls are retained as predecessor evidence; newer ABI/body
changes need their own narrowly affected controls and exact source snapshot.
The two existing parameterized test runners target macOS CI. Their disk gate
uses the runtime home directory, preserving the original 512MiB threshold.
Neither those macOS checks nor a Linux-oriented source contract qualifies a
Linux product or normal Linux service.

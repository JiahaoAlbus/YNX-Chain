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

- `acquireRegisteredDeviceSession`: original legal DEVICE/session provisioning
  and same-source current holder. Social classic33/PQ2592 are not its E5 pair.
  Postaccepted facts must not create a first-device registration cycle.

The dedicated finite role service is still being completed by original Auth.
The Native adapter is implemented; this is a separate normal service-body and
link requirement. Existing Source families 1..4, InitialPrekeys and QA
ApprovedSourceFrame are not this permission. Only legal lower storage/math
primitives may be reused. The service independently checks Root/Source4,
binding/current, peer and role policies. Its response must be the retained
actual original envelope using Auth's sole SAME-kernel Go DATA writer, not a
digest or another C++/Rust envelope codec.

These are missing normal CODE dependencies, not merely absent live keys. The
Native/Source, Main and original service owners must complete the actual
adapters before calling the normal combined target supplied. Genuine Root
profiles, registrations, keys, approvals and placement are separately absent;
no tests provision them.

Main's directory getter also needs its actual normal admitted directory in
each selected process. The standalone role process does not acquire that
authority merely by linking the five exports or receiving public pair bytes.

## Verification boundaries

The test binaries exercise the real Native implementation with visibly PUBLIC
authority/custody seams. ASAN/UBSAN, once ordering, first-code-zero, partial
adoption, view debt, reentrant/foreign-actor rejection and lookup/close races do
not establish Root, real key entry, real signing, installation or finality.
The old R4/104 controls are retained as predecessor evidence; newer ABI/body
changes need their own narrowly affected controls and exact source snapshot.

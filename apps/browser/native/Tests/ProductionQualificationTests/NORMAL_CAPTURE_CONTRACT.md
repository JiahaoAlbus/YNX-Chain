# Normal artifact observation receiver (not a qualification supplier)

This module supplies a real read-only normal artifact capture/current/retire
channel. It does not supply an issuer, approval, Root, network permission or
`RoutedProductionQualification` positive. The synchronous normal factory still
requires the original release owner's genuine approval/current/revocation
contract after actual identity intake. Missing that contract remains owning
composition work; Team/profile/OS activation are separate external gates.

## Actual call chain and stable API

```
RoutedProductionQualification.captureCurrentArtifact(mode:) async throws
  -> actual own Team/SecCode/strict app+helper seal and installed file digest
  -> actual normal role + sealed provider executable pin
  -> original own full audit token
  -> signed provider NSXPC requirement
  -> captureNormalArtifact/currentNormalArtifact/retireNormalArtifact
  -> provider actual peer full-token/SecCode/path/PID version/current hashes
  -> finite non-authority observation (originalApprovalState=not-supplied)
```

The owner is `RoutedNormalArtifactCapture`, with read-only `observation`,
`firstFailure`, `localChannelDisposed`; `requireCurrent() async throws`,
`installRevocationHandler`, and `retire() async`. Its initializer is private.
There is no caller supplier/protocol setter, public key, authorization Boolean,
JSON approval, QA receipt, environment or manifest route into qualification.
The factory accepts only the typed mode. JSON on the authenticated internal
channel is bounded canonical comparison DATA and rejects unknown/duplicate/type
aliases. Both endpoints derive current artifact and token independently.

No existing Root/graph is needed to observe normal artifacts, so this does not
create a Root-before-qualification loop. Capture ID/epoch are independent
observation IDs, not Root/Source or route epochs. A graph/lease/canary is not
consulted for approval. A genuine original issuer remains absent.

A future normal composition may explicitly capture, retain the owner across
its use, requireCurrent before/after its original asynchronous approval callee,
and retire before dropping custody. Capture cannot advance production admission.
The current normal factory consumes only withdrawal/identity mismatch from an
already retained capture; no capture or observation grants a positive result.
No new main/UI consumer was added. It must not auto-start the filter or retry an
UNKNOWN retire. A returned `.unknown` only means the original remote retirement
was not confirmed; local channel invalidation is separately visible.

## Peer, post-sign identity and normal recipe

1. Original signing owner builds the **normal** filter cohort without
   `YNX_PRIVACY_ACCEPTANCE`. `macos-filter/build.py` includes
   `NormalCaptureProtocol.swift` in the existing client/framework/provider/host
   source list. This is additive: the original `ControlProtocol` selectors did
   not change. The QA provider body rejects this new capture operation.
2. Sign provider/host with actual reviewed Team, identifiers and entitlement-
   enabled profiles through the existing reviewed signing flow. No signing,
   profile creation, activation or privilege operation is performed by capture.
3. The normal routed root has sealed
   `YNXNormalArtifactCaptureRole = normal-artifact-observation-v1` (String).
   This marker is solely an observation-role selector. It grants no approval.
   Wrong/missing/Bool marker, wrong bundle ID or a QA compilation cannot use it.
   Root mode identity remains `com.ynxweb4.browser.route.tor` or `.nym`.
4. Use the existing package provider intake to bind **actual post-sign provider
   executable SHA256** in `YNXRouteFilterProviderSHA256`. Bind actual start-helper
   hash in `YNXBackendStartGateSHA256`, with strict original Team/identifier seal.
   The provider checks the calling root's current file/SecCode identity; the
   client checks the provider through its actual signed channel and returned
   executable digest against the sealed root operand.
5. Do not embed a root post-sign hash back into the provider: root Info already
   carries the provider pin, so a reverse post-sign dependency would form a
   signing cycle. No such reverse pin or issuer is invented here. QA-to-normal
   qualification mapping remains a genuine original-issuer responsibility.
6. User-approved actual filter activation/configuration and sourceApp evidence
   remain separate. A successful artifact capture would still report approval
   `not-supplied`, never LeakSafe or ReleaseApproved. Existing 22/24/25 bundles,
   Info files and signatures are not modified by this module.

## Finite ownership and closed receiver

Client lifetime is a fixed five-second `ContinuousClock` deadline, never extended
by current calls. Provider independently bounds observation rows to five seconds;
retirement, disconnect, expiry, sleep and filter stop clear only observation rows.
No capture ledger entry participates in network routing/allow/drop decisions.

An independently owned expiry withdraws first cause before reentrant callbacks.
Wrong installation/provider pin, lost channel, timeout or cancellation clears
observation, cancels timer and invalidates the original XPC connection. Post-await
identity failure explicitly disposes an already adopted owner. Current calls
coalesce; all awaiters recheck actual identity/deadline before receiving DATA.
Retire revokes local reads first, joins original pending work, then attempts one
bounded retire and always invalidates the original channel. Late success cannot
recreate the owner. Provider generation is pinned independently of cleared
observation DATA, including on retirement; an updated provider cannot return a
replacement acknowledgement for the old capture.

Provider strict signature/hash IO is outside its global network-flow lock.
Immediately before ledger mutation, it rechecks that the exact connection session
is still registered and the filter has not stopped. A closed session cannot
reappear after slow artifact verification. Original routed peer full audit token,
PID version/start, Team/identifier, running/static CodeDirectory and exact file
SHA pins are rechecked; no PID/name-only permission exists. Error replies contain
only the typed enum code, no path, raw signature diagnostic or user URL.

## Verification and evidence limits

The original `test-normal-capture.py` nine normal plus nine QA checks are retained
and were not rerun during the closed-receiver delta. They cover actual normal
factory NoTeam refusal, private constructor, real codecs and PUBLIC reducer
fixtures. Signed peer and qualification positive were NOT_RUN.

New necessary delta only:

```sh
/usr/bin/python3 apps/browser/native/Tests/ProductionQualificationTests/test-normal-capture-closed-receiver.py --output "$RUNNER_TEMP/ynx-normal-capture-closed"
```

It reproduces the former cleared-observation generation acceptance (expected
exit1), runs five new groups on the actual generation/session/pending/lifetime
primitives and actual normal factory rejection, and compiles affected normal/QA
Core/Provider. The physical-lifetime check uses an actual own anonymous XPC
endpoint; it is not a signed provider/NE/Root or permission fixture. Source checks
separately verify post-acquire disposal, typed timeout/cancel first cause, final
session fence and build.py client list. No route, backend, GUI, BPF, global DNS,
VPN, trust or system permissions are touched.

Parent's next matching normal Native/provider integration, source manifest/CI
CAS and original normal recipe consumption are explicit integration work. Earlier
PUBLIC24 or privacy-integration25 frozen snapshots intentionally exclude these
normal-capture WIP inputs and do not supply their runtime proof.


## Follow-on: normal acquisition custody

The normal capture factory now has one private MainActor acquisition custodian,
not a last-completing weak global owner. The actual capture object is adopted
into strong custody before opening its provider channel. Concurrent requests join
the same independently owned worker; cancelling a waiter cannot cancel that
worker or free an UNKNOWN owner for replacement. All returning waiters validate
current identity/lifetime again. A failed acquisition before adoption has no
owner debt and a later explicit attempt may retry. Adoption before transport
open does not claim that a remote effect happened: it conservatively retains the
original partial until retirement/disposal can be confirmed.

An existing owner is reused/refreshed. Replacement is possible only on a later
explicit call and only after that exact owner has both an observed remote retire
reply and local channel disposal. Expiry, local close, deinit, timeout, missing
retire reply or a caller Boolean cannot substitute for this pair. Retire status
is read-only `retirementResult`; it is set only from the original owned retire
worker. The custodian retains its first failure, including a pre-adoption failure,
without treating that historical first cause as a new authorization or a ban on
all future effect-free attempts. This owner schedules observations only; it does
not grant Root/route/qualification permission.

New custody delta only (default runs eight new groups; no prior receiver/trial
checks):

```sh
/usr/bin/python3 apps/browser/native/Tests/ProductionQualificationTests/test-normal-capture-acquisition.py --output "$RUNNER_TEMP/ynx-normal-acquisition"
```

Seven groups and normal-Core/QA-Core compilation were run at the frozen production
leaf. After a parent read-back requested a specific pre-adopt case, only that one
additional case was compiled/run using the verbatim same production primitive:
`--pre-adopt-only`. Earlier seven were not rerun. PUBLIC object fixtures exercise
custody and do not create an authenticated capture/approval. The actual zero-DATA
normal factories continue to reject NoTeam before any channel effects.

## Original approval source checked; no symbol invented

The actual examined release artifacts are `apps/browser/product-release.json`
(old adhoc preview, productionSigned false), `docs/developers/SDK_RELEASE_INTEGRITY.md`
(optional caller-selected key verifies SDK package bytes), the original release
owner registry entry, and the actual protected acceptance consumer/dispatcher/
canary/control bodies. None defines a held normal privacy approval issuer or a
trusted private capture/current/revoke ABI. In particular:

- Synthetic canary qualification's enumerated callback coverage keeps
  `fullLeakSafe=NOT_RUN`; its owner binds the QA executable and synthetic nonce
  origins, not a normal release.
- Dispatcher finish is `targetVerdict=INCOMPLETE, productionRouteAdmission=false`;
  observed control closure is deny-only, not approval.
- Provider status reports `osIsolationAcceptance=NOT_RUN` and normal artifact
  observation reports `originalApprovalState=not-supplied`.
- A release manifest/digest proves selected bytes only. A caller's SDK public key,
  Team marker, ad-hoc code seal, backend health or DTO cannot confer the missing
  approval. QA and normal exact executable hashes cannot be silently rewritten.

The missing owning object is the original release owner's authenticated *normal
privacy qualification* owner. Its actual symbol, signer/approver authentication,
qualified artifact/evidence and QA-to-normal mapping format, finite current epoch,
revocation subscription and retire semantics have not been supplied. There is no
existing symbol to call or new selector here that pretends to be it. The concrete
insertion points remain after actual installation intake in
`RoutedProductionQualification.acquireCurrent(mode:)`, before its private init;
the same original held current/revoke reference must then be used by
`requireCurrent`/`revoke`. Normal capture/current/retire data cannot replace it.
This is an internal owner/contract CODE dependency, separate from Team/NE runtime
resources. Positive normal qualification, signed channel and whole-window
acceptance remain NOT_RUN; the parent matching build is compilation evidence only.

# Synthetic authority withdrawal and physical-closure delta

This changes only the existing compiled QA capability and its original dispatcher.
It supplies no normal issuer/approver, Team, Root, release approval or successful
OS isolation result. `RoutedProductionQualification.acquireCurrent` is unchanged.

The former `SyntheticTrialAuthority.verify` threw on expired lifetime or lost
preparation without consistently withdrawing existing consumers. Idle WSS/WK
could depend on a subsequent check. The authority now owns a withdrawal-only
primitive: an independently owned, weak-self expiry task uses `ContinuousClock`
and zero tolerance; synchronous checks also enforce the same absolute deadline.
Caller cancellation does not cancel this task, deinit cancels it, and the first
failure is recorded before reentrant callbacks. ContinuousClock includes system
sleep, as documented by Apple:
https://developer.apple.com/documentation/swift/continuousclock/clock-implementations
Scheduling on MainActor is not a real-time or OS packet-denial guarantee.

Every withdrawal clears the qualification and current route/sequence/request,
closes owned canary sockets and their original signed-provider channel, and
closes the SAME `RoutedRootPreparation` and `RoutedIsolationClient` adopted by
Native. Client close synchronously invokes the existing Native content-invalidated
chain (WK/download generation, original backend stop and session revocation).
Observers cannot grant or reconstruct a capability. Late handler registration
checks actual current state and invokes the withdrawing handler before throwing.
`public var firstFailure: Error?` is read-only and exposes no permission.

Async arm, canary observation and route confirmation check cancellation and
freshness after reply. Route confirmation additionally compares before/after
route sequence and provider generation before saving a port. A late reply cannot
recreate a closed owner. All existing public constructors and scope rules remain.

The dispatcher previously treated only `childReaped` as physical cleanup. Both
route-loss and whole-window close now also require exact `cleanupChildPID`, a
matching actual exit PID, prepared PID agreement when available, and the original
Gate's `cleanupConfirmed`. A legitimate early-cancel cleanup-only identity remains
usable for cleanup, never for resume/Root graph authority. Missing/mismatched
receipts remain UNKNOWN with original owner/partials retained. This does not
prove individual managed-PT reaping, full network shutdown or OS crash safety.

## New focused test only

```sh
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/test_trial_withdrawal.py --output "$RUNNER_TEMP/ynx-trial-withdrawal"
```

The driver uses fresh external output and an ASCII temporary alias to WD, pins
actual sources, compiles the actual withdrawal primitive and cleanup predicate,
and runs eight new groups/ten cleanup DATA combinations. It reproduces the old
child-only expression's false positive (expected exit1), not a fake Gate/NE run.
It then typechecks the actual changed authority with the real frozen client
sources and exact endpoint DATA declarations extracted from Core. No authority
positive, fake signing ACK, socket, WK, backend, GUI or OS setting is used.

Whole Native with the final changed dispatcher remains a separate parent-owned
integration check; build24 deliberately contains the earlier Core and supplies
no new-source proof. Tests here cannot open normal privacy admission.

## Exact normal supplier boundary

The existing authenticated acceptance canary proves only its enumerated callback
drops under its exact QA binding (`fullLeakSafe=NOT_RUN`). A healthy current graph
and lease prove dynamic route/control continuity. Neither is an original normal
release approval, a complete leak-surface result, or a mapping from QA executable
to a different normal artifact. Consequently they cannot mint normal qualification.

A genuine original-owner supplier must be called after real installation identity
intake at `RoutedProductionQualification.acquireCurrent` before its private init.
Its retained original current/revocation owner must be checked by `requireCurrent`
and subscribed to the SAME synchronous revoke callback. Required authenticated
inputs remain exact normal browser/helper/provider/backend/policy/OS cohort;
complete required leak surfaces; finite validity/current epoch; and independent
original release approval. No such trusted producer/capture ABI exists in this
repo today. This is an owning composition/contract gap distinct from external
Team/profile/activation and actual signed-OS acceptance. This delta does not
invent a JSON approval, public key, ready Bool, provider setter or alternate Root.

No new public native all-nonproxy-UDP deny primitive has been established. The
known native Lockdown control is retained; OS-level arbitrary UDP denial remains
the real NE socket-filter path and requires actual signed/activated validation.
The original RTC IPv4/IPv6 FAIL and current collector INCOMPLETE are unchanged.

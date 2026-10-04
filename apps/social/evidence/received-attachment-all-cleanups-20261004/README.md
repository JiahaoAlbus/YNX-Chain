# Whole received-attachment cleanup caller continuation

Base source: 2114b79a846ba322082148667fa00f0ac1bdf762.
Base tree: a96bee68c1fdc91de8847dea5a5d3610d75f235b.
Controller: 01a094cc-0ba3-7901-bcd5-56fce8330c0d.
Status: candidate repair awaiting original independent whole-caller review.

## Independent original finding preserved

Central supplied a real original-parent callback counterexample: A cleanup failure
followed by B cleanup failure replaces the single pendingCleanup slot with B,
leaving A inaccessible to normal Retry cleanup. Reported original probe result:
0 PASS / 1 FAIL. Probe SHA256:
87b3f1cb07c53282ff4800e8c553d020b82bbffb1c1d011f3bea245df198877e.
Original failure log SHA256:
debcd051275628b50b74c015045ecb528958887293fb67096848435bea44d5e4.
Those original independent artifacts remain Central-owned and were not rewritten,
rerun or relabeled here. Earlier 513 lease and e198 decode local closures do not
by themselves close this whole-caller finding.

## Owned full caller repair

NativeMatrixReceivedAttachment now uses an external-store cleanup registry instead
of a single React state slot. Each obligation captures the ORIGINAL selection
source and its ORIGINAL preview port. Distinct source selections retain distinct
completion tokens, including for the same event/preview. Duplicate callbacks for
the same source do not overwrite another source. A late old completion cannot
remove a replacement token.

The registry lives outside an individual row. Removing/remounting the row does
not discard its in-process failed obligations. Retry iterates captured originals
serially, attempts other obligations even if one fails, and removes each only
after its own close resolves. Concurrent retries coalesce each obligation. It
does not substitute a new actor/client/port to clean an old captured preview.
The native preview's existing per-handle coalescing remains independently active.

The viewer registers cleanup BEFORE background, effect-unmount and explicit-close
awaits. Effect callbacks capture their original scope rather than a latest-ref
callback belonging to a replacement. A failed retired download whose original
release is pending also registers that original cleanup. Normal successful cleanup
retires its captured token. Parent modal dismissal hides selection before awaits;
normal pending cleanup blocks opening another preview until cleanup is resolved.
No failed buffer or pending original is silently dropped or reported erased.

This registry is IN-PROCESS, not a durable native cleanup journal, grant, remote
erase receipt or restart/SDK claim. Actual native process-death cleanup, retired
generation handling and protected producer guarantees remain with the original
native owner. No new authority, key manager, identity or storage format is invented.

## Validation

66 related nativeMatrix/nativeMedia/receivedAttachment tests PASS. These include
the unchanged old lease/decode cases and eight new queue tests covering A+B
failures, partial recovery, repeated callbacks, old completion tokens, original
port capture, row remount subscription, overlapping retries, late unrelated
completion and same-preview distinct-source obligations.

Full owner tsc --noEmit: exit 0. Isolated current-source web build: exit 0.
Actual parent AND viewer components were mounted in an existing controlled React
DOM host. Observed via UI actions and retained AX records:

- Review and explicitly open an original controlled attachment.
- Unmount the original row while original release fails.
- Remount: pending original cleanup remains and Review is disabled.
- Retry while release remains unavailable: obligation/error remain.
- Recover the ORIGINAL port and retry: Review becomes available.
- Review/open again, change event: original preview is hidden and cleaned.

Representative recovered-parent PNG is retained. Controlled host uses existing
React/ReactDOM 19.0.0, not owner React 19.2.3/native renderer. RN controls, AppState,
i18n and media/current ports are explicit host substitutions. There is no native
file decoder, real Matrix event, private permission, actual OS lifecycle or
MONSTER invocation. This is actual component state evidence, NOT installed UAT.
No actual branding/default-language acceptance is inferred from host substitutions.

Only owned tab 17 and the uniquely matched owned QA server were closed. The
original server session ended exit 143 after SIGTERM. No inherited browser tab,
device window, original APK, queue, cache, account or key was removed.

## Remaining gates

Original whole-caller reviewer must audit this exact candidate and its original
counterexample. Actual installed/source-matching admitted native producer, SDK
file cleanup/readback, private session/accepted peer/revoke behavior, public
source-bound release and MONSTER remain NOT_VERIFIED. No deployment/install,
account request, signing, transaction or new crypto activation was performed.
Old exact web release carrier bytes and old independent FAIL/HOLD records remain.
Full Social/crypto649 remains NOT_COMPLETE.

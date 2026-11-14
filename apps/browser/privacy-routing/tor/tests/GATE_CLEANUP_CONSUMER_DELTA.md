Tor's Arti and PT consumers now release the original owner/profile lock only when
the original gate reports an exit for its `cleanupChildPID`, `childReaped == true`, and
`cleanupConfirmed == true`. The confirmation is read after the awaited poll. A
successful child waitpid alone does not prove wrapper/control/capture cleanup.

If prepare was invoked but there is no bound cleanup PID or actual exit receipt,
cleanup remains UNKNOWN. `isRunning == false` and the no-launch meaning of gate cleanup
confirmation do not replace a child receipt. UNKNOWN retains the original gate and
lock, permits a later explicit reaping retry, and never overwrites the first cause.
Raw `stopFailure.detail` is not logged or exposed by these consumers.

An early cancellation can leave public `prepared` nil even though the same verified
helper sent a valid post-exec control frame and then reaped its child. C binds that
frame to readonly `cleanupChildPID` for cleanup only; it never supplies resume or
Root-graph identity. Consumers use this separate identity so a genuinely confirmed
early cleanup does not retain the profile lock forever. Missing/mismatched cleanup
PID or missing exit still retains the original owner.

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_gate_cleanup_consumers.py \
  "$RUNNER_TEMP/ynx-tor-gate-cleanup-consumer-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

The driver compiles the actual two production stop method bodies against PUBLIC
gate fixtures and real fresh owner-only OS flocks. It checks retained identity/lock
when pipes are pending, PID mismatches, child reaping is missing, polling fails, or
confirmation changes during the await. It also checks explicit same-owner reaping
retry, either-backend UNKNOWN and first-cause preservation. The test never signals
the fixture PIDs, creates a real backend/Root/NE acknowledgement, or touches a user
profile. No original startup-ownership cases are rerun. To run only the new early
cancellation edge after the original 38 cases are already recorded:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_gate_cleanup_consumers.py \
  --early-cancel-only "$RUNNER_TEMP/ynx-tor-gate-early-cancel-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

The original C owner supplies the shared gate's cancellation-safe stop worker and
readonly confirmation. Parent's single normal/QA full-target batch verifies this
consumer with C's final source pins. The controlled consumer result alone is not
evidence of signed NE activation, protected BrowserRouteReady, LeakSafe or release.

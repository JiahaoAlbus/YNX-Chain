The Tor provider owns its original startup task. `start()` is the outer waiter;
`performStart()` is the child worker. An error from the child returns to the outer
waiter before cleanup can join that child. The child never calls provider stop.

`stop()` cancels the exact worker and synchronously fences Root/protection/content
before awaiting it. Only after that worker settles does it poll/reap the original
Arti/PT handles and release the existing profile lock. `cleanupConfirmed` is false
while startup or stop is in flight. UNKNOWN child reaping still retains the original
gate/lock; a later explicit stop may retry reaping, never replace the startup.

The new offline driver compiles the actual production ownership helper and the
existing error declarations, then exercises PUBLIC memory fixtures for late Root,
PT and Arti returns, concurrent stops, caller cancellation, UNKNOWN reaping and
original interruption errors. No fixture manufactures a Root/NE/process receipt.

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_worker_ownership.py \
  "$RUNNER_TEMP/ynx-tor-worker-ownership-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

The callback graph remains acyclic: `performStart` may await PT/gate cleanup, but
neither leaf awaits provider stop. Protection/path/sleep callbacks launch a separate
stop task. Root RPCs have 5s reply deadlines; gate control waits have 5s deadlines,
and its original stop has 6s plus 6s bounds. PT startup and Tor bootstrap loops check
cancellation and live leases. The existing 300s synthetic qualification lifetime
and 600s bridged bootstrap budget are unchanged; expiration cannot renew authority.

Shared `OwnedBackendStartGate` cancellation-safe stop/join changes belong to its
original C owner. Its former `try? Task.sleep` loops in an already cancelled caller
can busy-wait and delay exit receipts. This dependency must be reported separately;
the Tor ownership delta is not proof of that leaf's cancellation-safe completion.

The current production isolation admission remains false. A production qualification
import needs an authentic installation-bound capability from the original platform
authority; neither a diagnostic snapshot, JSON status nor the synthetic-only trial
authority can substitute for it. These tests and compilation do not prove protected
BrowserRouteReady, LeakSafe, signed NE activation, network exit or formal release.

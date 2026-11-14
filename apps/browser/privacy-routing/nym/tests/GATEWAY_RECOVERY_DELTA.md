# Explicit-action gateway recovery

The official pinned Nym `switch_gateway` updates the active gateway in its existing
registration store. `list_gateways` reads that active identity and the persisted
primary/fallback endpoints. Neither command implies an HTTP result, a new profile,
or a new browser safety qualification.

The prior Browser consumer wrote one `gateway-<identity-hash>-unknown.json` per
target and never recorded successful resolution. After a successful use of A,
then a later legitimate selection of B, a fresh explicit action selecting A again
found A inactive plus its old intent and permanently returned provisioningUnknown.

`NymGatewayActionJournal` now preserves each original intent and uses a separate
file per explicit user-action UUID. Its private history has three distinct steps:

1. UNKNOWN is fsynced before the official mutation can resume.
2. A separate effect-exit record is published only after the original process
   exited0/childReaped, its Gate/helper/FD cleanup was confirmed, and that exact
   Root epoch's remote closure was observed.
3. A separate reconciled record additionally binds a fresh official active-state
   readback, matching selected gateway identity and exact WSS endpoint with no
   fallback. This permits a later explicit action; it never grants transport/NE
   authority, marks browser ready, or resubmits a URL.

Intent/exit/reconciled byte hashes, profile, target and operation bind the history.
The same action cannot be replayed; new actions are blocked by unresolved intents.
Malformed, foreign-profile or modified receipts fail closed. Original UNKNOWN
bytes, keys, config and gateway rows are not rewritten by these journal functions.

If remote closure was initially UNKNOWN but final stop later observes the same
epoch closed, the retained original Gate/preparation/action may publish only that
original effect-exit record. It cannot fabricate active readback. A future explicit
request still reads official state before reconciling. Repeated publication is
idempotent only for the exact original exit PID; a different PID is refused.

Legacy UNKNOWN without its original successful exit evidence remains UNKNOWN.
Even an active readback cannot manufacture that missing process receipt. Existing
officially active gateway may be used without replaying its mutation, as before;
an inactive unresolved legacy action cannot be silently retried or migrated to done.

Auxiliary operations now stop/confirm the original Gate and recheck cancellation
before retiring their epoch; childReaped alone no longer advances to a successor.
The pending original action is retained until final cleanup, preserving leases and
first causes when any Gate/closure/journal step remains unknown.

The new local journal cases use synthetic private records and no real profile,
keys, gateway, WebKit, network or authority. Existing CI's original synthetic probe
includes them once; a targeted invocation is:

```text
YNX_NYM_TEST_OUTPUT=/absolute/owned-external-output \
  bash apps/browser/privacy-routing/nym/tests/test-synthetic-nym.sh --gateway-recovery-delta
```

Lightweight local callee extraction and frozen20 API typechecking are reported
separately from the parent full application build. Historical Mixnet HTTPS success
and DDG202/CAPTCHA are reused without another bootstrap/search/exit change.

A second concrete dependency remains owned by the parent shared Gate module:
real saved directory output is about2.7MiB, but helper20 caps capture at128KiB.
Directory/list capture needs an explicit bounded per-spec negotiated limit;
raising a Swift field alone must not let the old helper resume. The same helper
must admit only the validated normal user HOME and drain bounded tail output at
normal child exit. This Nym journal change does not claim those helper20 features.

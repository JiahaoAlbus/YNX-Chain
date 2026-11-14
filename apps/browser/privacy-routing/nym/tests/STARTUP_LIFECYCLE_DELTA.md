# Owned Nym startup and shutdown delta

The mode factory and public signatures are unchanged. Production still requires
the original signing/application/helper checks and immutable platform admission.
NoTeam refuses before resource callbacks, filesystem, profile provisioning, XPC
or vendor startup. Synthetic epochs still require their authentic qualification;
no fixture can construct a positive authority.

The provider now owns the exact startup Task through `NymStartupOperation`. Stop
invalidates its generation, blocks the phase, cancels that Task and closes current
protection immediately. It then joins the original worker before inspecting the
final owned gate/preparation set. A factory that returns after cancellation is
retained and rejected; its owner cannot disappear behind an earlier successful
cleanup result. Auxiliary owners and the runtime protection are adopted before
their asynchronous `beginBackendPreparation` calls. The worker itself never waits
for the stop operation, avoiding a worker/stop self-join cycle.

Gate cancellation/reaping is still the original gate implementation. Helpers are
never killed by numeric PID or replaced when UNKNOWN. Final cleanup still needs
each actual `childReaped` receipt and provider-observed Root closure. Unknown
closure/reap preserves the original gates, leases, profile identity and first
failure. Concurrent stop callers join one shutdown Task, which clears its marker
before waking waiters. `cleanupConfirmed` excludes both an active startup and an
active shutdown, in addition to the original owned-resource checks.

Read-only Native diagnostics now include `operationStage` and
`firstFailureStage`, alongside `firstFailure`/`lastFailure`. Stages distinguish
identity, supply, proof resource, directory, profile, gateway, numeric policy,
bootstrap, proof, route connection and cleanup. Typed failures preserve missing
signing, invalid supply/profile, stale directory, gateway/control-plane, proof
timeout and lost lease causes. No raw callee error message, key, URL or payload is
added to logs. A late status response after stop cannot overwrite the first cause
or fence a newer generation. Network path changes remain fail closed.

These are diagnostics, not readiness grants. A connected owned transport and its
controlled proof do not establish a proxy-bound WebKit view, nine-surface
LeakSafe, DDG results or release approval. CAPTCHA/HTTP403/search state is not
read by this provider and does not trigger recovery, provider rotation or direct
fallback. No resource candidate is injected into the bundle. The resource owner
handoff currently says `PUBLIC_PROOF_NOT_DEPLOYED`; its loopback body/TLS metadata
cannot stand in for actual public proof200.

Recovery is an explicit new user action only: keep the old provider until
`awaitCleanupConfirmation()` returns true, then create a new protection/Root epoch
and provider via the original factory. Reuse the dedicated completed profile
receipt and existing keys; unresolved init/gateway intents must be reconciled by
the existing official readback and are never replayed. Do not call `start()` again
on the old provider, reopen a closed Bridge, import old ACKs, automatically
resubmit a URL or move it to Standard. Native window retry UI remains its owner's
callsite responsibility; no window/main files are changed by this delta.

Run only the new local checks, without the prior43 checks or a backend:

```text
YNX_NYM_TEST_OUTPUT=/absolute/owned-external-output \
  bash apps/browser/privacy-routing/nym/tests/test-synthetic-nym.sh --startup-delta
```

The snapshot compiles actual Core and Native consumers in both normal and
acceptance configurations. New checks cover a cancellation-uncooperative late
factory, concurrent join, overlapping start refusal, parent cancellation, typed
stage failures and the actual NoTeam production entry/cleanup. The pause fixture
returns no protected endpoint or authority. Existing CI's normal synthetic probe
also includes these checks, requiring no new workflow job or duplicate local
backend tests. Actual vendor/GUI/public network/signed NE remain NOT_RUN.

The subsequent shared Gate cleanup contract is consumed without changing startup
ownership: every final polled receipt must be childReaped for the original prepared
PID (when preparation completed), match the same Gate's authenticated readonly
`cleanupChildPID`, **and** that Gate's readonly `cleanupConfirmed` must be true. Child exit
alone cannot release leases while helper/FD/file cleanup remains UNKNOWN. The
first Gate `stopFailure` is retained separately without printing raw details or
overwriting the provider's first cause. No-child/helper-only cleanup is not used
as a replacement child receipt. A nonzero or signalled but actually reaped child
can establish cleanup; it never establishes successful route startup.

Early cancellation can precede public `prepared` completion. In that case only the
Gate's actual postexec pipe-frame-validated `cleanupChildPID` may bind the real
childReaped receipt; missing cleanup identity remains UNKNOWN. That field never
populates `prepared` and cannot be used to resume the child or enroll a Root graph.

`test-synthetic-nym.sh --gate-cleanup-delta` runs only the new12 consumer conjunction
checks; it does not repeat the startup23 or earlier43/proof/backend tests. Real
shared-helper cancellation/stop tests belong to the original shared Gate owner.

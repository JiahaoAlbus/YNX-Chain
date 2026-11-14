This is an explicitly compiled destructive QA callee, not normal route admission.

The Core client is available only with `YNX_PRIVACY_ACCEPTANCE`. It has a private
initializer and requires the existing opaque `SyntheticTrialAuthority`, its real
completed self/WebKit canary qualification and current connected lease. NoTeam is
rejected before input files or XPC. The test provider additionally requires both
`YNX_PRIVACY_ACCEPTANCE` and `YNX_SYNTHETIC_PROVIDER_SELF_FAULT`, plus a strictly
Boolean sealed `YNXSyntheticProviderSelfFaultTesting` Info key. The unsigned-only
builder opts in with `--synthetic-acceptance --synthetic-provider-self-fault`.
It does not sign, install, activate, or choose a Team.

The signed provider channel checks the actual full audit-token peer and current
root incarnation, strict self seal/live CodeDirectory and executable hash,
same generation/epoch/profile/manifest/bootstrap binding, fresh heartbeat and
reviewed owned listener graph. It requires exactly one retained Root context,
same-root proof grants and the real prior WebKit TCP drop observations. A missing
WebKit UDP flow under native Lockdown is not manufactured. Other retained Roots,
stale/closed sessions, missing canaries and ordinary callers are refused.

`arm(authority:)` returns an opaque `SyntheticProviderSelfFaultAttempt` with an
`armed-no-fault` receipt. It changes no network permission. The dispatcher then
fsyncs one private exclusive per-run `commit-intent-not-applied` journal. The
provider ticket has a two-second continuous deadline, cannot be renewed, is tied
to the same connection and route sequence, and permits one successful commit.
The receiver repeats the actual checks before commit and exits only itself with
`_exit(86)`; it does not call graceful filter shutdown or return a success ACK.

All callers join the same bounded commit observer. Only an actual remote XPC
interruption/invalidation after commit can produce `transportClosedAfterCommit`.
A proxy error, timeout, refusal, local invalidate, armed reply or intent file
cannot do so. The dispatcher records `faultApplied` only as that explicitly
named closure observation. It never claims provider waitpid, causal proof of
self-exit, OS packet drop, or leak safety. All target authority is revoked after
a commit attempt. Missing same-provider remote closure ACK keeps whole-window
cleanup UNKNOWN and forbids automatic replacement or new requests.

The existing route-loss callee now uses the same durable intent fence and records
an observed effect only after owned-child reaping/helper cleanup and actual
Native WebView removal. It no longer sets `faultApplied` before stopping owners.

Portable new tests (fresh absolute output paths are required):

```sh
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/test_synthetic_provider_fault.py --output "$RUNNER_TEMP/ynx-provider-self-fault"
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/test_provider_fault_boundary.py --core-products "$RUNNER_TEMP/ynx-provider-self-fault" --output "$RUNNER_TEMP/ynx-provider-self-fault-native"
```

The first command compiles current actual Core with only the new 31 controls,
executes a harmless owned child's exact self-exit primitive, typechecks the real
provider selector and rejects an invalid normal build option before mutation.
The second reuses only that exact source/SDK-matched module, typechecks the real
Native dispatcher dependencies, and checks three compiler rejection boundaries.
Neither command runs product main, WebKit, a vendor backend, a socket, an installed
NE, or a genuinely signed XPC peer. Actual signed positive execution, crash-time
OS behavior, whole-window DNS/UDP/IPv6/RTC capture and original normal-production
approval remain separate, NOT_RUN or not supplied. Prior leak failures remain.

# Complete Native Tor startup coordinator

`TorProtectedRouteProvider` implements the existing PrivacyRouteProvider contract. Its constructor stores inputs only:

```swift
let provider = TorProtectedRouteProvider(
    protection: protection,
    helperSHA256: verifiedModeInfoHelperSHA256,
    explicitUserAction: actualUserActionID)
```

The parent supplies a fresh dedicated Tor BrowserRouteProtection and the SHA from its verified mode bundle's `YNXBackendStartGateSHA256`. Ordinary/Standard and Nym bundle identifiers cannot start this provider. It is one-shot: a second start on the same coordinator is rejected rather than replacing a pending/unknown process. No browser URL, cookie, user bridge string or ordinary profile is accepted as a startup/control input.

## Independent typed synthetic entry

Only `YNX_PRIVACY_ACCEPTANCE` builds contain the additional throwing initializer:

```swift
let provider = try TorProtectedRouteProvider(
    acceptanceAuthority: authority, protection: protection,
    helperSHA256: verifiedModeInfoHelperSHA256,
    explicitUserAction: actualUserActionID)
```

`authority` must be C's non-decodable opaque object after its actual signed
Root/self and WebKit canaries; Native checks exact authority/client/preparation
identity and epoch. Qualification is checked before any profile creation and at
each async generation boundary. NoTeam, exact mode/helper/vendor requirements and
original gate/graph/official readiness/output-discard/cleanup checks still apply.
The trial reuses the canary's Root preparation/client, rather than calling the
production current-admission path or minting another epoch. After real connect
acknowledgement Native confirms the authority's current route binding.

The synthetic profile is a separate0700 no-follow namespace below
`YNX Browser Synthetic Trials/Tor`, derived from its bound profile ID/run/epoch;
it accepts only the bundled public bridges and never reads ordinary/private/old
QA bridge state. The binding's profile SHA is the profile-ID hash, not proof about
directory contents. The normal initializer, current admission and production WK
factory are unchanged; compiling the flag alone grants no authority. The new
`TypedTrialEntrypointDeltaProbe.swift` checks this compile-flag boundary without
constructing an opaque authority or starting a backend/control/WK process.

All configurations from `TorRoutedWebViewFactory` now set the public native
`defaultWebpagePreferences.isLockdownModeEnabled = true`, retaining nonpersistent
storage and SOCKSv5 no-failover ordering. The local SDK declares the writable
property for macOS13+. Current official WebKit preferences mark PeerConnection
disabled in Lockdown mode; installed-engine packet/RTC behavior is still a
separate unrun qualification, not inferred LeakSafe. A navigation delegate that
replaces page preferences must retain the native setting. No JS/private-KVC
substitute or user-agent change is used.

Startup order is implemented, not deferred to a future caller:

1. Pure Team/role/helper-pin/port/current-platform-admission checks run first. NoTeam refuses before profile creation, XPC or a child. Current platform admission remains false.
2. Offline bundled source/binary hashes, fixed Arti/Lyrebird designated cdhash requirements and the exact helper bytes are checked. Prepare only the dedicated0700 production Tor profile; do not copy or use the old QA profile. Acquire the existing `.ynx-native-route.lock` with no-follow, owner/mode/nlink checks and nonblocking flock.
3. BrowserRouteProtection.beginBackendPreparation obtains real Root deny acknowledgement. The current own Root token must hash to that receipt. Path/sleep fences cover PT startup as well as Arti bootstrap.
4. Prepare independently suspended Lyrebird and Arti gates, synchronously tracking both in the parent protection owner before any child launch. Each post-exec process JSON must have the exact C six-field ProcessPin contract, expected executable path/hash/code requirement, complete token, pid and pidVersion.
5. Enroll the initial complete blocked graph, with Arti as entryOwner and its fixed loopback entry, Arti destinations empty, and Lyrebird destinations restricted to the already parsed numeric bridge peers. Each responsibleAppTokens array contains only this current dedicated Root token and that backend's own token. These are candidates, not a claim that kernel responsibility attribution was observed. Standard is never added.
6. Resume PT only with its graph ACK and fresh live-lease getter. Complete the bounded official PT protocol. It produces an endpoint, never Tor readiness. Write one new `protected-UUID.toml` exclusively (0600, no overwrite), with defer_bootstrap=false, watch/RPC disabled and the official external proxy_addr branch. Arti's main has not executed or read its configuration yet.
7. Update only the loopback edge in the same immutable graph: Arti destination is the PT endpoint, PT listeningEntries contains it. The NE owner checks actual listener ownership and returns a new graph ACK; no token, remote peer or responsible-app set changes. Both long-lived gates use `discardAfterBootstrap`. After the full PT protocol and this final graph ACK, Native supplies the exact consumed `CMETHODS DONE` line SHA and a fresh blocked lease to the PT gate, retaining its real typed discard ACK. No later read of the closed PT capture FD occurs.
8. Resume Arti with the second ACK, then await the existing official sufficient-bootstrap parser under the same 600s bridged cold-start bound as the existing adapter and helper128KiB pre-bootstrap capture bound, while checking both original processes and the live blocked lease. This coordinator always uses obfs4; its earlier 180s direct-entry budget was inconsistent with that bridge contract. Preserve the exact complete raw ready-line SHA, excluding LF and one optional preceding CR, retaining ANSI/spaces/logging prefix. Before any connect call, obtain the Arti gate's real marker/token/epoch/provider-generation-bound discard ACK using the latest graph and an immediate blocked lease. No Native drain/read occurs after the gate closes its capture FD. Both typed discard receipts are required by provider status. Only actual backend readiness may report connected to BrowserRouteProtection.connectReadyBackend. Its NE connect acknowledgement must become routeEntryConnected before start returns an endpoint. A watcher subsequently fences process/control/path/sleep loss. No direct fallback or managed replacement is attempted. The 600s application budget is not an upstream readiness guarantee and cannot turn a timeout into a successful route.

Shutdown has `cleanupStatus` (`notStarted`, `complete`, `unconfirmed`) and `cleanupConfirmed`. An unused/NoTeam provider is confirmed because it has no owner FD/gate. A running/unknown instance is not confirmed. All concurrent `stop()` callers await the same shutdown Task. `awaitCleanupConfirmation()` joins it and returns the resulting truth; returning from a second stop is not interpreted as a reap receipt. Root/content authority closes synchronously, original gates stop/reap asynchronously, and the original profile FD is released only when every possibly launched child has a real childReaped observation. Unknown keeps the original gates, PT and lock. The parent must retain this provider and mode app (terminateLater) until confirmation, and may retry cleanup of those same handles. The first failure category is retained even when cleanup later becomes unknown.

`ProtectedRouteCoordinatorProbe.swift` is a new standalone30-check module: pure preflight ordering, actual NoTeam start before a nonexistent profile can be created, blocked status/replay refusal, concurrent unused shutdown join, strict process JSON and graph authority boundaries, remote-peer invariance across the loopback update, real original-file flock exclusion, fresh-file non-overwrite/readback/0600 and old state-marker preservation. Graph tokens and peers are explicitly synthetic; none is enrolled. No child, XPC, network or WebKit is started by this probe. It does not run the earlier PT26, supply19 or response17 suites.

Compile current Core (including C's two additive gate/preparation sources), PrivacyTorPlatform.swift, BundledTorBackend.swift, TorExternalTransport.swift, BrowserRouteProtection.swift, TorProtectedRouteProvider.swift and this probe with Swift6 into `/tmp/ynx-p05-tor/protected-coordinator-probe`. Before those C files are copied into Core, add their exact original macos-filter paths as compiler inputs. The focused single-module compile has expected self-import warnings; normal Native imports Core separately.

Source and negative boundaries are implemented/compiled. Actual vendor resume, real NE graph/control enrollment, OS source-app attribution, full routed GUI/DDG/download and fail-closed network acceptance remain unverified. NoTeam and the current false platform gate intentionally block them; they do not stand in for missing coordinator code. Parent full Native/package/installation checks remain separate.

## Startup cancellation and diagnostic delta

The fixed Arti2.7.0 publisher source `src/subcommands/proxy.rs:318-337`
selects the Ctrl-C future concurrently with `client.bootstrap()`; its sufficient
bootstrap log is emitted only after the latter succeeds. The 600s deadline is
our bridged application budget, not a Tor guarantee. Fixed dependency
`tor-ptmgr0.47.0/src/ipc.rs:30-34` uses a 30s default PT startup timeout and a
5s managed-exit grace period. Our external PT handshake now uses that same 30s
startup allowance; it is separate from the 600s Tor bootstrap bound and does not
make `CMETHODS DONE` a circuit-ready signal. The managed upstream close-stdin
path at `ipc.rs:435-450` explains the selected `TOR_PT_EXIT_ON_STDIN_CLOSE=1`;
external PT ownership here still belongs to the independently pinned C gate.

Pre-cancelled `start()` checks cancellation before profile/control/child work.
Both readiness loops check cancellation/generation again after asynchronous
process polls, immediately before reading their original capture FD; PT also
checks its same gate/state after resume. This prevents a suspended poll from
resuming into a read after concurrent stop closed the descriptor. Cancellation
and a generation failure enter the same original-handle stop path. No new
recovery process or direct connection is attempted.

Public blocked diagnostics now preserve the first fixed category: PT startup
timeout, PT protocol rejection, bridge bootstrap timeout, process exit, lease
loss, network unavailable/path changed and sleep/wake remain distinct from
user/task cancellation. Unknown errors map to `startupFailed`; bridge addresses,
profile paths and raw vendor output are never interpolated. `cleanupStatus`
remains separately authoritative: a useful first cause does not convert unknown
reaping into success. In particular, real protected 600s startup cancellation
under NE remains NOT_RUN; existing exact gate and manual adapter reaping evidence
is reused rather than rerun or represented as a new protected positive.

The focused normal-build delta and reproducible CI command are:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_startup_delta.py "$RUNNER_TEMP/ynx-tor-startup-delta"
```

The directory must be new. The script snapshots exact Core/five Native inputs,
writes `inputs.json`, compiles with Swift6/macOS14, then runs only
`StartupCancellationDeltaProbe.swift` (28 checks). No opaque authority is made;
no vendor/helper, IPC, WebKit, GUI or network is started. Parent integration may
compile the acceptance flag in its normal shared cohort without repeating old
Tor test groups. Logs and scratch output stay at the caller-supplied path.

`OutputMarkerDeltaProbe.swift` adds only new byte-evidence checks: split/partial
markers, CRLF normalization, prefix preservation, fake module/deferred/no-proxy
rejection, capture bounds and full PT completion. It creates no gate, authority,
vendor or network request. C's independent real helper tests establish its own
post-marker discard/reap behavior; those tests are not replayed here and do not
establish a real Tor/NE protected route.

# Scoped macOS route filter and Native lifecycle

## Long-lived backend output boundary

`BackendStartSpecification.outputPolicy` defaults to `.boundedCapture`, preserving the
128KiB auxiliary JSON/bootstrap ceiling. Only a real long-lived vendor/PT owner opts into
`.discardAfterBootstrap`. After it has verified its official complete raw bootstrap line,
it calls `discardOutput(afterBootstrapMarkerSHA256:acknowledgement:lease:)` using the latest
graph ACK and an instantaneous blocked control lease. Hash the line excluding LF and one
optional preceding CR; keep all ANSI, spaces and log prefixes. Do not hash reconstructed JSON.

The exact owned helper verifies policy, resumed state, child audit-token SHA, request nonce,
and membership of that complete marker line in its own original bounded capture FD. It never
reopens the unlinked spool path. Only then it truncates the anonymous prefix, closes capture,
and acknowledges `output-discarding`. Later bytes are drained and discarded with saturating
counts. The Swift client validates bindings and live graph/lease before send and after
actual ACK, closes its reader, and returns typed `BackendOutputDiscardAcknowledgement`
(pid/runID/epoch/providerGeneration/backendTokenSHA256/markerSHA256/requestNonce/capturedBytes/
discardedBytes). No later read of backendOutput is valid. This receipt describes output
lifecycle and grants no NE or route permission.

`STATUS` includes capturing/discarding counts. Output EOF is not child death: only the
original helper's actual waitpid/reaped exit receipt can release ownership. Use
`sh apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/ci-output-discard.sh /absolute/fresh-output`
for the new seven controlled cases only. They preserve the auxiliary cap, reject
pre-resume/role/token/marker misuse, and exercise two 2MiB drains, output EOF while the child
remains live, and original-owner STOP/parent-EOF reap. No vendor or signed NE test is implied.

The preserved installed WebKit instrument (`e27080ea6544b6a003d8965cbe0074252a4979e1b8e50c6ecbda1bddfae787f7`) sent valid STUN over IPv4 and IPv6 before and after its owned SOCKS endpoint closed. That actual result remains **FAIL**. This code is compiled and its owned-process/protocol tests run; no authorized NE signature, installation, activation, source-app canary or new OS-filter enforcement has occurred. Production admission remains false.

The original 28-file delivery and its failures remain preserved. Current additional sources extend that module; no new GUI, application product, public service, global DNS/proxy/trust change or vendor patch is introduced. The user has no Apple Developer team and the existing zero-valid-identity result is reused, not re-queried.

## Build and focused CI

```sh
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/build.py \
  --output /absolute/fresh-external-output --test-start-gate
```

`ci-start-gate.sh /absolute/fresh-output` is the equivalent single CI entry point. The native CI owner can call it from the existing macOS arm64 job and upload the resulting directory. It builds the host, provider, seven-file pure Swift framework and own spawn helper; runs Swift 6/macOS 14 client/ACK/NoTeam checks, blocked graph policy checks, and the real owned-child suspended/EOF/stop test. No identity selection, `codesign`, profile download, system authorization, NE load, production backend launch or external network is performed. This entry point must not be reported as OS-filter validation. Other optional `--test-lease`/`--test-cohort` tests remain available; unchanged old green suites need not be repeated for this delta.

All output/module caches go next to the explicit output directory. Existing directories are rejected rather than removed. `build-receipt.json` binds source, command and binary hashes. A linker-generated ad hoc signature is not an authorized Developer ID signature. On the current host `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3` was killed with 137 before script entry; `/usr/bin/python3` executed this build successfully. The cause of the former was not inferred.

## Source and Native API boundary

Four previously frozen Native files remain byte-identical: `ControlProtocol.swift`, `ProtectionLease.swift`, `RoutedIsolationClient.swift`, `OwnedBackendAuditReader.swift`. The appended Native sources are `RootPreparationClient.swift`, `OwnedBackendStartGate.swift` and the later `RootClosureObserver.swift`. They depend only on those four files and public Foundation/Security/CryptoKit/Darwin APIs, with no C target or Package change. Parent owns Native copies, source binding, UI, lifecycle integration and production admission.

```swift
@MainActor RoutedRootPreparation.begin(configuration:) async throws -> RoutedRootPreparation
preparation.bindControlLease(_ client: RoutedIsolationClient) throws
preparation.reviewBootstrapBackendGraph(backendReviewJSON: Data) async throws -> BackendGraphAcknowledgement
preparation.close()

@MainActor OwnedBackendStartGate.init(helperExecutable: URL, helperSHA256: String,
    preparation: RoutedRootPreparation, directory: URL) throws
gate.prepare(specification: BackendStartSpecification) async throws -> PreparedBackendIdentity
gate.resume(after: BackendGraphAcknowledgement, lease: ProtectionLeaseView) async throws
gate.poll() async throws -> BackendProcessExit?
gate.stop() async
// gate.backendOutput: FileHandle; gate.observedExit: BackendProcessExit?
```

`PreparedBackendIdentity` contains `pid: Int32` and `processPinJSON: Data`. `BackendProcessExit` contains `pid`, optional exit code/signal and **observed** `childReaped`. `isRunning` is a convenience, never a substitute for ownership or waitpid. Before any `prepare`/child launch, Native must register the gate synchronously with its existing invalidation owner. Parent's `onGateCreated` callback does this.

`RoutedIsolationConfiguration(teamIdentifier:mode:runID:epoch:expectedBrowserSHA256:lifetimeSeconds:)` rejects missing/unconfigured Team before any IPC or child. Each mode is a separate LaunchServices application instance; Standard is never enrolled by product bundle ID. XPC uses exact Team/bundle requirements through public per-message `setCodeSigningRequirement`, not private auditToken/KVC. The root is bound to its complete public own-task audit token, path/hash, run, epoch and provider generation.

The additive `ScopedRootPreparationControl` protocol has `preEnrollRootDeny` and `reviewBootstrapBackendGraph`. A root-deny receipt acknowledges only an installed provider's requested deny policy; it is neither permission to network nor proof that the OS attributed every WebKit/DNS child correctly. A graph ACK is bound to the last accepted nonce/sequence/revision/root/generation, with only eligible independently pinned backend tokens. Pending, timed out, failed, malformed and closed updates revoke previous ACKs. A caller cannot replace its token list while retaining an old nonce. Resume fetches the bound live client lease immediately; a cached `ProtectionLeaseView` cannot renew a lease.

## Executable startup order

1. Build the actual mode configuration. Missing Team fails here, before IPC/children.
2. `RoutedRootPreparation.begin` authenticates to the provider and registers that exact root in deny-only state **before** backend launch.
3. Construct/track each gate, then prepare every backend suspended. The helper performs a real post-exec public `task_name_for_pid` plus `task_info(TASK_AUDIT_TOKEN)` read and live SecCode/path/SHA/pidVersion validation. Pre-exec relay tokens are never used. No user constructor/main runs before resume in the owned fixture tests.
4. Submit the complete initial `entryOwner`, `entries`, `backends` review through the frozen client `enroll`, which is always blocked. Then bind that client to the preparation. Review the same blocked graph to obtain the first ACK. No self-signed ready/state Boolean can grant it.
5. For external Tor PT: initial Arti destinations are empty; Lyrebird has only the pre-reviewed numeric bridge peers. Resume only Lyrebird with its ACK and a fresh client lease; parse bounded actual CMETHODS DONE and verify the actual listener.
6. While Browser remains blocked, update Arti destinations to that exact PT loopback listener and declare that listener under the Lyrebird pin. The provider verifies live listener ownership. The same pins, roles, responsible tokens, epoch and non-loopback peers are immutable; graph updates cannot learn arbitrary remote peers. Wait for the new ACK, then resume Arti with `defer_bootstrap=false` and consume its official ready parser.
7. Only actual backend readiness plus an explicit user connect request may call the frozen client's `connect`. Static platform admission remains a separate false gate. All future route re-requests require actual current state; no direct/other-route fallback or automatic user navigation is added.
8. On loss/close, Native synchronously detaches WK/cancels download generation, closes preparation, and stops every tracked gate. A heartbeat timeout that closes WK does not prove the OS had no direct-connect race after a filter crash/disable.

Arti's fixed version with `defer_bootstrap=true`/manual bootstrap does **not** release bootstrap on a SOCKS request when watch/RPC are disabled. A separate token must pin each PT process; an Arti parent token cannot authorize a managed child. The original Tor owner implements the official unmanaged `proxy_addr` branch and PT protocol, without modifying vendor bytes. The generic suspended launch permits a fixed `defer=false` Arti process to be enrolled before user code starts.

The initial graph and updates use the same `BootstrapGraphPolicy`: every loopback edge must end at another registered backend's verified listener; each role/responsible-app identity and non-loopback peer set stays fixed. No guessed/unregistered listener, wildcard UDP or arbitrary resolved address can enter the graph. The provider maintains separate Tor/Nym root contexts, never replaces one mode with the other, and preserves deny-only tombstones after control loss. Graph failure and expired control lease revoke graph authority and drop retained owned flows; a later heartbeat cannot revive it.

Nym immediate gateway startup must use the same suspended barrier. Exact numeric bootstrap/control-plane peer authority and a safely attributable DNS path are still needed before resume. Numeric plans do not solve system-resolver attribution. Current policy does not allow Root/WebKit SOCKS probing while blocked. An implementable consumer is a separate exact-pinned long-lived `nym-helper` probe: initial empty destinations; after the actual Nym listener exists, update its exact loopback edge and Nym listener, get a new ACK, then resume the helper; it stays idle after its bounded result until common stop. The Native owner still needs to supply that callee. A short-lived curl process is not a substitute, and no actual probe/NE handshake is claimed.

## Own helper supply, output privacy and cleanup

Fixed mode-bundle path: `Contents/Helpers/YNXBackendStartGate`. Each routed app must include its **own** helper; the gate rejects a helper borrowed from Standard/another app. The packaging owner records the post-sign binary hash actually supplied to that app. A C build hash is not a fabricated post-sign hash. Compile in two steps (never pass Objective-C ARC to the C source):

```sh
xcrun clang -mmacosx-version-min=14.0 -Wno-deprecated-declarations \
  -c IdentityBridge.c -o /absolute/external/IdentityBridge.o
xcrun clang -fobjc-arc -mmacosx-version-min=14.0 -Wno-deprecated-declarations \
  BackendStartGate.m /absolute/external/IdentityBridge.o \
  -framework Foundation -framework Security -lbsm \
  -o '/absolute/Mode.app/Contents/Helpers/YNXBackendStartGate'
```

These commands run with the source directory as cwd; `build.py` records fully absolute SDK/source/object/output arguments. No vendor backend is re-signed. Original A/signing owner retains the signing/notarization/release role.

The helper uses public POSIX spawn `POSIX_SPAWN_START_SUSPENDED | POSIX_SPAWN_CLOEXEC_DEFAULT`. A separate child stdin pipe stays open for managed PT (`TOR_PT_EXIT_ON_STDIN_CLOSE=1`); wrapper lifecycle commands never go to that pipe. Child stdout/stderr streams are explicitly selected and bounded to 128KiB. The one-shot private start manifest is unlinked after being read. After prepare, while the child is still suspended, Swift opens the exclusive new spool and unlinks its filename. The helper continues using its original FD and never reopens the path. Raw target-bearing logs thus have no profile filename and are reclaimed on FD close. This only removes this newly created ephemeral material; prior QA evidence, profile data and keys are untouched. Synthetic diagnostics preserve their receipts/hashes separately.

Stop closes child stdin, sends SIGINT, allows at most three seconds, then SIGKILLs and **waitpids its direct child**. A never-resumed child is killed/reaped without SIGCONT, so cancellation cannot accidentally execute initializers. Wrapper control EOF, parent death and SIGTERM use the same cleanup. Swift waits six seconds, may send wrapper SIGTERM and wait six more; it never SIGKILLs the wrapper and loses parent waitpid ownership. Only a real reap result produces `childReaped=true`. Missing receipt/exit stays UNKNOWN; retain original gate/state lock and prohibit replacement. Stop is idempotent, and prepare/resume cannot use a preparation after close/transport loss.

`GateLifecycleFixture.c` and `test_start_gate.py` exercise only generated local bytes and own child handles, with no vendor, user browsing or privacy ACK. They verify suspended state/absent constructor, anonymous output before resume, stdin held open, STOP/EOF/SIGTERM, stubborn SIGKILL+reap and explicit child stdin EOF. These are process-barrier facts, not OS network-isolation facts.

## Actual external gates and remaining owner code

No Apple team/authorized NE identity/profile is supplied. The original signer must supply an authorized Developer ID Application identity, the actual Team ID and matching content-filter system-extension profiles. `build.py` creates a reviewable `sign-reviewed.sh` and entitlements but never executes them. The separately registered LaunchServices host requires user approval for system-extension activation and content-filter configuration. Legacy file-enrollment/state commands remain diagnostic and are rejected as authority by this provider; routed Native self-enrollment is the current path.

**Still NOT_RUN:** signed XPC/provider load, actual LS-root→WebKit sourceApp token canary, attribution for backend helper sourceProcess/responsibleApp tokens, safely scoped shared-resolver DNS, new installed NE RTC/IPv4/IPv6/WSS/download fault enforcement, provider crash/restart/disable/uninstall, real Wi-Fi/sleep/wake and production admission. Zero socket observations, compiler success, fixture ACKs, ordinary 3-PID LS launch, node TLS calibration or this health lease cannot close those gates. Unattributed shared system DNS is neither allowed as private traffic nor solved by inspecting/blocking unrelated applications.

**Remaining own CODE:** Native's staged consumer/source-bound helper packaging; exact backend bootstrap peer exporters and long-lived protected probe callee; Nym's control-plane/user-DNS integration; actual system-provider attribution/fault runner once authorization exists. They are not all renamed as signing blockers. Other applications return allow before reading their endpoint/payload. The original RTC failure and four consumed public-tunnel attempts remain in evidence; no fifth public resource is authorized or started.

Primary public sources: [NE source-process audit token](https://developer.apple.com/documentation/networkextension/nefilterflow/sourceprocessaudittoken), [source-app audit token](https://developer.apple.com/documentation/networkextension/nefilterflow/sourceappaudittoken), [filter socket configuration](https://developer.apple.com/documentation/networkextension/nefilterproviderconfiguration/filtersockets), [Network Extensions entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.networkextension), [Apple filtering sample](https://developer.apple.com/documentation/networkextension/filtering-network-traffic). The installed public SDK supplies `TASK_AUDIT_TOKEN`, task-name APIs, `sys/spawn.h` suspended spawn and explicit loopback NE rules. Those API surfaces do not promise fail-closed OS behavior on extension crash; that remains an actual acceptance gate.


## Epoch replacement, permanent known-backend deny and observed control closure

The earlier per-root implementation could replace a context after only `ownerSession==nil`, rebuild its backend index and forget an old still-live/UNKNOWN process. If that backend's sourceApp was its own token, a new flow could become “unrelated allow.” The current `EpochProtectionPolicy.swift` and Provider close that owning-code boundary:

- New root preparation requires **both** old owner and preparation sessions already observed closed by the provider, under the provider lock. Consumer invalidation timing is not accepted as observation.
- Every successfully verified enrolled backend token is retained in a generation-local permanent deny ledger. Index rebuild/epoch replacement never deletes it. A retired sourceProcess token or retired self sourceApp token is dropped before any endpoint/payload read, including missing process attribution and UNKNOWN liveness. Previously known tokens cannot be re-enrolled under a new epoch. New backend tokens are registered only once.
- Quota exhaustion (8192 exact backend tokens) rejects a new enrollment atomically; it never evicts a deny entry to allow new work. Ordinary unrelated app tokens still return allow before endpoint/payload reads. A current known sourceApp with missing/unowned sourceProcess is dropped after selection, not converted back into unrelated traffic.
- This is memory policy for one provider generation, not durable OS crash/disable protection. Actual system-provider crash behavior is still NOT_RUN; no claim of cross-restart fail-closed enforcement is made.

The seventh pure Swift source `RootClosureObserver.swift` adds no new XPC selector and leaves the earlier six source files/helper byte-identical:

```swift
let observation = try await RootClosureObserver.awaitClosed(
    preparation: oldPreparation, timeoutMilliseconds: 5000)
// observation.state == .closedDenyOnly: control-close observation only, no network permission.
```

The `@MainActor` static method returns public `RootControlClosureReceipt`, retaining the preparation's configuration and original root-deny receipt after its idempotent `close()`. Native first reaps the actual operation child and reconciles its result/UNKNOWN journal, closes the owner client/Bridge and preparation, then calls the observer; only after it returns may a fresh independent preparation/epoch be attempted. Do not reopen a closed Bridge, repeat init, recycle a backend token or reuse an old graph ACK. If actual child reaping is UNKNOWN, keep its state lock and do not advance regardless of a closure receipt.

The observer uses an independent `NSXPCConnection`, the exact provider Team/service code requirement, and the existing authenticated `ScopedFilterControl.status(run,epoch,reply)` selector. Provider status now includes `controlClosure`:

```json
{
  "schema": "P05_OBSERVED_CONTROL_CLOSURE_V1",
  "runID": "exact-old-run",
  "epoch": "exact-old-epoch-UUID",
  "mode": "nym",
  "providerGeneration": "exact-original-provider-UUID",
  "rootAuditTokenSHA256": "exact-own-root-token-hash",
  "ownerControlClosed": true,
  "preparationControlClosed": true,
  "state": "closed-deny-only"
}
```

Outer status remains `P05_FILTER_RUNTIME_STATUS_V3`, with matching run/epoch/providerGeneration. Open controls use `controls-open`; inconsistent or unknown state is never a closure ACK. Receipt consumption validates outer and inner run/epoch/generation, mode and actual current own root-token hash against the retained original deny receipt. A late reply after the overall deadline, transport loss, cancellation, provider generation change, malformed/mismatched response, or UNKNOWN throws. The observer connection closing is not either original owner session and cannot itself satisfy the proof.

The provider emits `closed-deny-only` only when both sessions are nil, graph authority is invalid, Browser is blocked and its retained flow set has been dropped/removed by the provider path. The status is authenticated control-state observation, **not** proof the OS completed every drop, attributed shared DNS, or prevented a crash race. Static production admission remains false.

Focused continuing CI:

```sh
/bin/sh apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/ci-epoch-closure.sh \
  /absolute/fresh-external-output
```

It compiles host/provider/framework and the seven-file Native client with Swift6/macOS14, then runs only the new27 pure scope/reply-binding checks. The checks explicitly exercise old backend/self-app/missing-process tokens after new-epoch index replacement; old token reuse and atomic quota denial; both/single-session closure; wrong run/epoch/mode/root/generation; UNKNOWN/contradictory receipt and deadline rejection. They are labelled fixture-only, never a fake signed XPC response or real installed-system-extension test. Prior seven actual spawn-helper tests, DNS23 matrix and RTC failure are reused, not repeated by this command.


`--synthetic-acceptance` compiles the separate canary RPC only in the QA Provider. It never changes an allow rule. `SyntheticCanaryPolicy.swift` accumulates only exact owned flow callbacks with live sourceApp/sourceProcess attribution; self and trusted Apple WebKit identities are separate, and a new Root epoch discards the old canary evidence after both prior controls close. The two new canonical Native Core sources (`SyntheticCanaryProtocol.swift`, `SyntheticTrialAuthority.swift`) are bound to their identical Core copies by `RouteProtectionSources.json`. The authority itself is compiled with Browser Core, whose endpoint type it narrows; the standalone client framework does not manufacture a trial authority.

Real `ScopedSyntheticCanaryControl` responses are authenticated by the existing exact provider XPC requirement and additionally bound to the actual provider executable hash. Caller JSON is only a request to deny/observe exact loopback targets. It cannot supply drop events, a qualification, live route port or readiness. Provider route binding is returned only from the current connected, authenticated graph and verified actual owned loopback listener. Native revokes synchronously on canary transport loss; each later request still requires the real current lease. This does not establish OS crash/disable fail-closed behavior, DNS attribution, or full LeakSafe.


The flag-only proof-child path adds `SyntheticProofProtocol.swift` and `SyntheticProofAuthority.swift` as two further byte-bound Native Core sources (eleven bindings total). The Root calls `SyntheticProofParentRegistration.register(authority:manifestURL:helperAuditTokenSHA256:readyBackend:)` only after the real official startup parser, actual owned Gate discard ACK and final reviewed listener graph ACK, before resuming the independently pinned proof child. This uses a fresh **blocked** lease: requiring connected here would make the proof itself impossible. The Provider checks the authenticated routed Root, real canary callbacks, exact manifest bytes/hash and original scope, the live graph entryOwner and listener, and the actual `nym-helper` pin. The registration handle stays alive until cleanup.

The dedicated helper obtains `SyntheticProofChildAuthority.begin(binding:)` over its own real signed-provider XPC connection. Its complete self audit token, actual XPC PID/UID and code requirement must match the already reviewed helper pin. The informational binding passed on argv cannot create permission. The Provider supplies the one exact nonce proof URL, expected body hash and actual loopback entry port from its registered scope/graph; the helper's ordinary command arguments do not supply authority. The helper's signed bundle must include the actual `YNXAcceptanceProviderSHA256` pin as well as the reviewed Team/immutable proof-helper role. The capability's private initializer is not Codable or a ready Boolean.

Child authorization permits one GET with no body and no redirect/retry. Its 750ms lease is refreshed on the same connection; timing starts before the RPC so latency cannot add free lease time. A late first response, a connection loss before handler registration, an expired lease, graph generation change or a replay fails closed. After the actual HTTPS body is verified, the Root calls the registration's async `requireLive()` before entering connected; it observes a live authorized child on the same connection/graph rather than trusting the prior register reply. B coalesces concurrent status refreshes. Close/transport loss/expiry removes the grant and drops only that exact helper's retained flows; the known child token stays deny-scoped. Stop/sleep/wake invalidate these controls and drop retained helper flows, without automatically recreating authority.

Only the new proof delta is run by:

```sh
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/test_synthetic_proof.py --output /absolute/fresh/proof-child-delta
```

It compiles the actual macOS15 Provider selector and runs twelve pure post-identity lease/target negatives. It does not create an opaque authority or simulate a successful NE/XPC credential. The actual signed peer handshake, OS source-app attribution, DNS/IPv6/route-loss/crash behavior and HTTPS through this protected child remain NOT_RUN until a real permitted signing/activation environment exists. Production admission and normal `current` guards stay unchanged.

# Protected-window in-flight acceptance module

## Actual dispatcher and control transport

`ProtectedAcceptanceDispatcher.swift` is a compile-time `YNX_PRIVACY_ACCEPTANCE` entry.
Parent's real routed application/window host returns the actual protection/page after actual
provider/session startup and skips openHome only in this test role. Normal entry is unchanged.
`claims` catches the marker prefix; `parse` and construction reject NoTeam/current admission
before input/host/XPC/WK. The parent normal binary also rejects this reserved marker.

The single argument is `--p05-protected-acceptance=/absolute/private/launch.json`. Launch
schema `P05_PROTECTED_ACCEPTANCE_LAUNCH_V1` contains mode (`tor`/`nym`), manifest,
manifestSHA256, bootstrap, bootstrapSHA256, command and timeoutSeconds (10..600). Input files
share an owned0700 directory and are600 regular, single-link, without symlinks. Command
schema `P05_PROTECTED_ACCEPTANCE_COMMAND_V1` has only runID, sequence and operation in addition
to schema. Every changed command is consumed once; replay/unknown effects terminate control
without automatic retry. Operations are open, baseline, route-loss, fault-retry, close,
rebuild-quiet, request-user-retry, user-retry and finish. Real startup-ready precedes target
phases. The read-only100ms poll never starts a phase.

Route loss requires actual decoded WSS frames and an unfinished native download, then stops
only original tracked Gate handles. An applied action receipt contains actual child reaping
records/pin hashes; a request hash alone cannot be called an applied fault. The existing
provider must independently produce the actual blocked event. Whole close blocks/releases
the page, calls real owner shutdown, checks childReaped on retained handles, checks actual
page retained-view/download/panel state, then awaits the authenticated original-generation
RootClosureObserver receipt. Unknown closure is not permission to replace a route.

A rebuilt route can be connected with local bootstrap but no explicit target phase. Its
event says connected/idle-no-phase, never falsely "remote blocked". The orchestrator then
checks the real fixture's quiet window. A separate explicit request command is acknowledged
before user-retry dispatch. Neither event claims a human click. Other fault names have no
fabricated crash/disable/sleep action: they require a reviewed public owned callee/OS action.

`prepare-inputs.mjs` optionally takes a fifth CLI argument tor/nym and creates the private
launch, initial explicit open command and empty event file. This creates no process, route
or qualification. The parent starts the exact routed LS app; normal macOS `open -n -W
--stdout <existing600events> --stderr <ownedstderr> ... --args <argument>` supports stream
capture without a Process-only launch. Actual source-app responsibility still requires NE
canary evidence. `NativeProtectedControlBridge` binds exact rootPID/executableSHA/mode/input
hashes, sends atomic hash/sequence commands and consumes actual Native JSON lines. All
UNKNOWN operations poison further mutation; no bridge/zero-hit trace can produce PASS.

New targeted CI is `test-native-consumer.py --dispatcher-only --output <fresh-external>`
(actual new entry preflight only, not a repeat of old12), plus automatically discovered
`native-control-bridge.test.mjs` and `native-launch-inputs.test.mjs`. File-transport fixtures
are explicitly synthetic and do not stand in for a signed Native/NE runtime.

### Qualification for a controlled trial

The compiled QA entry requires `SyntheticTrialAuthority`: verify the Apple signature and
exact artifact pins, receive the Root deny ACK, and observe scoped WK/NE canaries before
permitting the controlled target. `RoutedProductionQualification` separately governs
normal windows. The trial scope accepts the fixture origins and nonce from the reviewed
manifest. A normal signed artifact still needs its own qualification and leak evidence.

This extends the original C fixture and Native lifecycle, separately from the archived `8a0e3fbdcb8e` candidate. It does not create another proxy/browser shell or permit privacy routing. The original RTC IPv4/IPv6 FAIL, four exhausted tunnel allocations, missing Apple Team/Developer ID/profiles and production admission=false remain visible. No public tunnel, GUI, privileged capture, global setting or trust change is performed by this module.

## Executable fixture and input preparation

Use the existing `startPublicNonceFixture({runID, acceptanceStreams:true, ...})`. Default callers retain the previous short proof/download/WSS behavior. The opt-in extension serves only generated nonce bytes under the same `/ynx-route-probe/<runID>/` prefix:

- `streamDownload`: 2MiB, 16KiB chunks every200ms (about25.6s), exact length/SHA; close records completion versus interruption. This reuses the earlier streaming-fault runner's generated chunk, bounded backpressure, partial-versus-final and WSS closure model; the old runner/receipt is unchanged.
- `longWss`: at most128 generated sequence/hash-bound frames every200ms, no reconnect and proper peer half-close cleanup. Server write records alone are not client receipt proof.
- Same-origin and cross-origin302 downloads, and a same-host HTTP downgrade302 negative. Missing second distinct reviewed origin returns409 instead of substituting a same-origin test. The fixture emits redirects; it never follows their destinations.

The original `P05_PUBLIC_NONCE_FIXTURE_V1` and its `publicFixture` field remain. Added `acceptance` is `P05_INFLIGHT_ACCEPTANCE_FLOWS_V1`, with the five paths, stream byte/hash/chunk/timing fields and WSS nonce/frame/timing fields. Existing `registerPublicOrigins` remains Quick-Tunnel-specific. Acceptance-only `registerOwnedTLSOrigins([originA,originB])` registers exactly two caller-supplied HTTPS443 DNS Host values in the **loopback** handler. It performs no DNS/request/deployment/TLS verification. Actual authority to use those resources and normal trusted HTTPS termination are separately required; this registration does not supply either. No fifth tunnel is permitted.

Materialize private immutable files from that existing target manifest:

```sh
node apps/browser/privacy-routing/leak-tests/acceptance-kit/prepare-inputs.mjs \
  /absolute/current-owned-fixture-manifest.json /absolute/fresh-private-output \
  OWNED_STUN4_PORT OWNED_STUN6_PORT
```

The command creates `manifest.json`, `bootstrap.html`, and `acceptance-inputs.json` in a fresh0700 directory, files0600. It starts no process/listener/network. The receipt supplies exact expected manifest/bootstrap SHA values; it never says ready or signed. The bootstrap requires two distinct exact HTTPS443 origins, the same run nonce and paths, and explicitly owned127.0.0.1/::1 STUN endpoints. An unavailable address family is missing coverage, never inferred safe. A real normal-TLS target supplier is not currently available, and all public resource budgets remain consumed.

## Real Native consumer, flag-only

`native/Sources/YNXBrowserNative/ProtectedAcceptanceConsumer.swift` is compiled only under `YNX_PRIVACY_ACCEPTANCE`. There is no production runtime switch. The parent owns its dispatcher and the existing `BrowserRouteProtection`, `RoutedBrowserPage`, actual provider, WKDownload/generation and page teardown. The C class consumes these actual objects, rather than using `BrowserSyntheticProbe`'s fixture SOCKS path.

Stable API:

```swift
let consumer = try ProtectedAcceptanceConsumer(
    protection: actualProtection, page: actualRoutedPage,
    manifestURL: ownedManifest, expectedManifestSHA256: exactManifestSHA,
    bootstrapURL: ownedBootstrap, expectedBootstrapSHA256: exactBootstrapSHA,
    record: persistSanitizedRunEvent)
try consumer.attach()
try await consumer.explicitPhase("baseline", sequence: 1)
// Wait for actual WSS >=2 received hash-matched frames and a real native download with
// bytes>0, committed=false. SavePanel/destination remains the real application's flow.
// Apply the exact reviewed fault and obtain matching actual blocked state.
// This attempt is expected to throw before evaluating JS once Native protection is blocked.
try await consumer.explicitPhase("fault-retry", sequence: 2)
```

Signing preflight runs before private input is read or WK is created. Input reading uses owner UID, regular0600/no symlink/nlink1/bounded files in one0700 directory; exact immutable SHA, nonce/origins/path prefix are checked. Root binding comes from the live-connected `acceptanceBinding(manifestSHA256:bootstrapSHA256:)`: consumer,mode,runID,epoch,providerGeneration,root token hash,executableSHA,rootPID and both input hashes. Every phase gets a fresh matching live binding.

`attach` calls the actual page `installAcceptanceBootstrap` using its protected WK instance, delegates and no auto Home load. Message handling requires `p05Acceptance`, main frame, expected HTTPS origin, strict run/phase/sequence and enum/type/bounds. Only real `startup/instrument-ready/sequence1` sets local `instrumentReady`; commands before that are rejected. No timer fabricates readiness. It emits no raw IP, URL, user file path or arbitrary text.

JS phases are exactly baseline,fault-retry,user-retry, one explicit command each. The script uses actual fetch/WebSocket/RTCPeerConnection/DOM download/frame APIs and never replaces them. Mixed-content WS construction can throw synchronously; that negative is caught so it cannot skip RTC. The script never calls a phase after load, recovery, a timer or a close event. `dispose` only closes its own instruments. A newly attached page may receive user-retry as its first local JS phase, only after Native's sequence3 guard.

For route-loss recovery, retain the old preparation, actually reap backends, reconcile journals and obtain the authenticated old `RootClosureObserver` receipt. Then create a **new** `BrowserRouteProtection(acceptanceMode:reviewedRunID:onLeaseLost:)` with the same public run nonce but fresh epoch, new provider graph and real readiness. No closed Bridge is reopened. Call `reattachAfterObservedClosure` with the new page/protection and old receipt; schema,mode,run,epoch,generation,root token and closed flags all bind, and new epoch/root/executable are checked. Wait for the new actual startup-ready before explicit user-retry sequence3. Same nonce is correlation only and grants no route/network permission.

Provider crash/disable may make the old generation's closure unknowable. Such a case must retain its partial journal and UNKNOWN; do not invent an old-generation receipt to force recovery, replay init, switch modes or restart under an old ACK. A separate explicitly requested fresh acceptance run can be considered after external system state is reconciled. The driver does not automatically elevate, signal a guessed PID, switch Wi-Fi, sleep the system, disable a provider or activate anything.

## Native and fault evidence contract

Native messages use `P05_PROTECTED_ACCEPTANCE_EVENT_V1` with immutable root binding, monotonically increasing recordSequence and monotonic timestamp. Instrument fields are runID,sequence,phase,kind,probeID,status,bytes,frameSequence,sha256,candidateType,addressFamily. Enum lists and bounds are in the class. Probe ID must match the event phase prefix. The page's opt-in observation seam records actual download-accepted/progress/destination/redirect/committed/failed and blocked, local random download UUID, generation, byte counts, cancel/allow scheme decision, bounded final SHA and commit flag. A click/request/server-completed record is not native file completion; compare actual final hash and generation. Default observation is nil; normal routes/logging are unchanged.

`driveInFlightFault` in `fault-sequence.mjs` is the reusable orchestrator. Its bridge must be implemented by the actual consumer/provider owner, not fixture helper sockets. It requires actual process/control binding; explicit baseline; received frames and uncommitted native download; action receipt for the exact fault; matching blocked readback; an explicit fresh same-route blocked rebuild; at least5s with no new target requests; and only then an explicit user request. It returns INCOMPLETE or FAIL, never PASS/admission. New requests after blocked/recovery-idle fail. Old server-buffered frame writes alone do not prove client receipt. On any exception `error.partialJournal` preserves applied actions/UNKNOWN before further work.

Required fault cohorts are route-loss,WebContent crash,provider crash,provider-disabled,sleepwake,network-switch, separately for Tor/Nym. Actual provider/capture evidence must identify the signed original provider generation and routed LS app/root full token, independent backend sourceProcess tokens, Apple WebKit tokens and normal Standard token exclusion. Only exact owned synthetic names/IPs/listeners may be observed. Shared resolver attribution remains unknown unless independently established; whole-machine DNS capture followed by filtering is prohibited. No raw BPF/sudo/self-trust is part of this module.

The control channel's heartbeat/local WK detach does not establish the OS no-direct race on extension crash/disable. Full scope/window/loss and TCP/UDP/DNS/IPv4/IPv6 coverage, normal-TLS/hash-bound successful HTTPS/WSS/download baseline, exact route-entry versus target correlation, blocked post-fault attempts, redirects, continued streams and completed-file readback are still necessary. No zero-hit/server/model Boolean can pass those gates. Default DDG result rendering and ordinary navigation/back/refresh/new-tab/download flows remain independent installed-client acceptance, never replaced by this nonce instrument.

Public SDK basis: [sourceAppAuditToken](https://developer.apple.com/documentation/networkextension/nefilterflow/sourceappaudittoken), [sourceProcessAuditToken](https://developer.apple.com/documentation/networkextension/nefilterflow/sourceprocessaudittoken), [filtering network traffic](https://developer.apple.com/documentation/networkextension/filtering-network-traffic). The installedSDK's `NEFilterDataProvider.h` explicitly exposes flow verdict updates outside callbacks; that API is used by the existing Provider, but its OS crash/disable behavior is not inferred from the header. No Developer ID/team/profile exists here; latest compiled unactivated host/provider is in `ne-epoch-closure-20261101-2`, not a signed-installed acceptance directory.

## New focused tests and CI

Node's existing `node --test` discovers `leak-tests/tests/acceptance-kit.test.mjs`; the focused command runs only the five new cases:

```sh
node --test apps/browser/privacy-routing/leak-tests/tests/acceptance-kit.test.mjs
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/acceptance-kit/test-native-consumer.py \
  --output /absolute/fresh-external-probe-output
```

The second command compiles the **actual** current Core source, eight actual Native source files plus standalone probe in one module with the acceptance flag, explicit selected Xcode SDK and macOS14 target. It neither enters product main nor constructs NSApplication/WK, restores profiles, opens XPC, launches a backend or uses network. It executes12 new NoTeam/nonce/private-input checks. Optional `--core-products` reuses a supplied exact SDK/compiler-matched module+static library; CI need not manufacture a SwiftPM `.a`. All input hashes are captured before compile and rechecked afterward. The parent owns adding this exact command to the existing macOS CI workflow; no Package/lock/product rebuild is needed.

Five new Node cases passed: exact full stream versus interrupted partial; three bounded redirect types and missing cross-origin; real **loopback-only** partial HTTP download and three decoded long WSS frames/close; no automatic JS traffic and mixed-WS/RTC behavior; explicit fault/recovery quiet semantics with no false PASS. These are controlled target/tool tests, not normal-trust WebKit or OS isolation. An initial test incorrectly equated server-written frames with client decoded count and was corrected; it then exposed a real upgraded-socket half-close leak, fixed with explicit server end cleanup. Failures remain recorded in the handoff.

The actual consumer compiled with its real page/protection dependencies under Swift6 and passed the12 preflight/input cases. The parent also typechecked default and acceptance builds from the same successor source snapshot. Neither fact is an actual connected protected-window test. The dispatcher/fault adapter's live invocation, authorized signature/activation, genuine trusted target supplier, real per-flow sourceApp/DNS and full-window fault cohorts are distinct outstanding gates. Missing consumer invocation is owning CODE; missing Team/profile is external authorization. The archived8a candidate and its existing ordinary QA are not overwritten by these successor tests.

The standalone runner has a45s runtime deadline and only signals its own `Popen` diagnostic handle on timeout. It then waits at most5s for its receipt/exit, retains stdout/stderr, and writes the source/SDK/core/compile/runtime evidence before raising. Timeout state is UNKNOWN and never triggers automatic retry; missing observed reap is not called complete. These failure-only driver branches received syntax validation after the successful source-fallback12 check; those12 checks were not rerun solely for this bookkeeping change.


The current compiled QA path uses `SyntheticTrialAuthority` instead of changing the production admission guard. Its factory performs the real self/Team check before reading private inputs, adopts the same Root preparation/control client/epoch, pins the actual helper and provider executable, and arms only owned ephemeral numeric loopback targets. The flag-only Provider selector records the actual NE callback identities before returning `.drop()`. Root TCP/UDP IPv4/IPv6 and WebKit TCP IPv4/IPv6 must each have an exact callback and zero traffic observed at the owned listener. A missing flow is never a drop. WebKit canary configuration keeps native Lockdown enabled; its absent UDP/RTC flow remains unobserved, and the opaque qualification explicitly says full LeakSafe is NOT_RUN.

`ProtectedSyntheticCanary.run(authority:)` creates a nonpersistent, Lockdown-enabled hidden WK with canary HTML and normal TLS handling. `ProtectedAcceptanceDispatcher` uses `openAcceptanceRoute(mode:runID:inputs:)`, the actual Root/trial/session/page, immutable manifest/bootstrap hashes and explicit phase commands. Tor uses its protected backend. Nym uses separate scoped epochs for directory and profile/gateway operations, plus a runtime epoch and an authenticated proof child. Each Nym epoch requires its own live authority. The signed installed path and OS callbacks still require an actual run. The synthetic scope provides no DuckDuckGo result evidence.

New differential checks (fresh external output; no installation, activation, signing or old suite):

```sh
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/platform-probe/macos-filter/test_synthetic_canary.py --output /absolute/fresh/canary-policy
/usr/bin/python3 apps/browser/privacy-routing/leak-tests/acceptance-kit/test-native-consumer.py --dispatcher-only --output /absolute/fresh/native-dispatcher
```

The first command typechecks the real macOS 15 Provider selector/drop implementation and runs only the pure callback reducer negatives. The second compiles actual current Core/Native source and checks the three new dispatcher preconditions, including real NoTeam refusal before any launch input/XPC/WK. Neither command is a signed NE positive, route baseline, DNS guarantee, crash/no-direct race proof or release qualification. Signed acceptance requires a real allowed Apple identity/profile, explicit system activation and actual live OS observations. `build.py --synthetic-acceptance` prepares the flag-only provider artifact, and the signed routed QA bundle must pin its actual final executable SHA as `YNXAcceptanceProviderSHA256` and the owned spawn helper as `YNXBackendStartGateSHA256`; no placeholder pin is accepted. The old production build remains flag-free.

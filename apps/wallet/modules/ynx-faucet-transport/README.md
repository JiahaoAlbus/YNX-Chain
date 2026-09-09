# Bounded Faucet transport candidate

Production is disabled. `createProductionFaucetTransport()` returns `null`, the
Android and iOS Expo adapters have an immutable compiled
`PRODUCTION_ENABLED = false`. The iOS bridge core is connected to its Foundation
engine, but its production constructor still rejects reservation/request with
`YNX_HTTP_UNAVAILABLE` without constructing an engine.
Neither adapter offers a caller-controlled activation flag, endpoint, headers,
credentials, client injection, or Fetch fallback. The App may show the read-only Faucet flow, but its production session/transport
factories remain null. No production request, signing, or balance-update path is
enabled by this module.

## Bridge API

The local module is named `YnxFaucetTransport`. Expo's existing `./modules`
discovery and `useExpoModules`/`use_expo_modules!` hooks discover it without
editing app.json, package-lock, Android settings, or the Podfile.

1. Synchronous `reserveTask("admit" | "rpc")` registers an opaque process-unique
   task ID before returning it. There are at most eight active reservations.
2. Async `request(options)` consumes that reservation once. `options` is exactly
   one of the unions in `index.ts`; extra keys are rejected. The purpose cannot
   change. A cancelled, expired, completed, or unknown ID cannot be recreated.
3. Synchronous `cancel(taskId)` is idempotent and retires the registered task
   before cancelling its native call. Cancel-before-async-start therefore prevents
   dispatch. Cancel after dispatch never proves that the server did not process
   the request. Each live async request settles once, including cancellation.

Admission accepts the original persisted `requestId` and exact canonical `body`
from `faucetAdmission.ts`. The native parser requires the original property order
`requestId,address,amount`, ASCII ID/address shape, positive decimal safe integer,
and no whitespace, escapes, duplicate/unknown keys, or replacement ID. It forwards
those original bytes. Full SDK address checksum, reviewed amount, owner, and
request hash binding remain the coordinator's responsibility. Native validation
does not grant user consent or authorize a claim.

RPC requests take `rpcId`, `method`, and `params`. The native engine creates the
JSON-RPC 2.0 envelope and accepts only:

| Method | Params |
| --- | --- |
| `eth_chainId` | `[]` |
| `ynx_getFaucetModel` | `[]` |
| `ynx_getDurabilityModel` | `[]` |
| `ynx_getTransactionDurability` | One lowercase `0x` + 64-hex hash |
| `eth_getTransactionReceipt` | One lowercase `0x` + 64-hex hash |

Every response is the actual HTTP fact:
`{url, redirected:false, status, contentType, cacheControl, body}`. 201/200 does
not mean funds arrived. 409/429/503 are preserved, not converted to success.
Only the trusted coordinator may validate ACK identity, RPC envelopes, chain/
model, the exact durable receipt, and persist observed facts. Any dispatched
transport error remains uncertain under the original durable request. A user
retry uses a new transport task ID with the **same original Faucet request ID and
body**; the host never invents a new claim or automatically retries.

## Endpoint and activation boundary

Compiled endpoint candidates are `https://faucet.ynxweb4.com/request` for admit
and `https://rpc.ynxweb4.com/evm` for RPC. The first is corroborated by the existing
same-origin landing page's relative `/request` fetch and its `/health` service
description. That observed public server was legacy build `64efa498fa99`, not
proof of the new admission contract. The RPC origin/path is the existing Native
client default. Neither fact is a production activation lease.

The admission source contract is Faucet commit
`3afb54910c7e894bd0d53093223c01d9576a9c52` (`docs/api/faucet-durable-admission-v1.md`,
`internal/faucet/server.go`); its Core contract is
`90643ffd38d970f526df99e96e818220330710f8`. Before enabling a platform, Central
must freeze the exact public origin/runtime and capability contract, and the
platform must pass its native acceptance tests. Server-side `/faucet/requests`
is not this Wallet's admission endpoint. No public POST was used to validate this
candidate.

## Android controls and measured boundary

The dedicated OkHttp 4.9.2 client uses no global interceptors, cache, cookies, or
authenticator. Redirects, SSL redirects, connection retries, and automatic
application retries are disabled. `RequestBody.isOneShot()` is essential: OkHttp
can otherwise replay a 503 with `Retry-After: 0` despite connection retries being
disabled. A second `writeTo` is rejected as an additional guard.

Request bodies are at most 1,024 UTF-8 bytes. Headers are checked before app body
accumulation; only JSON UTF-8 and absent/identity content encoding are accepted.
Exported header values are bounded to 256 characters, duplicate relevant headers
are rejected, and admission requires exact `Cache-Control: no-store`. The engine
uses a fixed 16,384-byte response buffer and at most one extra-byte EOF probe,
then a strict UTF-8 decoder. It never uses an unbounded body.string()/bytes()
operation or emits partial chunks to JS. This bounds the **application-owned
accumulated response bytes**, not all HTTP/TLS/Okio allocations or decoded String
memory. Native HTTP libraries have their own internal buffers.

Connect/read/write limits are five seconds, with a 15-second call timeout and a
separate reservation deadline. Android uses `elapsedRealtimeNanos`, so checks
also reject a late response after deep sleep. Registration, terminal transition,
and enqueue are serialized; body I/O does not hold the registry monitor. Native
background/activity destruction cancels reservations and blocks new work until
a real resumed event. Cancelled scheduled futures are removed immediately, so
rapid reserve/cancel does not retain an unbounded 15-second timer queue.

The JVM loopback tests execute the real engine/OkHttp/Okio using a local socket
server. The separate [Android runtime test APK](android/runtime-test/README.md)
also compiles the original engine directly and exercises it on Android ART,
including elapsed deadlines, bounded response decoding, cancellation and
single-use request bodies. It targets its own test package and does not contain
the Wallet, Expo adapter or account storage. Its installation and cleanup must
follow that project's device and package checks.

These HTTP loopback tests do not verify Android TLS, delivery of real Expo
Activity lifecycle events, all wire-level exactly-once behavior, or public
runtime availability. Direct engine pause/resume calls do not establish that
the OS delivered the adapter's lifecycle callbacks. Server request-ID
idempotency is still required.

## iOS bridge candidate and measured boundary

`YnxFaucetTransportModule.swift` contains a Foundation bridge core plus the actual
Expo/UIKit adapter under `canImport(ExpoModulesCore) && canImport(UIKit)`. The
module exports only `reserveTask`, `request`, and `cancel`. Its immutable
production gate is false; no JavaScript argument, caller URL or compilation flag
changes that constant. Host tests use a separate compilation-only constructor,
which creates the same real bounded Foundation engine at a loopback endpoint.
The production-off test exercises the actual production constructor through
native lifecycle events and verifies zero engine creations.

One bridge owns at most one engine and eight in-flight completion tickets. The
engine remains the authority for opaque reservations, purpose, lifetime and
single-use request-body streams. `request` cannot construct an engine or invent
a reservation. The serial bridge gate handles synchronous reservation,
cancellation and lifecycle changes. Engine completion only enqueues onto this
gate, avoiding an engine-lock/bridge-lock inversion. Ticket identity is removed
before external callback delivery, and queue-specific reentry permits a callback
to cancel or close without deadlock. An already observed POST can still have been
processed; cancellation does not assert otherwise.

The bridge starts paused. Module creation registers synchronous NotificationCenter
observers before scheduling a main-queue `UIApplication.applicationState` sample
for a lazily created module. A lifecycle revision prevents a delayed initial
sample from overriding newer resign/background/destroy events. `willResignActive`
and background synchronously pause/cancel; `willEnterForeground` also remains
paused until `didBecomeActive`. The local Expo 57 factories do not provide a
resign-active hook, so this observer is explicit. Module and AppContext destruction
close the engine, retire every ticket, and remove observers. Storage quarantine
is propagated by the JS Flow's abort/cancel path; this transport does not claim
an independent native SecureStore-quarantine notification before `cancel` arrives.

The engine uses `uploadTask(withStreamedRequest:)`, a task-bound initial body
stream, and nil plus cancellation for replacement/nonzero-offset streams. Its
response cap bounds only the application's accumulated bytes, not all buffers
inside Foundation. Darwin Foundation can expose wire chunked transfer encoding
as `Identity`; the engine validates that normalized representation and cannot
claim complete raw-header visibility or universal wire-exactly-once behavior.

The host harness compiles the actual bridge core and unchanged engine with the
macOS Foundation SDK and uses an isolated loopback HTTP server. Its synthetic
NotificationCenter events are not actual UIKit/Expo lifecycle acceptance.
`canImport` excludes the Expo/UIKit adapter on this host; root's separate iOS SDK
build must compile and validate that adapter. Production remains disabled pending
that native acceptance and a separately authorized endpoint/runtime release.

From the repository root, with a fresh audit output directory:

```sh
python3 apps/wallet/modules/ynx-faucet-transport/ios/Tests/run-macos-bridge-tests.py --output /absolute/new/audit-directory
```

This invokes Swift in language mode 5, the real bridge/engine, and a loopback-only
outer seatbelt. It does not build an iOS app, run UIKit/Expo, touch an existing
wallet, or use public Faucet/RPC endpoints. The nested CLI harness is not an
XCTest or a Pod test target.

## Reproduction

Use the existing pinned Wallet dependencies, Java 17, and Android SDK. From
`apps/wallet/android`, run:

```
./gradlew :ynx-faucet-transport:compileDebugKotlin :ynx-faucet-transport:testDebugUnitTest --offline --no-daemon
```

This compiles the actual Expo adapter and engine, then executes loopback JVM
tests; it does not build or install an APK. The standalone module explicitly
matches the existing release10 runtime's OkHttp 4.9.2, Okio 3.16.0, and Kotlin
stdlib 2.2.20 (the compiler remains the Wallet's pinned Kotlin 2.1.20).
From the repository root, Node 24 can run:

```
node --test apps/wallet/modules/ynx-faucet-transport/test/production-off.test.mjs
```

The commands above do not include a wallet secret, public account request,
public POST, or device mutation. The separately documented Android runtime
procedure installs and removes only its own test APK on an explicitly permitted
emulator. Build outputs are excluded from source control.

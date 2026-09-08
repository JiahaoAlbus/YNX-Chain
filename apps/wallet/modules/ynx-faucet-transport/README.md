# Bounded Faucet transport candidate

Production is disabled. `createProductionFaucetTransport()` returns `null`, the
Android Expo adapter has a compiled `PRODUCTION_ENABLED = false`, and the iOS
Expo adapter always rejects reservation/request with `YNX_HTTP_UNAVAILABLE`.
Neither adapter offers a caller-controlled activation flag, endpoint, headers,
credentials, client injection, or Fetch fallback. This module is not connected to
App, the Faucet admission journal, a wallet account, signing, or balance updates.

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

The loopback tests execute the real engine/OkHttp/Okio using a local JVM socket
server. They prove the tested native-library behavior, not Android device TLS,
OS lifecycle delivery, all wire-level exactly-once behavior, or public runtime
availability. Server request-ID idempotency is still required.

## iOS status

The iOS Expo bridge is an explicit unavailable stub. Its separate Foundation
engine is developed/tested independently; macOS Foundation compilation or
loopback behavior does not constitute iOS SDK, Expo bridge, or device acceptance.
The disabled bridge must remain disabled until those gates pass.

The intended engine uses `uploadTask(withStreamedRequest:)`, one task-bound
initial `needNewBodyStream` supply, and `nil` plus cancel for replacement streams.
Every delegate completion, including an unknown/cancelled task, must be called
once. This can reject Foundation-requested body replacement; it cannot prove
every underlying wire write is exactly once. A serial delegate executor must
enforce a 16-KiB cumulative buffer before append, strict UTF-8, no redirects,
identity encoding, finite native deadlines, and one terminal transition. A Data
chunk is already allocated by Foundation when delivered: the application byte
budget must never be described as a total Foundation/OS allocation limit.

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

No test includes a wallet secret, public account request, public POST, or device
mutation. Build outputs are excluded from source control.

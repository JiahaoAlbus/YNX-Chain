# Private Node → Go authority transport

This module opens a real AF_UNIX socket from a native N-API worker. Darwin uses
`LOCAL_PEERCRED` and `LOCAL_PEERPID`; Linux uses `SO_PEERCRED`. The socket and its
private parent directory must have the registered server UID and no group/other
permissions. UID, PID, the creating process PID and connection liveness are
checked again by native `Current`. They describe transport DATA, never an Agent,
Grant, account, Source, receipt or permission.

Build with the installed Node headers and compiler, without npm or downloads:

```sh
node cmd/ynx-secure-link-caller/build.mjs
sh cmd/ynx-secure-link-caller/check.sh
```

The build writes ignored `build/caller.node`. On the tested machine it uses Node
26.7.0, N-API 8 (runtime supports 10), Darwin arm64 and the installed Clang.
`NODE_INCLUDE_DIR` and `CC` are build-time choices only. The wrapper always loads
its local native binary and has no per-call binary, URL, fd or connection hook.
The check script also builds an isolated `caller-fork-test.node` with one fork
probe. That test binary is never loaded by the wrapper; the production addon
does not export the probe. It verifies both refusal in the child and that closing
the child's inherited descriptors does not shutdown the parent's connection.

```js
import {
  openAuthorityCaller, currentAuthorityCaller,
  exchangeAuthority, retireAuthorityCaller,
} from './private-caller.mjs';

const handle = await openAuthorityCaller({
  socketPath: registeredSocketPath,
  serverUID: registeredServerUID,
  serverPID: registeredServerPID,
  service: registeredService,
  connectTimeoutMs: 1000,
  requestTimeoutMs: 5000,
  routes: [
    {id: 'effect', method: 'POST',
     path: '/internal/auth/task-grants/effect',
     maxRequestBytes: registeredEffectRequestLimit,
     maxResponseBytes: registeredEffectResponseLimit},
    {id: 'effect-query', method: 'POST',
     path: '/internal/auth/task-grants/effect-query',
     maxRequestBytes: registeredQueryRequestLimit,
     maxResponseBytes: registeredQueryResponseLimit},
  ],
}, {signal});

currentAuthorityCaller(handle); // Fresh native checks, not a Source constructor.
const data = await exchangeAuthority(handle, 'effect', originalOwnedJSONBytes,
                                     {signal});
await retireAuthorityCaller(handle);
```

The registration is captured without getters/proxies, copied and kept private.
Only these two method/path pairs are admitted, each with independent limits up
to 16 MiB. Service is the fixed HTTP Host. Request/response Content-Type is exact
`application/json`; JSON and Auth semantics remain opaque. Node's original
`net.Socket` and `http.request` perform I/O and HTTP parsing. An internal Agent
returns only the once-transferred native fd; it cannot reconnect or retry.
There is no proxy identity header, redirect follow, model destination, receipt
route or query fallback. Non-2xx status and original bytes are returned as DATA.

A handle is branded in native memory and in a private WeakMap. JSON, copying,
prototype inheritance, snapshots and HTTP/context headers do not mint one. It
owns one connection and is consumed by one request. A subsequent explicit query
requires a new registered handle and the caller's same original operation/ref
bytes. The transport never chooses a new operation or replays an effect.

Preparation checks run before bytes are handed to HTTP. After that point any
failure retains `dispatchPossible=true`, its original error in `cause`, and
`responseProgress={bytesReceived,requestBytesWritten}` as byte diagnostics. This
private transport diagnostic is **not** the SDK's owned-member `error.partial`;
the module never creates that field or invents an owned child/Source.
Cancellation and timeouts preserve the original cause and do not imply the
effect failed. The caller retains its original UNKNOWN operation for authority
reconciliation. No response or error is converted into business COMMITTED.

Retire immediately prevents dispatch, shuts down the native owned duplicate,
destroys the Node-owned descriptor and joins its actual close event plus the
original in-flight promise. Drain rejection returns that same first failure.
Opening cancellation also joins the bounded native connect and closes its
descriptors before rejecting. The module never removes a socket or changes
another process's credentials, keys, data or permissions. Forked inherited
native handles cannot dispatch or shutdown the parent's socket.

Tests use temporary private sockets and PUBLIC opaque bytes. The separate Go
fixture invokes the real `NewLocalCallerServer`, `LocalCallerFromRequest`,
`LocalCallerFromContext` and fresh `Current`; both the Node client and Go server
check the other's actual UID/PID. It is an echo transport test peer, not an Auth
implementation. These tests do not prove production Auth/SDK admission, Source
verification, signature checks, operation settlement or deployment.

The reverse direction is implemented by `inbound-caller.mjs`. The actual
registered Auth listener must be retained and supplied to both
`acquireInboundCaller(req, registeredServer)` and
`currentInboundCaller(req, handle, registeredServer)`. These check the private
listener instance, original incoming request and a distinct native capability;
an outbound handle, copied request, other public factory or JSON cannot replace
that binding. Current reads original Go TLS/request materials through an
exclusive SCM_RIGHTS control FD without consuming the incoming body stream.
Auth still owns its request-candidate decoding, caller qualification and whole
response proof. See `internal/securelink/PROTECTED_CALLER.md` for the full
two-direction lifecycle. Run the inbound functional checks with
`sh cmd/ynx-secure-link-caller/check.sh inbound`.

For a synchronous local transaction fence after fresh capture, retain all three
original operands and call
`assertCurrentInboundCaller(req, handle, registeredServer)` from
`inbound-caller.mjs`. It returns `undefined` or throws, checks only observed local
custody and unchanged request/header DATA, and performs no OS/control I/O,
Promise, body copy or supplied getter. It cannot replace fresh asynchronous
`currentInboundCaller` or the actual Go TaskStore snapshot/receipt Current at its
CAS. A complete one-shot exchange does not retain a Go resource lease for later
Node work. The original request must stay alive through that resource's actual
release or cancellation.

The inbound check entry includes `local-fence.test.mjs`. With the already built
matching native addon, the new delta alone can be run without repeating the
older inbound groups:

```sh
node --test --test-timeout=15000 cmd/ynx-secure-link-caller/local-fence.test.mjs
```

The AI V6 ordinary-Go request runtime uses the separate
`openInboundTaskRuntimeServer` factory and native runtime brand. Its fixed
`ai-task-v6/effect` and `effect-query` routes are distinct from the existing TLS
authority routes. `currentInboundTaskRuntimeCaller` performs asynchronous
sideband Current; `assertCurrentInboundTaskRuntimeCaller` checks only observed
local custody. `exchangeInboundTaskRuntime` accepts the eight fixed producer
operations on the same request's exclusive control FD. No ordinary Go request
is presented as a native TLS channel. The original Go factory keeps its actual
business objects and context alive throughout the Node exchange.

See [the exact Go/Node integration contract](../../internal/securelink/TASK_RUNTIME.md)
for signatures, budgets, cancellation, UNKNOWN and drain. To build the matching
normal native addon and run only this runtime's functional checks:

```sh
sh cmd/ynx-secure-link-caller/check.sh runtime
```

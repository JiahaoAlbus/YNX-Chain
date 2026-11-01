# Original Go request to private Node task runtime

This private transport carries the Auth owner's fixed AI V6 runtime commands.
It adds no daemon, public RPC, signing domain, Root, Source, account, session,
issuer or business permission. The actual Go business implementation and normal
factory belong to Auth; the concrete Server/TaskStore and CAS belong to P08.

The transport registration follows the frozen
`AUTH_AI_V6_PRIVATE_RUNTIME_TRANSPORT_CONTRACT/v1` contract, SHA-256
`535a1a8375ef17552026f0d16c09330d484141e99855dd4ea681ec31f793900a`.
The producer's eight operations remain DATA contracts, not a JSON authority
constructor. Operator-owned socket, UID/PID, service and Root registrations
must be supplied before a real product starts.

## Go composition

Import `github.com/JiahaoAlbus/YNX-Chain/internal/securelink` in the original Go
process. Its actual normal handler retains the original `*http.Request`, its
context, Server and Store throughout the Node exchange. Construct one
`NewOriginalTaskRuntimeForwarder(TaskRuntimeForwarderConfig)` with the fixed
private Node socket/service/UID/PID and the Auth-owned `OpenSession` factory.
The factory is required; request JSON cannot supply or replace it.

`Forward(originalRequest.Context(), originalRequest, kind, originalNodeEnvelope)`
accepts only `effect` or `effect-query`. These select the exact POST paths:

| Kind | Node path |
| --- | --- |
| effect | `/internal/auth/ai-task-v6/effect` |
| effect-query | `/internal/auth/ai-task-v6/effect-query` |

The complete forwarded JSON envelope is bounded at 1,835,008 bytes; its complete
HTTP response is bounded at 2,097,152 bytes. The Auth owner builds and checks
`method`, `path`, `proofHeader` and canonical base64url `bodyOriginal` from its
actual captured request using the sole SDK. LINK copies and carries those bytes
unchanged. It does not reserialize or independently qualify the business body.

`TaskRuntimeOpener` receives the derived original request context, the exact
original request and a privately minted `*OriginalTaskRuntimeCaller`. It returns
the original owner's `TaskRuntimeSession` and an error. A nonnil partial session
is adopted before any error is interpreted. It must retain late partial product
resources and release them through its own lifecycle.

The session implements these eight concrete methods, each accepting
`(context.Context, []byte)` and returning `(TaskRuntimeReply, error)`:

| Opcode | Method | Operation |
| --- | --- | --- |
| 1 | Capture | capture |
| 2 | CaptureConversation | capture-conversation |
| 3 | ExecuteLocal | execute-local |
| 4 | Observe | observe |
| 5 | Outcome | outcome |
| 6 | ObserveOutcome | observe-outcome |
| 7 | ReconcileObserve | reconcile-observe |
| 8 | Release | release |

`TaskRuntimeReply` contains `StatusCode` and owned `Body` DATA. The session also
implements `Current() error`, `Retire()`, `Join(context.Context) error` and
`Close() error`. Auth owns the actual resource selection and enforces its limit
of 16 held resources per request, original-operation binding, single business
execution and original-only recovery. LINK cannot choose a resource by locator.

`caller.Current(ctx)` performs fresh transport checks outside a Store lock.
`caller.CurrentOriginalRequest(exactOriginalRequest)` is the synchronous local
lifecycle fence. It checks this original request and observed local flags without
OS/control I/O, Store access or callbacks. It does not manufacture the old
`LocalCaller` or claim that an ordinary Go HTTP request arrived over native TLS.
The real Go CAS must independently AND its actual P08 snapshot/receipt Current
and the original Auth qualifications.

The original request is consumed once by Forward, including after a lost ACK.
The marker remains until that original request context ends, with a finite
registration bound. Reusing the same request cannot open another exchange.
The memory-only fence also binds its original headers, bounded at 256 KiB,
including the original proof header. Consuming the original body is allowed;
replacing its reader is not.

## Node composition and protocol separation

The original Node normal factory imports
`cmd/ynx-secure-link-caller/inbound-caller.mjs` and retains the actual server from
`openInboundTaskRuntimeServer(registration, originalHandler)`. Its resolver uses
only that registered instance with:

```js
const held = acquireInboundTaskRuntimeCaller(originalRequest, registeredServer);
try {
  const transport = await currentInboundTaskRuntimeCaller(
    originalRequest, held, registeredServer);
  const reply = await exchangeInboundTaskRuntime(
    originalRequest, held, registeredServer, 'capture', ownedRequestBytes);
  // Auth interprets reply as DATA and keeps its independent qualifications.
  assertCurrentInboundTaskRuntimeCaller(originalRequest, held, registeredServer);
} finally {
  releaseInboundTaskRuntimeCaller(held);
}
```

The runtime native brand and SCM marker `A` are distinct from the original TLS
authority's marker `L`. Its Current metadata has profile
`AUTH_AI_V6_PRIVATE_RUNTIME_TRANSPORT/v1`, service, exact carrier method/path,
Host, Content-Type and Content-Length, followed by the owned original Node
envelope. It has no TLS Channel, exporter or invented Source. Old TLS accessors
cannot reinterpret a runtime request as the old authority caller.

On that same exclusive control FD, `C` performs a fresh original transport check
and the Auth session's phase-aware `Current()`, then rechecks transport. `T`
carries one of the eight opcodes with bounded opaque request bytes. The existing
length-prefixed Current frame remains in use for the independent runtime
metadata shape. The T request is `T`, one opcode byte, BE32 body length, body;
the reply is BE32 payload length, BE16 status, one error-present byte and body.
Requests are bounded at 1 MiB and reply bodies at 32 MiB. C and T share the finite
64-command request budget and are serialized. Unknown opcodes, malformed frames,
overflows and lost acknowledgements terminate the capability; nothing retries.

A business method's error retains its exact raw reply DATA. Node throws an
`InboundTaskRuntimeError` with `responseData` and dispatch uncertainty; it does
not use the SDK's owned-member `error.partial`. Go retains its original first
cause and may return reply DATA together with an error from Forward. The normal
Auth adapter must adopt that DATA before interpreting the error, without
treating it as an admitted business outcome. `execute-local` may enter only
once. Release, including an error reply, terminates further reverse commands.

The 32 MiB private DATA budget does not enlarge the signed V6 body limit of
1 MiB. An oversized original observation must fail or use actual product
pagination. It cannot be truncated and signed with its previous digest.

## Lifetime, uncertainty and drain

Intermediate control replies do not return the outer Go HTTP exchange or cancel
its source context. The original context stays alive until the actual Node
response, release, timeout, cancellation or retirement. `context.WithoutCancel`,
background keepalive and a replacement request cannot extend it. A release ACK
retires the reverse capability while the actual final HTTP response may drain.

Node's synchronous assertion checks observed local custody only. It is not a
remote Go read or cross-process atomic check. Node SQLite and Go product CAS
remain separate commits. A business commit may invalidate its writer snapshot;
Auth's session Current must then use its actual retained outcome/observation,
never relabel that obsolete writer epoch as response permission.

Retire denies new work and cancels active request contexts. Join drains the
actual control work and owned sessions. Failed child drain retains the parent
and first cause; Close cannot report success from an empty bookkeeping table.
An uncertain dispatch preserves the original operation and UNKNOWN state. The
original authenticated lookup recovers its durable result; there is no automatic
mutation replay or new operation ID. Transport response/error DATA never means
Root admission, COMMITTED, installation, deployment or usable product delivery.

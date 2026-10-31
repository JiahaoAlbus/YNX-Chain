# Fixed peer caller and actual request channel

`NewFixedPeerClient(FixedPeerClientConfig) (*FixedPeerClient, error)` supplies a
product-neutral native S3 wire caller. It does not import AI, Shop, Auth or SDK
schemas. An absent profile/service credential fails unavailable. There is no
environment admission flag, ordinary HTTP/TLS fallback, automatic retry,
redirect, response cache, new operation ID, receipt endpoint or invented Source.

The operator/catalogue supplies `FixedPeerProfile`: ID, positive decimal
Revision, logical Service, EdgeID, exact LocalSAN/PeerSAN, fixed HTTPS Origin and
TCP Address, positive Epoch, explicit root fingerprints/windows, and immutable
Operations. Each `ServiceOperation` has an ID, one exact Method/Path and bounded
MaxRequestBytes/MaxResponseBytes and an immutable `MediaProfile`. Copies returned
by `Profile()` cannot change the client. A per-call destination, path, identity
header, method or media-profile registration is not an argument to `Exchange`.

The actual P07 carrier is `POST /api/tools/shop.order.read`, with opaque original
SDK E5 request at most 1 MiB and canonical JSON response at most 1 MiB. The
operation ID is `shop.order.read`. Register this new DATA contract explicitly:

```go
securelink.ServiceOperation{
    ID: "shop.order.read", Method: http.MethodPost,
    Path: "/api/tools/shop.order.read",
    MaxRequestBytes: 1 << 20, MaxResponseBytes: 1 << 20,
    MediaProfile: securelink.MediaProfileShopOrderReadV1,
}
```

This finite profile accepts only request
`application/vnd.ynx.shop-order-read.v1` and a single response Content-Type value
equal to `application/json`. Parameters, different casing and aliases are
refused; the request MIME is not also enabled for responses. `Accept` advertises
only the response MIME. Registration rejects another operation/method/path or
budgets above either 1 MiB ceiling. Lower supplied budgets stay lower. LINK does
not inspect or rewrite E5 framing, signed inner channels or canonical JSON; the
original SDK validates those bytes as DATA and the original authority separately
verifies Source and the same operation/ref before settlement.
The 1 MiB request ceiling applies to the full E5 envelope; it does not change
the SDK's independent limits on the enclosed original input or proof fields.

The empty media profile and explicit `MediaProfileJSONCBOR` retain the original
exact JSON/CBOR request types and the original parsed JSON/CBOR response MIME
compatibility, including response parameters. Their existing operation budgets
are unchanged; in particular the old 32 KiB fixture is not enlarged by this new
registration. An unregistered vendor request is denied. No arbitrary MIME list,
wildcard or caller-provided media profile is admitted.

The contract used for this change is the original SDK's
`schema/shop-order-read-transport.json`, SHA-256
`04d0a2b7b933ef1b01979e6bdfb449d31d05003e0102c552890eb46e24a88118`.
It explicitly remains DATA-only, with Source and operation verification false.
Registered service/SAN, origin/address, root epoch/fingerprints and credentials
remain supplied by their original authorities. Test identities are not defaults
for that registration.

```go
client, err := securelink.NewFixedPeerClient(securelink.FixedPeerClientConfig{
    Profile: registeredProfile,
    TLS: native.Config{CertFile: serviceCert, KeyFile: serviceKey,
        CAFile: distributedRoots, PeerSAN: registeredProfile.PeerSAN},
    Timeout: 30 * time.Second,
})

response, err := client.Exchange(ctx, "shop.order.read",
    func(ctx context.Context, actual securelink.AuthenticatedChannel) (securelink.WireRequest, error) {
        // Original Source/SDK checks current authority and the exact registered
        // target, then encodes its own signed wire bound to this actual channel.
        // No new SDK/Auth method or serialization is defined by this example.
        return originalSDKPrepare(ctx, actual)
    })
```

`PrepareWire` runs after the native handshake, on the exact connection used for
the resulting request. Its actual `AuthenticatedChannel` contains Peer,
LocalSAN, a stable process-local ConnectionID, and the 32-byte standard RFC 9266
exporter. Exporter slices are detached copies. The client rechecks the live
service gate/cancellation after preparation and before writing. Prepared body
bytes are copied and sent unchanged on that same connection. Callbacks must
return owned/stable bytes and perform original current Auth/SDK checks; S3
transport identity alone never authorizes a tool/resource. Exporter data must
not be logged or reinterpreted as an Agent proof or private TLS key.

The client's POST carrier uses full per-request service admission even though
the registered business tool is a read. It never invokes the GET/HEAD fast path
or treats transport Risk as the product's Tool.Risk. Original per-request
business/Agent/Grant authorization remains with Auth and the producer.

`WireResponse` contains only bounded opaque Body, original ContentType,
StatusCode, and the channel used for the request. Non-2xx status is returned as
transport DATA, not business success. The original SDK must decode and verify
the exact response operation, protected Source/SourceBytes and binding. LINK
does not copy an original operation/ref from the request or an HTTP header into
a supposedly verified result. Even HTTP 200 has no COMMITTED/author/receipt
meaning here. A lost response returns an error without retry; the caller keeps
its existing operation and UNKNOWN state.

## Direct producer bridge

The actual Go producer uses `NewHTTPServer(HTTPServerConfig{TLS:serverTLS,
Gate:gate,EdgeID:edge,Handler:originalProductServer})`. At its normal SDK decode
boundary, call `ServiceChannelFromRequest(r) (AuthenticatedChannel,error)`.
The server privately binds the original request to its live native endpoint;
the accessor rechecks service policy, revocation and expiry every time.
Headers, diagnostic State/Peer values, copied contexts/requests, changed URL/
method/host/raw target and closed/revoked endpoints cannot manufacture that
binding. The exact request must reach this accessor before middleware replaces
it. A caller-created AuthenticatedChannel is only data and confers no authority.

The bridge is process-local. The generic IPC proxy does not serialize it into
HTTP headers or make a backend request the same TLS endpoint. A producer behind
that proxy cannot use this API to claim an end-to-end channel; use the direct
native Go endpoint or an originally admitted channel bridge supplied by its
owner. No proxy-header bypass is provided.

## P08 thin-adapter boundary

Before calling Exchange, the AI-owned adapter compares its actual immutable
registered Sink/tool/profile and current session/operation with the caller's
operands. Original task/step/op/ref/Grant/holder/binding bytes stay unchanged.
No model URL/role/tenant/approval selects a transport profile.

P08's earlier `EncodeShopOrderRead` call happened before transport acquisition.
That ordering cannot claim binding to a subsequently acquired TLS exporter.
The product/SDK owner must move actual channel-bound encoding into PrepareWire,
or supply its real SDK check that the already encoded wire binds the live
channel. In the absence of that supplier contract, fail unavailable before
emitting the bytes; do not patch/re-sign a previously approved Input locally.

`QueryShopOrderRead` belongs to the original Auth Source's authorized history
query for the same original operation/ref. P07 creates no durable read receipt
or new remoteRef and provides no GET operation-receipt route. Therefore LINK
does not supply a Shop query operation. An undeclared query ID is denied before
opening/sending a request. If the original query authority later supplies a
separate network profile and exact route, it may use another FixedPeerClient;
otherwise it is a direct original Source call. Missing query authority stays
unavailable/UNKNOWN and cannot fall back to another Shop POST.

Focused functional tests use actual native TLS and explicitly isolated wire/
handler fixtures. They prove channel-before-encoding, exact carrier/body,
request sealing, current revocation, bounded I/O and no retry/query fallback.
They do not prove production Source/signature admission, SDK response semantics,
live Shop business, installation or deployment.

## Original local caller to private Auth source

`NewLocalCallerServer(LocalCallerServerConfig)` reuses `ListenPrivate` and
requires one registered OS UID/PID, service (also the exact HTTP Host), finite
method/path registrations and bounded I/O. Only its actual Unix connection can
mint `LocalCaller`. The server captures the exact bounded opaque request body
before invoking the handler and gives that handler an independent reader. It
does not decode or modify the original Auth service body.

Inside that handler, use `LocalCallerFromRequest(r)` and pass the original
`r.Context()` to the private Auth client. Its normal derived timeout contexts
can use `LocalCallerFromContext(ctx)`. `caller.Current(ctx)` rechecks the actual
OS UID/PID/fd, original request/target and request lifetime, returning owned
`RequestBody` plus service/method/path/content-type/length transport materials.
Copied requests, identity headers and fabricated contexts cannot acquire a new
caller. Ending/cancelling the original request, closing the peer or retiring
the server invalidates its handle. OS process identity is not account, holder,
Grant, Source or business approval; the original private Auth provider must
independently qualify the original caller and signed call.

When that same live local caller context reaches `FixedPeerClient.Exchange`,
the actual exchange also retains a private process-local binding. At the
original Auth `VerifyOriginalAuthorityResponse` boundary, call:

```go
exchange, err := securelink.ProtectedExchangeFromResponse(ctx, response)
material, err := exchange.Current(ctx)
```

The accessor accepts the actual unchanged `WireResponse`, not a diagnostic
`AuthenticatedChannel` or serialized header. It checks its private binding to
the original local caller, registered profile/operation and actual native TLS
connection. `Current` rechecks both live endpoints and returns detached copies
of the original local request, actual protected request and full response bytes,
status, MIME and current channel. Zero/copied handles, changed response bytes or
metadata, another caller, revocation and a released local request fail closed.
An ordinary non-IPC Exchange remains supported but supplies no such private
caller bridge. Source verification must finish before the local handler releases
its caller; saving/exporting the material cannot revive the handle.

These materials define no receipt/proof domain and confer no authorization.
Auth alone verifies the complete original response proof, issuer, current
state, original operation and body/resource qualification. SDK alone owns the
public schema and normal composition. Missing original Source/Root registration
continues unavailable; a public LINK constructor cannot fill its admission list.

`DispatchError` preserves its original `Cause` through `Unwrap`, reports
`DispatchPossible` immediately before the original write, and counts only
actually observed `PartialResponseBytes`. It never asserts that an uncertain
write did not happen, translates a native first cause into a fabricated receipt,
retries, or chooses an operation. The Node native caller in
`cmd/ynx-secure-link-caller` similarly preserves cause/dispatch uncertainty and
uses separate `responseProgress` diagnostics. It does not define `error.partial`:
the SDK's existing partial field belongs to an actually produced owned native
child, with child-before-source drain semantics.

Local server `Retire` blocks new dispatch and cancels active handles. `Join(ctx)`
is the real handler drain; `Close` reports `ErrLocalCallerDraining` while handlers
still own work. Native caller retirement joins its single attempt and closes
only its own descriptors. Neither side deletes an existing socket, reconnects,
replays an UNKNOWN operation, or borrows Wallet/IDE native handles.

## Original TLS request into the Node authority

Use `NewAuthorityIPCIngress(AuthorityIPCIngressConfig)` as the real
`NewHTTPServer` handler. It requires the server's private original TLS request
binding, exact registered POST/JSON routes, original unconsumed body and explicit
Content-Length. It refuses ordinary/copy requests, replaced or partially read
bodies, changed length/MIME, chunked framing and identity headers. Each request
uses one fixed Node Unix endpoint with current UID/PID checks and no retry.

The ingress transfers one private per-request control socket through
`SCM_RIGHTS` before the unchanged local HTTP request. The Node native listener
accepts only the registered Go bridge UID/PID, retains that control FD privately,
and gives only the data FD to Node's original HTTP parser. Its distinct inbound
tag/request WeakMap cannot accept an outbound handle or caller-created request.
There is no channel/caller header or JSON capability token.

The original Auth bootstrap holds the actual server returned by
`openInboundAuthorityServer(registration, originalHandler)`. Its private resolver
must use the instance-bound forms:

```js
const handle = acquireInboundCaller(nativeRequest, registeredServer);
const material = await currentInboundCaller(nativeRequest, handle,
                                            registeredServer);
releaseInboundCaller(handle);
```

`Current` calls Go through the exclusive FD and rechecks the original TLS
request/Gate, exact Node peer, route and lifecycle every time. Returned Body and
exporter are owned copies; Host describes the original TLS Host, while the local
HTTP Host is the fixed registered Service. It never consumes or replaces the
original Node request stream. Auth reads/compares that stream and parses its own
untouched request candidate, including its original nonce/narrowing data. LINK
does not produce Nonce, Account, role, business ctx, Source or receipt evidence.

Repeated acquire of the same request returns the same handle. Logical release
does not close the socket before the response producer finishes; response
finish/close, abort and retirement invalidate it. Retirement stops new accepts
and dispatch; Join waits for native accept/current work, returned handler
promises and actual socket closure. The Auth owner remains responsible for
children outside its returned promise. The general unbound accessors prove only
transport provenance and cannot replace the original registered listener.

Functional evidence separately covers Node outbound, Node inbound, Go material
seals, and a composed real Native Node -> Unix caller -> native TLS -> restricted
Unix/SCM -> Node original request pipeline. Synthetic credentials and opaque DATA
fixtures do not establish production Source admission or whole-response proof.

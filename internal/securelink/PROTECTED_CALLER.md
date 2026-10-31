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
MaxRequestBytes/MaxResponseBytes. Copies returned by `Profile()` cannot change
the client. A per-call destination, path, identity header or method is not an
argument to `Exchange`.

The actual P07 carrier is `POST /api/tools/shop.order.read`, with opaque original
SDK request at most 32 KiB and response at most 1 MiB, application/json or
application/cbor. The operation ID is `shop.order.read`. Registered service/SAN,
origin/address, root epoch/fingerprints and credentials remain supplied by their
original authorities. Test identities are not defaults for that registration.

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

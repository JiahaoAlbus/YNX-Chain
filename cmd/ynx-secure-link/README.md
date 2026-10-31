# YNX secure link

This candidate supplies LINK-01…06 without changing CORE, Auth, SDK, product
packages, shared CI/locks or release authority. S3 transport identity does not
approve an invoice, transfer, tool action, deployment or consensus message.

Build the native command with the exact maintained OpenSSL 3.6.4 headers and
libraries available through `pkg-config openssl`:

```sh
go build -tags securelink_openssl -o /your/owned/output/ynx-secure-link ./cmd/ynx-secure-link
sh cmd/ynx-secure-link/check.sh native
/your/owned/output/ynx-secure-link -config /your/service/edge.json
```

The isolated normal-entry smoke uses only temporary test certificates and a
local fixture backend:

```sh
/usr/bin/python3 cmd/ynx-secure-link/smoke.py /your/owned/output/ynx-secure-link
```

The default or no-cgo build returns an explicit unavailable error; it never
substitutes Go's ordinary TLS. The native adapter also checks its runtime/provider
version. `runtime-macos-arm64.json` records the isolated candidate's exact library
digests. The original release owner must package/pin those same artifacts (or
supply a separately verified target manifest); version equality alone is not
artifact provenance. The default focused tests run in the original `make test`.
The `native` check script is the minimal extra hook for the original CI owner,
not a claim that hosted CI has already run it.

## Direct Go caller contract

Construct `Gate` from operator-approved `Policy`. Each `Edge` binds one local DNS
SAN, one peer DNS SAN, a positive epoch, one or two explicit SHA-256 root
fingerprints with end times, and exact method/escaped-path/risk entries. No
wildcard methods, paths, SANs or CN fallback exist. Dynamic resource IDs require
exact trusted route provisioning by the owning service; caller headers cannot
add a route. Root/service identities and production URLs must come from their
authority, not the examples used by isolated tests.

```go
gate, err := securelink.NewGate(approvedPolicy)
client, err := securelink.NewHTTPClient(securelink.HTTPClientConfig{
    TLS: native.Config{CertFile: serviceCert, KeyFile: serviceKey,
        CAFile: independentlyDistributedRoots, PeerSAN: expectedPeerSAN},
    Gate: gate, EdgeID: approvedEdge, Address: fixedHostPort,
    Origin: "https://" + expectedPeerSAN,
    Timeout: 30 * time.Second, MaxConnections: 16,
})
```

The product owner installs this client in `payproduct.HTTPPayAPI.Client` or
`paygateway.Config.HTTPClient`; AI installs it only at an actual cross-process
tool-executor caller. Current AI model-provider streaming is not that edge.
`Transport` has one identity/destination, a bounded pool, per-request gate checks,
bounded response headers/body/wire metadata, no environment proxy, no redirect,
and no automatic retries. Error after a write preserves the owner's original
operation ID and UNKNOWN reconciliation. Product-specific bearer credentials
and exact action approval remain separate.

For a Go service endpoint use `NewHTTPServer(HTTPServerConfig{TLS: serverTLS,
Gate: gate, EdgeID: edge, Handler: realHandler})`. Its handler obtains identity
only from the live native connection. Wrong actions or injected proxy identity
headers are rejected before the real handler. It preserves HTTP deadlines
across native handshakes. The connection's sealed stable `native.ConnectionID`
survives handle copies, so aliases cannot bind another Agent to the same channel.

## Same-host proxy boundary

The command accepts a bounded JSON object, rejects unknown fields, and has only
two modes. In both modes `tls`, `policy` and `edgeId` are mandatory:

| Mode | Required fields | Path |
| --- | --- | --- |
| `egress` | `listenUnix`, explicit `peerUID`, fixed `address`, `origin`; `tls.Server=false` | Authorized local service → private Unix socket → S3 mTLS |
| `ingress` | `listenTCP`, `backendUnix`, explicit `backendUID`; `tls.Server=true` | S3 mTLS → exact peer/method gate → private edge-dedicated backend socket |

Private socket directories must already exist, belong to the expected OS
principal and have no group/other permission. Sockets are mode 0600. Actual Unix
peer credentials are checked on accept/connect; symlink parents, wrong UID,
non-sockets and existing listener replacement are rejected. Endpoint files are
preserved on shutdown for their owner to reconcile. Services sharing one OS UID
share that OS security principal; production installation must supply the
intended service isolation and remove the old direct TCP backend listener.
This source does not change firewall rules or claim an external plaintext
listener has been removed. Only Darwin/Linux IPC is implemented; other targets
fail closed. The local IPC hop never goes across machines.

## Read sessions and static work

`ConfigureReadFastPath` requires the real Auth `ReadAuthority`. No production
implementation is supplied by LINK. `IssueReadChallenge` creates a single-use
challenge over the actual RFC 9266 exporter, exact service edge, Agent/Grant
versions, realm/tenant/audience and expiry. The original verifier must verify
both source signatures over `json.Marshal(ReadBinding)` and active authority.
`BindReadChannel` caps TTL at five minutes and one binding per actual TLS
connection. `CheckReadFastPath` accepts only an immutable registered read tool,
checks current Auth state and scope on every request and consumes an exact
sequence. Writes/assets cannot use it. Expiry/revocation closes the connection;
new connections cannot reuse handles. A proxy-terminated endpoint cannot prove
the executor's same channel and must use ordinary per-request authentication.

The Auth owner advances its real epoch first, then calls
`Gate.CloseRevokedSessions(principal, newEpoch)`. Service operators use
`RevokeService`, `RevokeCertificate` or monotonic `ReplacePolicy`; active matching
connections and read handles are removed. Already dispatched business remains
subject to the product owner's original reconciliation. This process-local
gate is not a replacement distributed authorization authority.

`ReconstituteWitness` restores bounded bytes and checks exact length, SHA3-512
and SHA-512 before returning them to the original verifier. `StaticCache` keys
all original bytes, both signatures/public keys, signing context and policy
reference. It caches successful static verification only, with bounded LRU,
single-flight and concurrency. The original `StaticVerifier.VerifyBoth` is
required; absent crypto authority fails closed. Dynamic grants/revocation and
business decisions are never cached. Fixture verifiers in tests prove wrapper
behavior, not production dual-signature admission.

Root rotation requires distributing the bounded CA bundle independently and
updating native contexts and edge policies together. `ReplacePolicy` closes old
connections; expired root windows and every chain certificate's earliest expiry
are checked before business. No production roots, private keys, live product
business or public activation are created by this candidate.

OpenSSL API references:
[signature algorithms](https://docs.openssl.org/3.6/man3/SSL_CTX_set1_sigalgs/),
[standard TLS exporter](https://docs.openssl.org/3.6/man3/SSL_export_keying_material/).

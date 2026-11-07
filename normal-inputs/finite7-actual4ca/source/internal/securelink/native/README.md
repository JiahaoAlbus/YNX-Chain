# Native secure-link TLS endpoint

The default build fails closed with `ErrUnavailable`. The production adapter is
enabled with `-tags securelink_openssl` and cgo, using `pkg-config openssl`.
Headers, runtime and the explicitly loaded default provider must be OpenSSL
3.6.4. The private provider context is initialized once, isolated from the
process-global OpenSSL context, and retained for the process lifetime. SSL and
SSL_CTX objects are released normally; provider memory does not grow per socket.

Only TLS 1.3, `SecP384r1MLKEM1024`, `TLS_AES_256_GCM_SHA384` and `mldsa87`
are enabled. Both endpoints must actually sign the handshake. All certificates
in the peer's verified chain, including the root, require ML-DSA-87 public keys
and signatures. A peer must have the exact configured DNS SAN and explicit
role-appropriate EKU. CN fallback, wildcard matching, early data, tickets,
session caching and resumed sessions are unavailable.

Service keys must be regular files owned by the effective process user with no
group/other permissions. One `O_NOFOLLOW` fd is checked and loaded. Encrypted
keys fail without prompting; this adapter has no password input channel. It
does not create or retrieve production CA keys.

`Context.Client/Server` accept pollable OS sockets and return `*Conn`. `Snapshot`
is diagnostic data, not a credential: the policy layer must obtain it from a
live `*Conn`, enforce its expected SAN/fingerprint/root epoch and method, and
recheck revocation per request. `NotAfter` is the earliest expiry across both
relevant certificate chains. Closed handles lose their authenticated snapshot.
Use the comparable, privately constructed `Conn.ID()` as a connection-map key;
outer `*Conn` addresses are aliases, since a value-copy can refer to the same
TLS endpoint. The nonzero ID is unique for the process lifetime and remains
stable across handle copies and closing. An unavailable or empty handle has ID
zero and must be rejected.

The socket uses nonblocking libssl calls and Go's network poller. A fixed C-owned
read buffer allows `net/http` to interrupt/reset idle read deadlines safely.
Writes pin their Go buffer over all WANT retries; a failed/incomplete write
closes the SSL state before unpinning. Callers retain their original operation
ID and reconcile uncertain application effects; a transport error does not
prove that a write had no effect. The sole exporter is the RFC 9266
`EXPORTER-Channel-Binding`, empty context, 32-byte binding.

Focused checks:

```sh
GOMAXPROCS=2 go test -p 1 ./internal/securelink/native
CGO_ENABLED=0 GOMAXPROCS=2 go test -p 1 -tags securelink_openssl ./internal/securelink/native
GOMAXPROCS=2 go test -p 1 -race -tags securelink_openssl ./internal/securelink/native
```

The tagged tests generate temporary isolated certificates and exercise the
actual library handshake. OpenSSL CLI is used only to create those fixtures or
as intentionally noncompliant test peers, never as a production proxy. No test
requires real credentials, real funds, deployment or public activation.

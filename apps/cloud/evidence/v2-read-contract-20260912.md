# Product Session v2 read routes

Candidate implementation, not public or installed acceptance.

Enable before starting the daemon:

```sh
YNX_PRODUCT_SESSION_V2_AUTHORITY=https://wallet-auth.ynxweb4.com \
  ynx-cloudd -addr 127.0.0.1:6496 -data /operator-selected-existing-cloud-data
```

Do not replace an existing state directory or invent its production path.
An empty variable retains the legacy configuration. With v2 configured, requests
from the exact configured Cloud/Docs origin select v2; missing/failed proof never
falls through to bearer authentication. A v2 proof presented while disabled gets
503 PRODUCT_SESSION_V2_DISABLED. Other legacy clients remain on the existing
legacy verifier; no old session is migrated. Legacy session issuance endpoints
are unchanged by this read-only integration.

Supported GET routes, with existing response payloads retained:

- /api/v1/objects?parentId=...&q=...&view=recent&limit=...&cursor=...
- /api/v1/objects/{id}
- /api/v1/objects/{id}/content

Docs requires the ordered scope array ["docs.read","files.read"] for each route.
Cloud requires ["files.read"]. Every request uses a new
X-YNX-Product-Session-Proof-V2; the browser must not introspect it first.
The server selects fixed policies and checks product/resource access, including
the parent folder. A request-local documents.read alias allows reuse of existing
Docs read handlers without creating a legacy token or widening write access.

Authentication failures return JSON {"error":"CODE","code":"CODE"}:
401 for absent/invalid/expired/inactive proof; 403 for origin/product/resource
boundary mismatch; 503 for unavailable or invalid authority response.
Unsupported v2 routes return 403 V2_ROUTE_NOT_ENABLED before consuming a proof.
Existing business handlers retain their prior response/error representation.
No automatic retries, cached authorization, payment approval, write idempotency,
or persistent v2 sessions are introduced.

Local routing tests cover missing/invalid proof through the actual Go adapter,
fixed scopes, per-request invocation, resource denial, disabled writes and
revocation/unavailability propagation. Successful authority responses in these
route tests use an explicit test double; this is not real Wallet approval evidence.
Full Docs feature merge, callback UI, real signed product reads, state upgrade
rehearsal and public deployment remain separate unfinished work.

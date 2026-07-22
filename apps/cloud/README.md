# YNX Cloud

YNX Cloud is a standalone Web product over `internal/cloud`. It stores bounded file
objects off-chain, uses content-addressed SHA-256 blobs, and exposes only explicit
YNX identity permissions. It does not claim unlimited storage or production
durability.

Run the local product:

```bash
go run ./apps/cloud/cmd/ynx-cloudd -addr 127.0.0.1:8092 -data tmp/cloud
```

Open `http://127.0.0.1:8092/cloud/`. A configured YNX Wallet verifier is required
for normal sessions. `-dev-wallet` is a loopback-only smoke adapter and is never a
deployment authentication mode.

Checks:

```bash
npm --prefix apps/cloud test
npm --prefix apps/cloud run check
npm --prefix apps/cloud run security
bash apps/cloud/scripts/smoke.sh
```

The security gate verifies production-surface forbidden markers and common secret
formats, exact package-script allowlists, Go vet, Go/pnpm lock coverage in the
CycloneDX SBOM, provenance material hashes, and the recovered APK's exact hash,
size, release-class claims, and archive contents. See `THREAT_MODEL.md` and
`SECURITY_BOUNDARIES.md` for authority and residual-risk boundaries.

Reusable Web, Node, and React Native API access is provided by the dependency-free
ESM package in `sdk/`. It accepts a callback for the current short-lived Wallet
product session, exposes typed Cloud/Docs operations, reports request/error IDs,
and retries only idempotent requests on explicit rate-limit or backpressure
responses. It does not create or persist Wallet credentials.

Client-side encryption is an API boundary: ciphertext may be stored with
`AES-256-GCM` metadata, while the user-held recovery package and key never enter
the service. The default scanner is a bounded policy interface and EICAR guard,
not a production antivirus claim.

Bounded resumable multipart API:

- `POST /api/v1/multipart` initiates an upload with exact final size and SHA-256.
- `PUT /api/v1/multipart/{upload}/parts/{part}` accepts a part with `X-Content-SHA256`.
- `GET /api/v1/multipart/{upload}` resumes from durable part metadata.
- `POST /api/v1/multipart/{upload}/complete` verifies ordered parts and final hash.
- `DELETE /api/v1/multipart/{upload}` cancels the upload.

The current assembly limit is 64 MiB with 8 MiB parts. It is an honest local
control-plane implementation, not provider-native streaming multipart. Objects
may carry typed Dataset, Strategy/Model, Build, Backtest/Experiment, Checkpoint,
Media Source, Document Export, or Audit Archive metadata. Content endpoints use
standard HTTP byte ranges.

`GET /api/v1/export` creates an owner-only ZIP containing every owned immutable
version plus a versioned manifest of object metadata, ACLs, audit events, hashes,
byte sizes, source, authority, and `asOf`. Export fails closed if any source byte
does not match its recorded hash or size. Artifacts under `legal-hold` cannot be
permanently deleted. Logical deletion still relies on operator-controlled,
content-addressed blob retention/garbage collection and is not described as
verified physical erasure.

`GET /api/v1/deletions` lists redacted deletion outcomes for the current owner;
`POST /api/v1/deletions/{deletion}/retry` retries a pending provider deletion.
Content-addressed reference counting prevents deletion while another object
version still uses the same hash. A provider failure returns `202 Accepted` with
`physicalDeletion: pending` after logical deletion, never a false erasure claim.

`GET /api/v1/usage` returns a versioned, product-isolated report of exact current
deduplicated storage plus persisted accepted-ingress, delivered-egress, scan-byte,
and AI-estimate counters. The local adapter has no approved pricing source, so the
report explicitly sets costs, fees, treasury, burn, user charge, and refunds to
zero under `not-configured-no-charge`; it is usage evidence, not an invoice.

Artifact retention is enforced at deletion time. Legal holds do not auto-expire;
ephemeral artifacts require a future expiry; and standard or ephemeral retention
windows block permanent deletion until their exact UTC timestamp. Expiry only
makes deletion eligible and never causes silent erasure.

For planned service cessation, `ynx-cloudd -user-exit-mode` rejects new writes
while retaining canonical sign-in, read/download, audit, usage, export, revoke,
cancel, trash, delete, and provider-deletion retry paths. Health exposes the mode
and blocked mutations return HTTP 423 with `X-YNX-Service-Mode: user-exit`.

Remote providers may implement short-lived presigned direct uploads through
`POST /api/v1/direct-uploads`, owner-visible status, completion, and cancellation.
Cloud registers no object until the provider verifies exact hash, byte size, and
accepted scan status. Signed URLs and internal provider refs are redacted from
client-visible records. The Web UI uses this path for 8–64 MiB files; the 5 GiB
API ceiling is a contract maximum and not a local-browser capacity claim.

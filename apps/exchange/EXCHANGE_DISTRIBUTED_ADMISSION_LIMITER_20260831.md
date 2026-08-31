# Exchange distributed admission limiter — source checkpoint

Date: 2026-08-31

Scope: `apps/exchange/**` only, under Central source lock
`P0-EXCHANGE-DISTRIBUTED-ADMISSION-LIMITER-20260831`.

## Change

The Exchange server command now requires `YNX_EXCHANGE_DATABASE_URL` and
initializes a product-owned PostgreSQL table:

```text
ynx_exchange_admission_windows(client_hash, window_start, requests, updated_at)
```

Each request hashes the normalized client identifier with the scoped
`ynx-exchange-admission-v1` domain separator. A single PostgreSQL `INSERT …
ON CONFLICT … DO UPDATE … WHERE requests < limit RETURNING` statement consumes
the fixed one-minute window atomically. Therefore separate Exchange processes
using the same database share the 600-requests-per-minute limit. Database
timeouts or errors return HTTP 503 and do not allow a request.

The previous in-memory limiter remains only as an isolated unit-test fixture;
the production server entry point cannot select it.

## Evidence completed locally

```text
go test ./apps/exchange/server ./internal/exchangeproduct
go test -race ./apps/exchange/server ./internal/exchangeproduct
go vet ./apps/exchange/server ./internal/exchangeproduct
git diff --check
```

The PostgreSQL multi-instance test is intentionally gated on
`YNX_EXCHANGE_POSTGRES_TEST_URL`; it opens two admissions against one
operator-provided test database and proves a third request is rejected across
instances. It was not run here because no test DSN was supplied.

## Frozen Linux candidate

The locally verified (not deployed) package is
`/tmp/ynx-exchange-ba69ba9-linux-amd64-candidate-final.tar.gz`:

```text
source commit: ba69ba9ca9e8b7a507f0b772c219919179dd4503
archive bytes: 3715483
archive SHA-256: 2c08844116fd7d0be9f753df39bf5dca8278e3035833a33e939c8a53b385d000
binary bytes: 8290488
binary SHA-256: fba489012e09054166ceb694a7bc3034d8717853a2972bc77d773606244d330b
payload SHA256SUMS bytes: 512
payload SHA256SUMS SHA-256: eeac2804c62a7d2517a118ed7fc524e8caa116d2898bdadb4ca4d33b35a874d4
payload: Linux amd64 binary plus five served Web assets
```

The manifest excludes itself and was checked after extracting the archive.
It is an offline artifact, not a public URL, signed release, or installed
application.

## Public runtime read-only check

At 2026-08-31T13:58Z, the public Exchange domain did **not** expose an
Exchange service runtime:

```text
https://exchange.ynxweb4.com/          body: 18603 B, SHA-256 64c5b7862099eb06a316fbc6d1c665e81355f427fa27b26584bbf586ac4eacde
https://exchange.ynxweb4.com/health    HTTP 200, text/html, 18603 B, same SHA-256
https://exchange.ynxweb4.com/version   HTTP 200, text/html, 18603 B, same SHA-256
```

`/health` and `/version` are therefore static-HTML fallbacks rather than the
candidate's JSON endpoints. One header/body request hit a transient TLS timeout
while independent successful body reads still produced the identity above.
This is public mismatch evidence only; it is not a public release,
wallet-connection proof, or trading proof.

## Truthful remaining gates

This is source and local-test evidence only. It does not prove a public
Exchange deployment, PostgreSQL injection on a public runtime, wallet account
approval, signing, order placement, matching, settlement, installed behavior,
or a Testnet trade. Those require separately frozen artifact, rollback, and
deployment/visible-evidence authorization.

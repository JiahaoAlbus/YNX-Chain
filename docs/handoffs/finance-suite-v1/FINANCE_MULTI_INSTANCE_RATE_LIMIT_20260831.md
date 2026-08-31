# Finance multi-instance rate-limit checkpoint — source-only

Date: 2026-08-31

## What changed

Finance already had PostgreSQL CAS persistence for user state but applied request
limits in process memory.  This checkpoint adds an atomic PostgreSQL token
bucket (`ynx_finance_rate_limits`) and moves the HTTP protection layer through
the Store boundary.

- PostgreSQL-backed runtime reports `postgres-token-bucket-multi-instance` and
  applies limits atomically across instances.
- The default production command now requires `YNX_FINANCE_DATABASE_URL`.
  `YNX_FINANCE_REQUIRE_MULTI_INSTANCE=false` is an explicit local/development
  override, not a production readiness claim.
- Rate keys are `method:sha256(session-token)`; the raw Product Session token
  is not retained in a rate map or database key.
- `/health` and `/ready` distinguish state storage from rate-limit storage and
  report `multiInstanceState` only when both are distributed.

## Exact source

- Commit: `ac486ed27c9a47950d97b8d6a39a1072e3004045`
- Tree: `615fb6139b937755b403f7bdb0c92165b54ed7b3`
- Server entrypoint: blob `463fcf6517a800ba494f4bb2cd59560233d36f11`,
  4,054 bytes, SHA-256 `a475a6ab36f166a3a44ddbe8334ba71ea7d77d08b92813fc18880f381bce9a0f`
- HTTP server: blob `4cb1779091a049b2e01706885f565d202b968962`,
  32,163 bytes, SHA-256 `8211131b6188e0cbf7a00001fb49ba2b9607109f63682a7e19fc21cd338ca288`
- Repository/migration: blob `9dc2feea8a67bb4622c3f220b954d7277e913c56`,
  8,351 bytes, SHA-256 `24c5de36cdc234d3957d5a1bec9a1f9c057245a6d06092a9d695cd87c780bb83`
- Store boundary: blob `77e519998e49995a2aa138292dcef977551c93bc`,
  20,547 bytes, SHA-256 `a163f70708e4e447165f139584970fe43f1c7ea3cf7ba7dedac053f285da39a9`
- Regression tests: `ec2846397c5bb02f2c49ba08d941f2016a0d289b` and
  `afeccabc436993f0ab1d5eca4acc6fd6ab09f37f`.

## Verification

```text
go test ./internal/finance ./apps/finance/...
go test -race ./internal/finance
go vet ./internal/finance ./apps/finance/...
git diff --check
```

All commands passed.  PostgreSQL integration assertions run when the explicit
`YNX_FINANCE_TEST_DATABASE_URL` is available; they are skipped otherwise.

## Deployment boundary

No database was provisioned and no runtime was changed.  Before a Finance
deployment lease, Central must bind a production PostgreSQL endpoint through a
secret-safe host configuration, run the migration, and verify `/health` and
`/ready` report both `stateStore=postgres-cas-multi-instance` and
`rateLimitStore=postgres-token-bucket-multi-instance`.  Until then the public
runtime remains the previously observed single-host file-CAS deployment and is
not multi-instance-ready.

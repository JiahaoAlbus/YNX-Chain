# Quant real PostgreSQL recovery validation

Parent source f49076e113d52812af43cb68825bf011303d91cf. Ordinary Quant business/tests only. No production database, Host, release pins, shared SDK/authority or account/signature/transaction operations.

## Isolated environment

No installed PostgreSQL was available. Built official PostgreSQL17.11 source in /tmp/ynx-finance-postgres-qa.J359YD, without installing global software or services. Source archive https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2 SHA256 dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979 matches the inspected package metadata.

Configure prefix /tmp/ynx-finance-postgres-qa.J359YD/runtime, --without-icu --without-readline --without-zlib. make -j4 and make -s install succeeded. postgres binary SHA256 98f655b16c6dd92a7f1891a4ae82822e3d3a1a12943031ff1fbbe8239626fe96. Server readback: PostgreSQL17.11,aarch64-apple-darwin27.2.0,Apple clang21.0.0,64-bit.

New disposable cluster data path /tmp/ynx-finance-postgres-qa.J359YD/data, role ynx_qa, database ynx_quant_qa, loopback127.0.0.1:64623, Unix socket confined to that temporary root. Trust authentication and no TLS only for this non-production local test cluster; no credentials or existing user data imported. It is not a production database configuration.

## Findings and changes

Initial real database run FAILED two old expectations: readiness and tenant diagnostics expected an absent root row to be ready. Existing missing-state guards intentionally require a persisted readable root state. Tests now first prove503 on an empty namespace, explicitly seed controlled root risk state, then prove200, closed pool503 and reopened pool200. Tenant writes cannot substitute for the diagnostic root state. No readiness guard was weakened.

Added actual PostgreSQL deletion/recovery test: two service instances observe a saved research row; test captures exact SQL revision/payload and removes that isolated row; both readiness probes and Kill writes fail unavailable, SQL count remains zero and cached state hash unchanged; exact row restoration recovers both instances to the original state. This is a controlled test deletion, not an authorized production recovery operation or durable tombstone implementation.

## Executed results

- YNX_QUANT_POSTGRES_TEST_URL=postgres://ynx_qa@127.0.0.1:64623/ynx_quant_qa?sslmode=disable go test -race ./internal/quantlab -count=1: PASS4.724s.
- Same isolated URL, go test -race ./internal/quantlab -run PostgreSQL -count=10: PASS4.574s.
- Final -race -json full suite parsed: rc0,124 top-level PASS,1 SKIP,0 FAIL.11 top-level TestPostgreSQL* names passed (including configuration validation); all database opt-in gates were enabled. Remaining skip: private-session-local-QA test requires an isolated QA Gateway, which was not supplied.
- YNX_QUANT_DATABASE_URL set to the isolated URL and YNX_QUANT_STATE_NAMESPACE=quant-browser-pg-20261004, node --test apps/quant-lab/tests/research-recovery-browser.test.mjs: actual Go process+two browser profiles,1/1 PASS7022.813292ms,three clean SIGTERM stops, saved research lost-return recovery, Paper/Kill persistence and tenant isolation. Controlled market tape; not public or real-capital execution.
- Direct SQL after browser run:2 persisted browser rows,2 tenant rows under that namespace. Retained browser evidence /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-JuCeSX. Go test binary11467138B SHA25638b3cfd3d99fb4a18e541ff5ae8faa337db88c6ed9d25bcb295a44a9a4a3517b.
- gofmt and git diff --check PASS. Initial malformed apply_patch operation was rejected before any edit; corrected patch then applied normally.
- pg_ctl -D /tmp/ynx-finance-postgres-qa.J359YD/data -w -m fast stop succeeded. Cluster/toolchain retained for repeatable isolated tests; no background database left running.

## Remaining release gates

Real local PostgreSQL validation is no longer blocked by a missing local database. Public Quant remains separately unaccepted: latest direct version664b80b0 and /api/ready503 filesystem backend are documented in daily-risk-visible-integrity-20261004.md. A release owner must supply production-safe deployment/storage and source integration. No concurrent independent Quant OS-process SQL execution is claimed from in-process CAS tests; the browser suite verifies actual process restart against real SQL. publicCurrentSource=false; installedVerified=false; realWalletApproval=false; realOrders=false; migratedV2=false. QA Gateway/private session and production/public lifecycle remain unverified.

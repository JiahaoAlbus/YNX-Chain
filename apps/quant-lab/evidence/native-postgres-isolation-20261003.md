# Quant isolated native PostgreSQL verification

Classification: local storage integration evidence, NOT public release, Wallet
approval, real market execution, production capacity or native installer proof.
Owner predecessor: b87f44e00c3ddd304265b93aabe099b9a4e24cc3.

Docker daemon and a QA database URL were unavailable. Built official PostgreSQL
17.11 source in `/tmp/ynx-quant-postgres-qa.7c340A`, without a system service or
production database connection. Official archive SHA256:
`dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979`.
Native arm64 executable SHA256:
`038ff8ec454ef37da4c7d88b7b461cb8de8203146ff1ea6f11d3a9632a84551e`.
Source: https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2

Run:
```
node apps/quant-lab/scripts/test-postgres-isolated.mjs --postgres-bin-dir /tmp/ynx-quant-postgres-qa.7c340A/runtime/bin
```
Runner creates its own empty loopback cluster, overrides any caller test URL,
requires all four database gates to PASS twice (no SKIP), verifies fixture rows
are zero, and identity-checks the cluster before stopping it. Local fixture
trust authentication is NOT a production authentication claim. Stopped cluster
and logs are retained rather than recursively deleted.

## Failures retained and corrected

- Initial runner draft omitted pg_ctl's `start` operation; no server started.
  Receipt retained at `/private/tmp/ynx-quant-postgres-it-q4r7Ge/receipt.json`.
- First real database run failed the HTTP risk-state test twice. Its snapshot
  request omitted the required local-paper preview header, so the service
  correctly returned the public empty snapshot. Do not weaken that guard.
- The same test deferred database close before its cleanup callback, silently
  ignoring cleanup errors. Cleanup now runs before close and reports errors.
- Failure receipt `/private/tmp/ynx-quant-postgres-it-n3DIYu/receipt.json` SHA256
  `5e5922348509468c246d954d1b841f585bd8507dad3cfabb154eccbd547775fc`;
  integration log SHA256
  `ee8ca88a341c27d50dbd88ce2ef109883905d5dde382c060511bb7f4269be87a`.
  Failed cluster was stopped successfully.

## Passing real database run

Receipt `/private/tmp/ynx-quant-postgres-it-9LyxSA/receipt.json` SHA256
`e3e805c8169530098ba27bca0c1712fbbc0e93cc195304a3782f8c8678846f4e`.
Database identity: `quant_isolated_qa|127.0.0.1|17.11`.
Integration log SHA256
`90d01b8c7869f07570cf4b01786e6163a2b5537913a2626068b043bf7483228a`.

Actual `go test -race ... -count=2` passed each:

- TestPostgreSQLStateStoreMultiInstanceCASRestartAndTenantIsolation
- TestPostgreSQLTenantServerKeepsRiskStateIsolatedAcrossHTTPUsers
- TestPostgreSQLResearchReplayConcurrentInstancesRestartAndTenantIsolation
- TestFinanceReadPostgresTenantAndCrossInstanceReplay

Eight required passes, no skipped database gates; state and nonce row counts
`0|0`; serverStopped=true. Controlled fixtures prove actual PostgreSQL storage
behavior, not canonical production identity or public market/order acceptance.
No shared SDK, formal graph, public runtime or production database was changed.

Full retained non-DB regression: `go test -race ./internal/quantlab
./internal/readintegration` PASS (2.719s / 1.294s). `go vet` for both packages,
Node syntax and `git diff --check` PASS. These do not waive the previously
reported formal asset-graph publication gate owned by the release integrator.

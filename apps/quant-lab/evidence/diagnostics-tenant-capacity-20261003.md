# Quant operational diagnostics do not allocate workspaces

Source predecessor `38fd3552778bb7be3ef9988274da8f4dae891b06`.
Ordinary `internal/quantlab` routing/tests only. No shared authority or Host
change, new permission, database schema, service restart or public deployment.

## Actual defect and change

The TenantServer previously routed service diagnostic GETs to its base only if
no tenant header was present. A normal client attaching its workspace header,
or an arbitrary diagnostic caller, could instantiate a new cached Service for
every distinct valid ID. This consumed the finite 1024-workspace capacity and
made service diagnostics fail with tenant-capacity errors. Health could also
select a workspace's risk signals instead of the service baseline.

GET `/health`, `/ready`, `/version`, `/metrics` now always use the base service,
regardless of a tenant header. These are service-level diagnostic interfaces,
not workspace authorization or private risk readback. Normal workspace
snapshot/risk/research routes, existing permissions and the capacity limit are
unchanged. Readiness still enforces durable PostgreSQL and actual state reads.

## Executed evidence

- Controlled filesystem HTTP fixture sends all four diagnostic routes with two
  valid IDs and one invalid ID while maximum workspace capacity is one.
- Correct diagnostics status (including filesystem readiness 503), zero tenant
  instances and zero durable tenant files are required.
- A legitimate existing local-Paper kill operation then occupies the sole slot;
  health with that ID still reads base signals, not its activated kill switch.
- Existing actual PostgreSQL two-user risk isolation fixture fills its cache
  capacity, sends all four diagnostics with a third unknown ID, requires 200
  for each, and verifies the number of workspace instances does not increase.
- `go test -race ./internal/quantlab`: PASS (2.867 s); optional unconfigured SQL
  skips in that invocation are not counted as actual database evidence.
- `go vet`, `gofmt`, diff checks: PASS.
- Actual PostgreSQL 17.11 isolated runner: 16 required integration passes;
  actual database stop/start verified; 111 full regression passes after restart.
- QA root `/private/tmp/ynx-quant-postgres-it-nKxiDU`.
- Integration log SHA256
  `2cb0b8993042c00ed66adb5d267291ba958225c3bb22a611a8a8bf850f79c6ae`.
- Full regression log SHA256
  `59500b458f438c6039591eab0a7a2c0bd783a0e8aa4e1863978f2b70bf1157db`.
- Owned cluster stopped, remaining state/event rows `0|0`; production DB unused.

## Compatible publication

Admit this ordinary TenantServer diagnostic delta and tests in addition to the
exact prior inputs in `integration/ordinary-publication-inputs-20261003.json`.
That manifest intentionally remains an immutable prior source snapshot, not a
claim to include this successor. Merge into the current compatible formal
authority graph; do not replace the whole owner checkout or alter SDK/grants.
Do not use these local/controlled tests as public user acceptance. Public old
filesystem/source mismatch remains; provider/private-session/orders/installed
and aggregate completion remain unproved. No account/sign/transaction occurred.

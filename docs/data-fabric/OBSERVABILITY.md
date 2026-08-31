# Data Fabric Observability

The API exposes health, version and metrics; tests cover evidence-backed health
and degraded broker status without secret leakage. Structured provenance uses
request, error, trace and audit identifiers. Prometheus rules and a Grafana
dashboard live in `infra/data-fabric/`.

Operators must alert on persistence/integrity failures, retry/DLQ growth,
queue saturation, consumer lag, migration mismatch, broker/database health,
backup/restore failures and unauthorized replay attempts. Dynamic labels must
not expose account, session, secret, path, certificate or raw payload data.

The configuration and local tests are not proof of a deployed monitoring,
alert routing, on-call service or public status page.

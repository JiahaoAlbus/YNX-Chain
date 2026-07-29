# Decision Log

Updated: 2026-07-29T02:39:00Z

## 2026-07-29 — Metrics cardinality is bounded

Shop metrics use fixed route groups, HTTP status classes, bounded order states and four provider names. Raw paths and user/object identifiers are excluded. This prevents buyer tracking and unbounded Prometheus cardinality.

## 2026-07-29 — Provider configuration is not provider health

`ynx_shop_provider_available` and `/health.dependencies` report whether required Shop configuration is present. They do not claim remote provider health, successful transactions, central acceptance or public availability.

## 2026-07-29 — Local capacity is not public capacity

The 3,000-request Apple M2 `httptest` result is retained as a reproducible regression baseline only. Public SLO/capacity requires exact packaged source, ingress, filesystem persistence, integrity HMAC, dependencies, monitoring, sustained load and multi-probe evidence.

## 2026-07-29 — Generic SPA HTTP 200 is not a Shop deployment

`https://ynxweb4.com/shop` returned the generic website shell and homepage canonical. Product deployment requires Shop-specific content, canonical and release evidence. HTTP status alone is insufficient.

## 2026-07-29 — Historical Staging is not current evidence

The historical Shop Staging/API routes returned HTTP 404. Prior source/artifact manifests remain historical evidence but cannot set current availability or deployment fields to true.

## 2026-07-29 — Persistence downgrade is explicitly lossy

Rollback from schema v2 to v1 first writes an exact v2 recovery point. Buyer profiles, carts and request-rate windows are omitted from v1 and counted in the rollback report. The downgrade is never described as lossless.

## 2026-07-29 — Next owned slice is deterministic artifact packaging

Migration, observability and local capacity are complete locally. The highest-value autonomous next action is an exact current-source Web/API release bundle with deterministic output, hashes, SBOM, provenance, tamper rejection and no deployment overclaim.

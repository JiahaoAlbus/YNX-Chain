# YNX Cloud feature completion evidence

Evidence baseline: source commit `d11c382da10ab0629c7d322c83c9ddef24925328`. GitHub Actions run `30275578270` verifies the exact commit's security/recovery workflow and least-privilege image cold-start; staging, public deployment, hosted artifacts and production signing remain separately unproven.

| Capability | Implemented | Tested | Direct evidence | Remaining proof |
| --- | --- | --- | --- | --- |
| Files, folders, search, metadata, trash | yes | local | `internal/cloud/service_test.go`, canonical smoke | staging/public |
| Download, Range, preview, checksum | yes | local | content tests, HTTP `ServeContent`, canonical smoke | CDN benchmark |
| Versions and restore | yes | local | service tests and canonical smoke | remote migration drill |
| ACL, expiring links, revoke | yes | local | service/server tests and failure vectors | central Wallet staging |
| Quota, usage, and audit | partial | local | schema-v5 product-scoped persistent ingress/egress/scan/AI counters and exact storage byte-seconds, exact current storage, zero-charge report, migration/service/server tests | attributable backup/replication, provider invoice, approved pricing and reviewed byte-hour rounding |
| Offline queue and conflict UI | yes | local | Web/native tests; Docs 409 smoke | multi-device staging |
| Backup/restore | yes | local | `scripts/smoke.sh`, `internal/cloud/recovery.go` | cross-region drill |
| Quant/product artifact metadata | yes | local | typed object metadata and multipart lifecycle test | staging consumer proof |
| JavaScript/TypeScript SDK | yes | local | dependency-free ESM/types package and `tests/sdk.test.mjs` | publish immutable package and run staging consumer proof |
| Multipart/resume/cancel | yes, bounded | local | durable upload/part state, restart resume and integrity tests | provider-native streaming; pause is client-side stop/resume |
| Presigned direct upload | yes, adapter contract | local | fail-closed remote adapter, restart/verify tests, Web 8–64 MiB route | provisioned S3-compatible provider and remote proof |
| Production object storage | no | no | local/remote adapter contracts only | provisioned provider, KMS, SLA |
| Content-addressed deduplication | yes, owner+product scoped | local | commit `7759586`; `dedup_scope_test.go`; Race suite; ordinary, multipart, document-version, direct-upload scope and final-reference deletion paths | provider acceptance of opaque scope, remote migration drill and provider-side isolation evidence |
| Versioned hot/cold/archive lifecycle | partial, provider-neutral | local + exact-SHA CI | commit `d11c382`; `lifecycle*.go`; `evidence/LIFECYCLE_d11c382.json`; schema-v7 migration; Account/Product and provider-result binding; retry; dedup copy-on-write; archive restore-required reads; pending/failed delete and erasure barriers | provisioned provider idempotency, CDN/cache behavior, replication or erasure coding and cross-region restore proof |
| Millions-of-objects candidate | partial | local | 1m-object/100-sample p50/p95/p99 evidence at exact commit | concurrent, persisted, sharded and remote benchmark |
| AI selected-file boundary | yes | local | product-bound job and selected-object service/client tests | configured gateway staging |
| Export/delete | yes, control-plane | local | product-scoped verified portable ZIP; schema-v6 dedicated-scope product-account erasure with retention-atomic preflight, session/job/upload/collaboration cleanup, hashed receipts, provider pending/retry truth, 12-locale Web/native export-first UI, API/SDK/client/smoke tests | provisioned-provider media-sanitization and backup/replica erasure proof |
| Retention/legal hold | yes, control-plane | local | future-expiry validation, active-window denial, post-expiry deletion, indefinite legal-hold tests | provider-native object-lock proof |
| Service cessation user exit | yes, control-plane | local | HTTP exit-mode test proves sign-in/read/export/trash/delete remain while new writes return 423 | announced remote exit drill and support/status evidence |
| Logs, IDs, health, readiness, metrics, traces | partial | local | integrity-checked persistent RED bins, normalized routes, correlated bounded traces, fail-closed readiness, evaluated alerts, machine-readable dashboard and tests | provider child spans, distributed export/aggregation, hosted dashboard/paging/status integration |
| Security and supply chain | partial | local + exact-SHA CI | threat model, security boundaries, deterministic 468-component CycloneDX inventory, script allowlist, Go vet/secret/lock/artifact gate, local APK provenance record, and GitHub Actions run `30275578270` | external SAST/DAST/penetration report, image vulnerability scan, fresh reproducible published artifact, production attestation/signing |
| Rate limit and backpressure | yes, single-process | local | deterministic forwarded-IP, reset, saturation, retry and metric tests | distributed limiter and measured tuning |
| State migration and rollback | partial | local | legacy v1-v6 fixtures, byte-identical backups, product, usage, storage-time, erasure-receipt and schema-v7 lifecycle migrations, metadata-only compatibility, current→legacy rollback hash and tamper tests | previous-binary and remote drill evidence |
| Docker/Server delivery | yes, candidate | local contract + exact-SHA CI | non-root multi-stage image, bounded per-Dockerfile context, read-only least-privilege Compose profile, 3 container contract tests, and GitHub Actions run `30275578270` image build/cold-start for `d11c382` | image vulnerability scan; hosted immutable image; production provenance/signing |
| Public `/cloud` Testnet | no | no | none | domain, deployment, remote smoke |

No row marked “local” proves staging, public deployment, production durability, production signing, or store release.

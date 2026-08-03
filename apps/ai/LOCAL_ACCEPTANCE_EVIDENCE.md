# YNX AI local acceptance evidence

Source commit: `1cfc0c5085032a3a83745a8e65879d87aa223c63`

`TestLocalHealthCapacityEvidence` runs 1,000 HTTP requests with concurrency 25. On 2026-07-29 it recorded 0 failures, 17,745.2 requests/second, p50 0.799 ms, p95 4.916 ms, and p99 9.368 ms. This isolated local health-path measurement excludes provider latency, shared-Testnet networking, public availability, and production scale.

Supply-chain gates passed: AI race tests, `go vet`, zero reachable `govulncheck` findings after gRPC 1.82.1, zero mobile dependency audit findings after patched `brace-expansion` and `uuid` overrides, CycloneDX SBOM, dependency/license review, release-content checks, secret checks, and artifact-manifest validation. No container is published, so no container-scan completion is claimed.

Web and native surfaces provide semantic names/roles, keyboard focus, live errors, dynamic type, reduced motion, forced colors, light/dark behavior, Arabic RTL, locale formatting, and responsive 390 × 844 layout. Mobile checks verify all 12 locale catalogs and deterministic RTL. This is local evidence, not external certification.

Persistent state is schema v1; no earlier public AI state schema exists. The loader rejects unknown versions rather than coercing them. A future v2 must ship explicit forward and rollback migration. Tests prove encrypted persistence, restart recovery, tamper rejection, retention, export, conversation/account deletion, and audit continuity. Staging backup, RTO/RPO, Monitor alerts, exact provider usage/cost, Data Fabric receipts, and tokenomics splits remain external.

# YNX Social local operations evidence

Evidence date: 2026-07-29. Source candidate: `6ff91db0b7ce7509d1967e3936c7a0a85d45ea12`.

- Social, Chat, Square and App Gateway Go suites pass; Social, Chat and Square Race suites pass.
- Chat and Square signed API smoke gates pass with restart, replay/conflict, rate-bound, integrity and truthful-health checks.
- The Social native client passes TypeScript, 13 tests and Android/iOS Hermes exports with 12 complete locale catalogs.
- A repeatable local loopback health gate completed 1,200 requests at concurrency 30 with 0 failures, 31,785.5 req/s, p50 0.804 ms, p95 1.832 ms and p99 3.307 ms.
- `govulncheck v1.6.0` using Go 1.25.12 reports 0 called vulnerabilities after upgrading gRPC to 1.82.1. Go module verification and the repository secret scan pass. The npm high/critical gate passes; 10 moderate Expo/Xcode build-tool findings remain because the suggested automatic remediation is a breaking Expo downgrade.

The loopback gate measures one developer machine and the unauthenticated health path. It is not a staging workload, long soak, message fan-out limit, multi-region result or production SLO. Production-volume backup/restore timing, Monitor dashboards/alerts, independent security review, signed provenance and immutable hosted artifacts remain external gates.

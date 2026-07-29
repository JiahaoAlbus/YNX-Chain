# Next Action

Updated: 2026-07-29T02:39:00Z

Build a deterministic current-source YNX Shop Web/API release bundle from `a9f9ff932ede1091882509a219755b4b18a88c92` and bind it to exact SHA-256, source manifest, SBOM and provenance records.

Execution requirements:

1. Re-run current Shop Web tests/build/smoke/native static verification and Commerce race tests.
2. Build `ynx-shopd` with exact `BuildVersion` and `BuildCommit` values.
3. Package the Shop buyer assets, Seller Console assets, service binary, migration/rollback documentation, operations documentation and release metadata without state files or secrets.
4. Generate deterministic archive output and verify two builds are byte-identical.
5. Generate SHA-256, SBOM and source provenance tied to the exact commit.
6. Add tamper and false-claim rejection checks.
7. Commit and push the artifact tooling/evidence.
8. Prepare, but do not claim, a Staging deployment until direct health/version/metrics, restart/restore and route evidence exists.

Do not use the historical `38e2f68` artifact as current-source evidence. Do not restore the removed historical Staging claim merely because an old manifest exists.

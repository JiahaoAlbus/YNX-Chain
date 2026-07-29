# Product 30 Decision Log

Updated: 2026-07-29T14:50:00Z

1. `JiahaoAlbus/YNX-Chain` is authoritative; `JiahaoAlbus/YNX` is legacy and receives no further Product 30 writes.
2. Preserve the legacy branch and complete bundle before migration; do not rewrite unrelated repository history.
3. Migrate Product 30-owned files only. Central release, integration, documentation, and owner files remain owned by their designated products.
4. Freeze release truth at source `900c314...`; later evidence commits may validate that source without pretending they rebuild it.
5. A local Ed25519 test signature is never production signing and never makes the artifact public-release eligible.
6. `installedLocal=true` is permitted only after exact-source fresh-clone install and cold-start evidence passed.
7. Enable vulnerability alerts because the official dependency-review gate failed closed without the dependency graph.
8. Pin every external GitHub Action to an immutable 40-character commit, including workflows not originally owned by Product 30, because repository-wide supply-chain integrity is a Product 30 gate.
9. Classify the old untracked `output/` as legacy failed public-gate captures, preserve it intact in the recovery area with a deterministic digest, and never present it as release proof.
10. Keep the PR draft until central integration and shared-Testnet/public-release acceptance are evidenced.
11. Enable administrator enforcement now that recovery writes are protected and the candidate has passed exact-head CI; preserve the complete REST readback as final-lock evidence.
12. Keep required signed commits separate from administrator enforcement. Do not enable signing policy until an approved production signing identity and compatibility plan exist.
13. Classify `FINAL-001` as `externalBlocked` only for true production authorities and public infrastructure. Product 30 local/source/CI/handoff work is complete; Product 29 central acceptance remains tracked by Product 29 rather than misclassified as an external blocker.
14. Publish the source Candidate Release from frozen source `900c314…`, not from a later documentation/evidence checkpoint, so the tag, archive, SBOM, provenance and manifest bind the same source commit.
15. Set candidate `downloadHosted=true` only after GitHub returned all five uploaded asset digests and sizes. Keep immutable production hosting, production signing, staging, public runtime, store and Mainnet states separate and false.

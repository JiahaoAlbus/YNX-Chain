# Decisions

## 2026-07-27

1. The authoritative product is `19｜YNX Oracle & Market Data`, selected only by exact Worktree and Branch match.
2. The public endpoint is classified as a real limited-source Testnet control plane, not an authoritative price release: `activeProviderCount=0`, `requiredProviderCount=3`, `authoritativePrices=false`, `released=false`.
3. Consumer validation must be portable and contract-first. The Go and TypeScript SDKs use the same canonical acceptance vectors.
4. The consumer CLI must fail closed and must not print a value that fails market/type/version/freshness/confidence/coverage validation.
5. Dedicated Android, iOS, macOS and Windows Oracle apps are not applicable to this infrastructure product; Web/PWA, server/container, SDK and CLI are the appropriate delivery forms.
6. Deterministic artifact packaging and provenance are now `testedLocal` at source commit `6ba6c39a6661724e07205a265201ac7fa36c91bb`; the next autonomous priority is direct Web accessibility evidence, followed by Linux arm64 native cold-start evidence when an execution host is available.
7. Build manifests remain build-time truth and therefore keep `coldStartTested=false`; post-build install/cold-start results are recorded separately in `release/evidence/oracle-artifact-verification-6ba6c39a6661.json`.
8. Artifact evidence export is restricted to `release/evidence`, commit-addressed, and excludes large binary archives from Git. Publication still requires immutable hosting and production signing.
9. Missing `rg` must never produce a green security or placeholder gate; tracked-source scans use explicit `git grep` exit-status handling.
10. No state may be promoted from local/tested to integrated, hosted, signed or released without direct evidence.

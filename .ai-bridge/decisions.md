# Decisions

## 2026-07-27

1. The authoritative product is `19｜YNX Oracle & Market Data`, selected only by exact Worktree and Branch match.
2. The public endpoint is classified as a real limited-source Testnet control plane, not an authoritative price release: `activeProviderCount=0`, `requiredProviderCount=3`, `authoritativePrices=false`, `released=false`.
3. Consumer validation must be portable and contract-first. The Go and TypeScript SDKs use the same canonical acceptance vectors.
4. The consumer CLI must fail closed and must not print a value that fails market/type/version/freshness/confidence/coverage validation.
5. Dedicated Android, iOS, macOS and Windows Oracle apps are not applicable to this infrastructure product; Web/PWA, server/container, SDK and CLI are the appropriate delivery forms.
6. The next autonomous priority is artifact packaging and provenance, followed by direct accessibility evidence. Provider licenses, reporter custody, central owner acceptance, public hosting and production signing remain external blockers.
7. No state may be promoted from local/tested to integrated, hosted, signed or released without direct evidence.

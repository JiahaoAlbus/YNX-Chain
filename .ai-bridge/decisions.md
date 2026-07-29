# YNX Search Decisions

## 2026-07-27

1. Search coverage remains `registered-authorized-sources-only`; no global coverage
   or neutrality claim is permitted.
2. Source Registry v4 is the only forward schema. Pre-v4 sources without an
   explicit reviewed public data policy fail closed; they are not silently
   classified or re-enabled.
3. Public source status exposes evidence digests and review dates, never internal
   authorization or override references.
4. DNS and outbound URL validation runs before robots or content fetch. Any
   private, metadata, rebinding, redirect-origin or unsafe content failure is
   persisted as failed/backoff.
5. AI context requires a separate explicit source data right and explicit user
   consent. Ordinary Search eligibility does not imply AI retrieval eligibility.
6. Vector retrieval remains Candidate. No vector or hybrid-complete claim is
   allowed until real embeddings, quality tests, capacity and operational evidence
   exist.
7. Existing staging evidence is retained honestly, but it does not represent the
   current source commit.
8. The root secret-scan result from this run is not evidence because `rg` was
   unavailable while the script printed success. The dependency-independent
   Search scanner is the accepted local scan.
9. Search-owned data-policy v1.0.0 accepts only explicit public classes. Private,
   internal, unknown, out-of-source-policy, and high-confidence sensitive content
   is rejected before persistence.
10. Data Fabric still owns canonical ecosystem data-class acceptance. The local
    allowlist is a tested fail-closed boundary, not central integration proof.
11. AI routes enforce `aiRetrievalOnly=true` after applying client filters; clients
    cannot widen the AI context by overriding the flag.
12. Repository-wide Go failures in unrelated Chain/Trust/Faucet ownership are
    recorded but will not be fixed from the Search worktree without an accepted
    cross-product change.

## 2026-07-29

13. Runtime correlation uses bounded Request, Trace and Error identifiers. Query
    strings, request bodies, client IP addresses, error messages, source snippets,
    Wallet data and authorization evidence are excluded from structured logs and
    metric labels.
14. `/api/metrics` fails closed unless an operator configures a bearer reference;
    it is not public and does not prove central Monitor integration.
15. Process-local metrics are implementation evidence only. Durable dashboards,
    alerts, incident linkage and restart continuity remain owned by Monitor/SRE.
16. Capacity evidence must include exact source, environment, dataset, concurrency,
    latency and status counts and must remain labeled local, staging or public
    according to the environment actually measured.
17. The protected runtime source is
    `88ee867322ec11a243a483c04bab99676cc3416e`; subsequent evidence-sync commits
    may advance repository HEAD without changing that runtime source attribution.
18. The next autonomous runtime slice is a provider-neutral external Search
    adapter. Missing provider selection or credentials must produce truthful
    unavailable state, never a fixture-backed production success.

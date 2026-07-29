# YNX Search Next Action

Implement the provider-neutral external Search adapter inside `apps/search`.

The next slice must:

1. expose a Search-owned provider contract with explicit `provider`, `asOf`,
   rate-limit, retention, health and unavailable state;
2. keep YNX Index results, External Results and AI Answers as distinct result
   classes;
3. keep credentials server-side and return truthful unavailable state when no
   provider is configured;
4. bound query length, result count, timeout, redirects, response size and stored
   provider metadata;
5. reject malformed, stale or provider-inconsistent responses;
6. add deterministic fake-provider tests for success, unavailable, timeout,
   rate-limit, invalid citation/URL and retention boundaries;
7. update integration contract, test vectors, release evidence and agent memory;
8. commit, push, and verify Local SHA equals Remote SHA.

Do not request credentials until the provider-neutral contract and negative tests
pass locally. Do not represent fixtures as provider-backed Testnet evidence.

# YNX Music decisions

## 2026-07-27

- Keep `codex/final-music` as the only writable branch for this worktree; create its upstream without force push.
- Treat repository evidence as authoritative over the archived handoff. Files referenced by the handoff but absent from Git are factual gaps, not completed artifacts.
- Scope Trust and Pay idempotency by authenticated account and persist the object plus key in one transaction.
- Preserve existing short idempotency keys for contract compatibility while enforcing a bounded ASCII key format.
- Use copy-on-write state mutation: publish the new in-memory state only after durable save succeeds.
- Keep local media paths out of public JSON. Reconstruct deterministic private media paths from track IDs and hashes when state is loaded.
- Do not claim Music CI, iOS installation, production signing, hosted downloads, public deployment, licensed catalog or settled royalties until direct evidence exists.

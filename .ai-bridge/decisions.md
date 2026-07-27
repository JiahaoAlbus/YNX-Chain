# YNX Music decisions

## 2026-07-27

- Keep `codex/final-music` as the only writable branch for this worktree; create its upstream without force push.
- Treat repository evidence as authoritative over the archived handoff. Files referenced by the handoff but absent from Git are factual gaps, not completed artifacts.
- Scope Trust and Pay idempotency by authenticated account and persist the object plus key in one transaction.
- Preserve existing short idempotency keys for contract compatibility while enforcing a bounded ASCII key format.
- Use copy-on-write state mutation: publish the new in-memory state only after durable save succeeds.
- Keep local media paths out of public JSON. Reconstruct deterministic private media paths from track IDs and hashes when state is loaded.
- Do not claim Music CI, iOS installation, production signing, hosted downloads, public deployment, licensed catalog or settled royalties until direct evidence exists.
- Publish job-level CI truth: a green Service or Android job cannot override a failed iOS job or failed workflow conclusion.
- Remove branch names and local filesystem paths from public release metadata while retaining exact source commit evidence.
- Freeze Music-owned events only as proposed until Integration resolves authority/version conflicts with Pay, Trust and Data Fabric.
- Select and create an available iOS Simulator dynamically in CI; never depend on a pre-created device name in hosted runners.

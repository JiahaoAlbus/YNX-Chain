# YNX Seller Console Decision Log

## 2026-07-29 — Preserve implementation checkpoints separately from evidence commits

Runtime behavior is bound to immutable source commit `a90d1ee59eec38c15ce42b39420f2625ed758dd0`. Release and handoff documents are committed separately at `365318525937cb0b0c69f19ac7859094bc2e7cbe` so later documentation edits cannot be mistaken for runtime changes.

## 2026-07-29 — Future snapshots fail closed

A Snapshot version greater than v6 is rejected before normalization or write. Unknown future state is not treated as current state.

## 2026-07-29 — Rollback is an export, not an in-place downgrade

Operators may export a new v3, v4 or v5 file. The active state and existing destinations are protected. Any unrepresentable invitation, revocation or Seller event causes refusal rather than silent deletion.

## 2026-07-29 — Seller portability is store scoped and owner only

The exact store Owner may request an audited export of the store profile, catalog/inventory, orders and financial evidence, Seller authority lifecycle, local Outbox and store-scoped Audit. Unrelated stores and transient runtime state are excluded.

## 2026-07-29 — Retention is preview first and evidence preserving

Retention accepts only cutoffs at least 30 days old, requires integrity-protected state and explicit confirmation, and removes only terminal AI drafts and expired rate-limit samples. Authority and financial evidence are never part of this operation.

## 2026-07-29 — Website handoff is not public deployment

Metadata and a Website handoff are prepared for Owner 28, using `ynxweb4.com` as the only official YNX product domain. `deployedPublic`, `canonicalVerified` and `downloadHosted` remain false until direct current-source evidence exists.

## 2026-07-29 — GitHub TLS timeout is infrastructure, not product blockage

PR and Release inspection timeouts are recorded as execution-infrastructure observations. They do not justify marking the Seller product externally blocked, and they do not negate verified source pushes.

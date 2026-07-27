# Decisions

## 2026-07-27

1. The exact product is `05 | YNX Merchant Console`; no other worktree may be modified.
2. `pay-merchant / ynx-merchant-console-v1 / com.ynxweb4.merchant-console` with the canonical callback and ordered scopes is the only accepted Wallet tuple for this product.
3. Merchant Console owns merchant RBAC and operational presentation, not Wallet identity, chain finality, central settlement, Quant PnL, Trust decisions or Billing Ledger facts.
4. `/version` and release metadata headers are mandatory deployment evidence. Missing build linker values normalize to truthful `unknown/local`, not fabricated release data.
5. Payment commitment remains controlled by exact central Pay evidence; webhooks, UI state and AI output cannot mark an invoice paid.
6. Provider health must come from actual server-side adapter probes; catalog metadata is not production integration.
7. Quant performance fees require signed realized-net-PnL/high-water-mark ledger evidence; frontend or manager statements are rejected.
8. Historical push HTTP 502 failures are closed for the current checkpoint: runtime commit `b0934a0` is synchronized remotely. The prior Git bundle remains recovery history, not deployment evidence.
9. Merchant data export is owner-only, tenant-scoped and must exclude runtime authorization, session, replay, provider credential and webhook authentication material.
10. Deletion request routes never perform irreversible deletion. They require exact merchant confirmation, idempotency, a 168-hour cooling-off period, deterministic retention blockers and audit; execution requires an accepted policy and explicit operator authority.
11. Snapshot v3 is required for merchant data requests. v1/v2 forward migration is supported; rollback after v3 writes requires a compatible pre-v3 backup to prevent silent field loss.
12. Runtime placeholder/credential scanning must be locale-safe: normal translated words such as Spanish `Todo` and Portuguese `Todos` are permitted, while actionable comment markers, uppercase `TODO`/`FIXME`, Coming soon, example domains and credential shapes fail the gate.
13. GitHub Actions success is recorded separately from artifacts, releases, central integration and deployment. Run `30276842541` proves only the Merchant Console CI workflow for commit `c9eb7e4`; it produced no hosted artifact or release.

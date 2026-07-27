# Decisions

## 2026-07-27

1. The exact product is `05 | YNX Merchant Console`; no other worktree may be modified.
2. `pay-merchant / ynx-merchant-console-v1 / com.ynxweb4.merchant-console` with the canonical callback and ordered scopes is the only accepted Wallet tuple for this product.
3. Merchant Console owns merchant RBAC and operational presentation, not Wallet identity, chain finality, central settlement, Quant PnL, Trust decisions or Billing Ledger facts.
4. `/version` and release metadata headers are mandatory deployment evidence. Missing build linker values normalize to truthful `unknown/local`, not fabricated release data.
5. Payment commitment remains controlled by exact central Pay evidence; webhooks, UI state and AI output cannot mark an invoice paid.
6. Provider health must come from actual server-side adapter probes; catalog metadata is not production integration.
7. Quant performance fees require signed realized-net-PnL/high-water-mark ledger evidence; frontend or manager statements are rejected.
8. Push HTTP 502 is an infrastructure blocker. A verified Git bundle is accepted only as recovery protection, not as remote synchronization.

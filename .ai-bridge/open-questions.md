# Open questions and blockers

## Central contracts pending acceptance

- 02 Wallet/Auth: accepted registry tuple, challenge/completion, introspection and revoke endpoint.
- 04 Pay: reachable authoritative shared-Testnet invoice/settlement/refund execution.
- 08 Quant + 26 Data Fabric: signed realized-net-PnL, high-water-mark and Billing Ledger evidence schema.
- 13 Monitor: metrics/alerts/status ingestion contract.
- 14 AI: provider-neutral context consent, model/cost and audit contract.
- 15 Trust: dispute evidence/status/appeal contract.
- 17 Economics: authoritative fee/burn/treasury/reserve event definitions.
- 21 Bridge: cross-chain settlement lifecycle.
- 28 Website: public route, downloads and policy/status URLs.
- 29 Integration: unique protocol acceptance and shared-Testnet execution order.
- 30 Security/SRE: signed provenance, immutable artifact hosting and deployment gates.

## External blockers

- `git push origin codex/final-merchant-console` returned upstream HTTP 502 on three bounded attempts.
- No deployment authority, DNS or public policy/status URLs are available in this worktree.
- No funded secure signer path or approved provider secret-manager references are available.

## Autonomous questions to resolve in code

1. Define and implement merchant data export/delete/retention with legal-hold-safe semantics.
2. Define signed Quant/Billing evidence ingestion without inventing the central schema.
3. Complete payment-link/QR, search, pagination and confirmed bulk-operation contracts.
4. Complete authenticated operational translations and accessibility acceptance.
5. Build reproducible capacity/load evidence and durable telemetry export.

These are implementation questions, not reasons to ask the Founder for ordinary engineering decisions.

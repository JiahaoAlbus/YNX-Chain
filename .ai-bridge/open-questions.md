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

- No deployment authority, DNS or public policy/status URLs are available in this worktree.
- No funded secure signer path or approved provider secret-manager references are available.
- Irreversible merchant-data disposition requires an accepted legal retention/deletion policy, explicit operator authority and provider-specific completion evidence.
- GitHub Actions is green at run `30276842541`, but the current workflow uploads no Merchant Console artifact and the repository API exposes no visible latest release; artifact/release gates remain open by evidence, not by network ambiguity.

## Autonomous questions to resolve in code

1. Determine whether an exact accepted Quant/Billing evidence schema exists in this repository; implement only a strict owner-contract adapter, never a guessed central authority.
2. Implement approved deletion execution/legal-hold/provider-evidence/orderly-shutdown states while preserving immutable/public-chain and required financial records.
3. Complete payment-link/QR, search, pagination and confirmed bulk-operation contracts.
4. Complete authenticated operational translations and accessibility acceptance.
5. Build reproducible capacity/load evidence and durable telemetry export.

The scoped export and deletion request/cancel state machine are implemented and tested at `b0934a0`; they are not irreversible deletion proof. These are implementation questions, not reasons to ask the Founder for ordinary engineering decisions.

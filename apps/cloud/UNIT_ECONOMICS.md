# Unit economics

No price, margin, revenue, burn, or subsidy is currently claimed. The local adapter has no defensible provider cost model and the authenticated usage report therefore returns `pricingStatus: not-configured-no-charge` with every monetary field at zero.

Schema v4 persists product-isolated cumulative accepted ingress, delivered egress, scan bytes, AI input estimates, and AI job count. `GET /api/v1/usage` combines those counters with exact current deduplicated storage bytes and identifies source, authority, `asOf`, schema version, and field-level coverage. Backup and replication are explicitly unmeasured/unconfigured and remain zero rather than estimated. AI units are labeled as a provider-independent preflight estimate, never provider-billed tokens.

Before charging users, add storage byte-hours, provider-invoiced compute seconds, attributable backup bytes, replication factor, request class, refunds, provider cost, protocol fee, treasury amount, and burn amount as separate versioned ledger fields. Every quote must include currency, source, region, tier, `asOf`, tax assumptions, and coverage/confidence where estimated, followed by explicit user preview and approval.

Required scenario sheet: free quota; 1/10/100 GiB active user; low/median/high egress; scanner and backup costs; support/abuse reserve; gross-margin candidate; subsidy budget; provider outage and exit egress. User charge must be previewed and approved. Hidden spread, unrealized-profit fees, fake revenue, and guaranteed durability are prohibited.

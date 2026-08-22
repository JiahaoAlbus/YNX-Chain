# Current Campaign

Campaign ID: `P0-WALLET-CONNECTIVITY-2026-08`

## First stop scope

This initial checkpoint protects existing integration history, establishes
single ownership, registers the central contracts as non-active drafts, records
the endpoint-manifest candidate, and registers Shop Android retirement. It does
not claim that device-proof rejection, deep-link loss, or installed-app
connectivity is fixed.

## Source baseline

- Integration branch: `codex/final-integration`
- Protected prior controller history: `codex/recovery/final-integration-pre-p0`
- Migrated controller baseline: `10b877b5b18f9cb0026a6382cdd6588054fd16db`
- Product inventory authority: `release/integration/product-registry.json`

## Immediate dependency order

1. `wallet-protocol` recovers and proposes the shared transport/error contract.
2. `integration` accepts only evidence-backed candidates.
3. `wallet-platform` and `developer-sdk` consume the accepted contract.
4. Finance, Explorer/Monitor, and unassigned products migrate one product per
   commit using the accepted SDK and endpoint manifest.
5. Integration performs installed-client and public evidence acceptance.

# YNX Quant Lab Open Questions

These are owner/integration questions, not requests for secrets or ordinary
engineering confirmation. Source-addressable candidates are recorded in
`apps/quant-lab/integration/owner-contract-snapshot.json`; none is centrally
accepted in the observed Integration matrix.

1. Which exact Wallet/Auth source commit will 29 Integration freeze for Product
   Session v1, HTTP proof v1, StrategyMandate v2 and StrategyAction v1, and when
   will the `quant` / `ynx-quant-v1` / `com.ynxweb4.quant` registration move from
   `pending-review`, disabled to accepted and enabled?
2. Will 02 Wallet/Auth retain the shared StrategyMandate v2 digests currently in
   `packages/wallet-auth/testdata/strategy-mandate-v2.json`, and what retained
   shared-Testnet receipt proves authorize, revoke, kill and emergency exit?
3. What exact terminal receipt and authoritative reconciliation schemas will 07
   Exchange freeze for `/v1/quant-adapter/`, and which deployed route implements
   the no-withdraw subaccount boundary?
4. What exact terminal action receipt and authoritative Vault reconciliation
   schemas will 27 DEX freeze, and which chain-6423 deployment addresses and
   indexer version are accepted?
5. Will 19 Oracle/Market Data freeze `ynx.oracle.v1` with
   `weighted-median-mad-v1` and `index-funding-mark-v1` for Quant, and how will
   Owner 19 correct the stale product-09 DEX dependency to current Owner 27?
6. What exact Data Fabric v2 producer fields, ordering key and Billing Ledger
   account/currency/asset mappings complete the observed
   `quant-mandate-pnl-fee-kill-switch` candidate?
7. Which shared Testnet environment manifest, accounts, Faucet path and evidence
   store should be used for the Exchange and DEX vectors?
8. When autonomous gates are complete, which authorized release operator paths
   will provide public deployment, immutable hosting, Apple notarization and
   Windows signing without exposing credentials to the model or repository?

Until answered by exact accepted owner commits or direct shared-environment
evidence, Quant must fail closed and continue independent local work.

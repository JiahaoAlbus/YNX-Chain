# YNX Pay current plan

Status: Active. Current phase: FREEZE moving toward INTEGRATE.

1. Preserve Quant/service-billing implementation commit `8118cea0404030f6818a4769cc847f8716f60490` and push its source-bound contract/evidence checkpoint.
2. Add fixture-based migration/rollback plus atomic, timed backup/restore verification with corruption and wrong-key rejection.
3. Add dependency-aware health/version, structured request IDs, metrics and trace correlation.
4. Run repeatable capacity and unit-economics measurements with source commit, sample size and environment recorded; do not claim global benchmark parity.
5. Fix validation scripts so missing `rg` cannot produce a false passing secret/placeholder scan, then generate source-bound SBOM/provenance evidence.
6. Ask `29-integration` to freeze Wallet/Gateway and Quant/Data Fabric verifier contracts and run cross-product vectors; after central acceptance, run fresh Testnet Invoice, Split, Quant, sponsorship, refund, dispute and webhook-retry proofs.
7. Continue current Android/iOS install, cold-launch, accessibility and public-artifact evidence when the required device/runtime/signing authority is available.

Do not mark central, public, hosted, signed or store states true without direct evidence.

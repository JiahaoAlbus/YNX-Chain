# YNX Pay current plan

Status: Active. Current phase: FREEZE moving toward INTEGRATE.

1. Preserve the verified store recovery source commit `2303ceeed6ff8e7a8606b87a2e7155702e4e27b1` and push its exact source-bound recovery/release evidence checkpoint.
2. Add dependency-aware health/version, structured request IDs, metrics and trace correlation.
3. Run repeatable capacity and unit-economics measurements with source commit, sample size, store size and environment recorded; include production-volume recovery RTO/RPO without claiming global benchmark parity.
4. Fix validation scripts so missing `rg` cannot produce a false passing secret/placeholder scan, then generate source-bound SBOM/provenance evidence.
5. Ask `29-integration` to freeze Wallet/Gateway, Quant/Data Fabric and store-recovery contracts and run cross-product vectors; after central acceptance, run fresh Testnet Invoice, Split, Quant, sponsorship, refund, dispute and webhook-retry proofs.
6. Continue current Android/iOS install, cold-launch, accessibility and public-artifact evidence when the required device/runtime/signing authority is available.

Do not mark central, public, hosted, signed or store states true without direct evidence.

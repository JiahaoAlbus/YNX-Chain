# Open Questions — YNX Explorer

These are owner or external integration questions. They are not reasons to stop local engineering.

1. **29 Integration:** Will `explorer.summary.v1`, cursor envelope v1, `explorer.public-evidence.v1` and their HTTP 400/404/502 error split be frozen without conflicting field ownership?
2. **30 Security/SRE:** What approved secret reference, rotation and multi-instance rollout pattern should provide `YNX_INDEXER_CURSOR_KEY` in shared Testnet/public environments?
3. **01 Chain Core:** Which exact versioned fields are authoritative for AppHash, precommits/finality, state-sync, snapshot, upgrade and rollback evidence?
4. **19 Oracle:** What accepted public schema carries source, version, as-of, confidence, coverage, stale and correction facts?
5. **17 Economics / 07 Exchange / 08 Quant:** What public read models may Explorer expose for solvency, supply/burn, market, strategy, fee and PnL evidence without leaking private configuration?
6. **26 Data Fabric:** What is the canonical public product-evidence envelope and correction event model?
7. **28 Website / 29 Integration:** What final HTTPS canonical origin and indexability policy should be used for `/block`, `/tx` and `/address` pages?
8. **30 Security/SRE / shared tooling:** Who owns remediation or bounded suppression for the root Hardhat `adm-zip` High advisory when npm reports no fix?

## Current local blocker

None for the verified Explorer cursor/deep-link/public-evidence slices. Repository-wide preflight remains red in other-owner packages for key-permission and Hardhat selector-metadata tests; those failures must be resolved by their owners before a whole-repository release gate can be claimed green.

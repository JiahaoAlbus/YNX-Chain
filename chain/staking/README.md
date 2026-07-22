# Staking

Committed state v9 implements signer-owned delegation to an active migration validator, a disclosed 10% candidate commission field, explicit reward source, seven-day unbonding liabilities, maturity-gated withdrawal, fee events, restart-safe state, and validator concentration summaries. Signed staking actions preserve the existing application envelope, nonce, fee, replay, and fail-closed chain-ID checks.

The current reward source is `none_until_governed_issuance_activation`; no rewards are minted or distributed and APY is never promised. Jail and Slashing remain disabled because the recovered governance reviewer model is not sufficient authority for asset destruction. Liquid staking is not implemented.

ABCI exposes `/staking/delegations`, `/staking/unbondings`, and `/staking/summary`. BFT Gateway exposes signed mutation and source-labelled read routes under `/staking`. Current performance coverage is the migration validator snapshot, not live validator telemetry.

Consensus activation still requires an approved governance authority, bounded slash evidence and appeals, reward-source activation, live performance input, Explorer integration, emergency exit testing, and public deployment proof.

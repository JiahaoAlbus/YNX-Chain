# Decision 002: isolated StableSwap Testnet candidate

- Status: accepted as a local unaudited candidate; deployment not approved
- Date: 2026-07-23
- Supersedes: only the StableSwap deferral in Decision 001; CPMM remains supported

The expanded final DEX objective requires StableSwap. Recovery found no compatible implementation, and the reviewed Curve repository cannot be copied under its observed repository terms. YNX therefore adds a clean-room two-asset invariant implementation in a separate Factory and deployment namespace.

Stable pools normalize reviewed tokens to 18 decimals and immutably disclose amplification and fee. Pool creation is governance-reviewed to prevent parameter front-running. LP entry is proportional, exit is permissionless, Router paths remain bounded to four hops, and Indexer/SDK consumers must capability-detect `ynx-stableswap-v1`.

This decision does not approve any token as stable. There is no external peg/rate Oracle, rebasing or ERC-4626 support, single-sided liquidity, depeg pause, insurance, mainnet claim or production liquidity. Public deployment remains gated on reviewed Testnet assets, parameter rationale, source verification, audit, depeg/exit runbook and Wallet evidence.

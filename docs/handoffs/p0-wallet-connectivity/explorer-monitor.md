# Explorer and Monitor Handoff

Checkpoint: `7ef419e1191b8ded301e0f9941a698d673d55b1a` on
`codex/p0-explorer-monitor-20260820`; candidate PR #107.

The candidate contributes a cache-free `/connectivity` route and safe source
identity/error projection. It separates recovered RPC TLS faults, EVM wrong
chain, Product Session device/protocol/expiry/Gateway errors, product API and
WalletConnect relay errors, and retired clients without exposing internal
network data. `apps/monitor npm test` passed 45+8, build passed, and diff check
passed.

The task reached a checkpoint before Wave C; it must remain paused until its
formal lease. Native RPC and Faucet health inputs currently expose internal
configuration, and Faucet version remains unavailable, so neither is accepted
as safe public identity evidence.

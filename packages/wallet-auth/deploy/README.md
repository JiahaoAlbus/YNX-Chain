# Developer Wallet Gateway candidate

This unit runs the canonical Gateway on loopback port 18447 with an isolated
state directory. It is a remotely exercised candidate, not public ingress, so
`YNX_WALLET_GATEWAY_REMOTE_DEPLOYED=false` is intentional. Before installation,
replace the source directory only with the exact reviewed commit and verify the
loaded `/version` registry SHA-256 and enabled product-client list.

The candidate does not replace, migrate, or share state with the existing Wallet
Gateway. Public cutover requires a separately reviewed state migration, rollback
record, route probe, installed Wallet↔Developer callback, and exact build identity.
State envelope v2 binds the exact parsed Registry SHA-256. A v1 state fails closed
by default; a reviewed copied-state preflight may set
`YNX_WALLET_GATEWAY_ALLOW_LEGACY_STATE_MIGRATION=true` for exactly one cold start,
verify the resulting v2 envelope and `/version` registry hash, then remove the flag
before service cutover. Never leave legacy migration enabled during steady state.
`MemoryDenyWriteExecute` is intentionally not set because Node/V8 requires JIT
executable pages and fails closed with `signal=TRAP` under that systemd option.

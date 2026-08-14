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
Each acknowledged state mutation fsyncs the private temporary file before rename
and fsyncs the already-open state directory after rename. A post-rename directory
sync failure returns `STATE_COMMIT_UNCERTAIN` without rolling memory back behind
the renamed file; operators must reconcile the persisted digest before retrying.
This is local-filesystem process-crash durability, not power-loss, network-storage
or multi-region evidence. A crash before the handler releases its lock remains a
fail-closed stale-lock condition requiring a separately reviewed recovery action.
Use `ynx-wallet-gateway-state-lock inspect` first. `recover` additionally requires
`YNX_WALLET_GATEWAY_LOCK_MINIMUM_AGE_MS` and the exact reviewed Registry path; it
refuses live owners, PID reuse, a changed/young/malformed lock, unsafe temporary
state, invalid state digest or Registry mismatch. Do not delete `.lock` manually,
do not set a zero age floor in steady-state runbooks, and do not automate recovery
without a separate PID-namespace and storage-semantics review. Successful local
recovery reports the frozen state/Registry digests but does not establish central,
staging, public, network-filesystem or multi-region safety.
`MemoryDenyWriteExecute` is intentionally not set because Node/V8 requires JIT
executable pages and fails closed with `signal=TRAP` under that systemd option.

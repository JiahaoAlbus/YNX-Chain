# Finance P0-318 retained-control cleanup/readback handoff

Finance cleanup only. This request cannot deploy, roll back, restart a service, alter current/environment/state/unit/Caddy/public routes, or perform any Wallet account, signing, typed-data or transaction action.

Central P0-318 terminal evidence proves automatic rollback restored the old runtime and left exactly one deployment executor plus its signed lease under `/opt/ynx/leases/finance`. The historical tuples and hashes are evidence only; Central must fresh-read the complete parent inventory and both identities immediately before signing a new cleanup lease.

The cleanup executor opens both targets without following symlinks, binds their device/inode/full tuple/bytes/SHA, rechecks the complete parent and both paths, then moves each into a lease-specific quarantine name using Linux `renameat2(RENAME_NOREPLACE)`. Both moved objects must still match the opened identities before either is unlinked. Failure restores any moved exact object without replacement and preserves foreign or substituted content.

Success requires both targets and quarantine names absent, the parent stable identity unchanged, and the exact signed remaining-sibling inventory. A separate read-only terminal verification must prove the old current release, environment, state absence, unit, Caddy, service PID/NRestarts, health/version and seven Standard Wallet assets are unchanged.

The `7bc11b5621a47d5f5dcea4c2133e81835a878e1b` build-identity route successor is unchanged and is not authorized by this cleanup request. Its new carrier review resumes only after this cleanup reaches an independently verified terminal state.

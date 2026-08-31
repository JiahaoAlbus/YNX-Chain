# Developer SDK Handoff

Checkpoint: `315897e75c0ffe3e63435fe73cfec42244b851cc` on
`codex/p0-developer-sdk-20260820`; candidate PR #105.

The candidate provides consumer contracts for EIP-1193, EIP-6963,
WalletConnect, SIWE/EIP-712, durable callbacks, optional private-session
degradation, typed errors, endpoint-manifest validation, migration scanning, and
artwork validation. Eight tests, migration scan, and diff check passed.

The independent SDK owner must continue from this checkpoint after central review
and should not recreate Wallet cryptography. The owner worktree has a
pre-existing untracked `apps/developer/` directory, untouched by the candidate.
Remaining work is signed endpoint-manifest binding, real provider and
WalletConnect interoperability, product migrations, and platform E2E.

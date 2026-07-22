# Bridge Operations

The daemon starts only with a state path, a minimum-length API key, at least two distinct Ed25519 relayers, a threshold of at least two, and one or more fail-closed route policies. Every route keeps external submission disabled.

Before any maintenance:

1. Record exact source commit and binary SHA-256.
2. Stop mutations with the persistent safety endpoint and verify the public paused metric.
3. Copy the mode-0600 state file to restricted backup storage and record its SHA-256 and byte count.
4. Run the process-level API check against the release source.
5. Restore into an isolated path and verify startup, integrity, transfer count, audit chain, safety state, and reconciliation state.

Resume requires an idempotent operator request with a reason, a healthy persistent state, and confirmation that exposure remains within configured limits. A reconciliation difference must stay visible; it must not be cleared by editing state. External submission, signer installation, contract authority, and funded routes require a separate approval-gated deployment procedure.

# Bridge Operations

The daemon starts only with a state path, a minimum-length API key, at least two distinct Ed25519 relayers, a threshold of at least two, and one or more fail-closed route policies. Every route keeps external submission disabled.

## Incident response

Before maintenance or incident recovery:

1. Record exact source commit and binary SHA-256.
2. Stop mutations with the persistent safety endpoint and verify the public paused metric.
3. Copy the mode-0600 state file to restricted backup storage and record its SHA-256 and byte count.
4. Run the process-level API check against the release source.
5. Restore into an isolated path and verify startup, integrity, transfer count, audit chain, safety state, and reconciliation state.

Do not delete, rewrite, or manually rebalance state during an incident. Preserve request, trace, error, and audit IDs; capture health, metrics, process logs, state SHA-256, and build identity; then classify availability, persistence, provider, reconciliation, or abuse-control failure. Public status communication must distinguish this local coordinator from an externally live bridge.

## Pause and resume

Resume requires an idempotent operator request with a reason, a healthy persistent state, and confirmation that exposure remains within configured limits. A reconciliation difference must stay visible; it must not be cleared by editing state. External submission, signer installation, contract authority, and funded routes require a separate approval-gated deployment procedure.

## Reconciliation

Investigate every non-zero difference without replacing the submitted evidence. Record a new reconciliation only from a new bounded observation with its own timestamp and evidence reference. The source remains operator-submitted and not independently verified until an approved chain-proof verifier exists.

## Restore drill

`make bridge-restore-check` creates one transfer, one balanced reconciliation, and a persistent pause; copies and hashes the state; corrupts the active file and requires startup rejection; restores the backup; and verifies health, transfer count, exposure, reconciliation, pause state, and mode-0600 persistence. Its evidence is local unless a separately authorized remote drill records otherwise.

The bounded local drill in `restore-evidence.json` is the authoritative measured record. It is bound to the source commit named in that JSON and is not remote disaster-recovery evidence.

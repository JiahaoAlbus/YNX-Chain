# Current Plan

Phase: `TESTNET` local safety baseline.

Completed and pushed baseline: release record, integration contract, dependency handoff and cross-product vectors.

Current recoverable slice:

1. Strengthen the four-validator CometBFT quorum gate with byte-identical genesis verification.
2. Prove fixed-height Block Hash and AppHash equality.
3. Prove one signed YNXT transfer yields equal account state on all four validators.
4. Stop one validator, require 3/4 precommit continuity, restart it and require exact recovery.
5. Replay the committed transaction through the restarted validator and require nonce or mempool replay rejection.
6. Emit machine-readable local-only evidence to `tmp/consensus-quorum-evidence.json`.

Next slice after commit: state sync, backup/restore and rollback evidence without public cutover.

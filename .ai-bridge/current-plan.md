# Current Plan

Phase: `TESTNET` execution compatibility.

Completed and pushed:

- Integration contract and cross-product vectors: `8eb801f`.
- Four-validator Block Hash/AppHash, 3/4 precommit, fault recovery and replay proof: `f03c93e`.
- ABCI v14 State Sync snapshot runtime and tests: `913f207`.
- Stopped-validator backup, full data deletion, restore to an earlier height and rollback replay to current AppHash: `74fc8dc`.

Current slice:

1. Bind the machine release and integration records to implementation baseline `74fc8dc0c2c2`.
2. Verify EVM RPC identity, block, transaction, receipt, log, nonce and balance compatibility against the four-validator CometBFT application.
3. Identify and implement the first missing EVM execution or receipt behavior.
4. Keep public deployment, production signing and public BFT cutover false until direct remote evidence exists.

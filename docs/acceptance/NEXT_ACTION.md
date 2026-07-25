# Next Action

Current implementation baseline: `74fc8dc0c2c2`.

Completed local Testnet gates:

- four-validator identical genesis, fixed-height Block Hash/AppHash and 3/4 precommit;
- signed YNXT transfer, all-node account equality and replay rejection;
- one-validator stop and recovery;
- ABCI v14 State Sync snapshot export/import with strict v11 validation;
- stopped-validator backup, checksum and archive validation, full data deletion, restore to an earlier height and replay to the current AppHash.

The next executable gate is EVM RPC and execution compatibility on the CometBFT application. Run the existing EVM receipt and Gateway suites, then close the first missing behavior among chain identity, block queries, balance, nonce, transaction lookup, receipt status/logs, raw transaction compatibility and deterministic state commitment. Add machine-readable local evidence and keep every public/production status false.

After EVM compatibility, continue through Faucet, Indexer and Explorer Backend consistency, then Gateway central interface adapters, public service health/version/metrics and current-source Testnet smoke. Public deployment, production signing, remote recovery and public BFT cutover still require direct evidence and external approval.

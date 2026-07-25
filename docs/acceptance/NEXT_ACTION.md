# Next Action

Current source baseline: `a4bfc0d9d141`.

The immediate gate is to freeze and validate one Chain Core contract and release record, then move directly into executable four-validator CometBFT safety evidence. The deployed public baseline remains `ynx-chain-02f4ccd8770c`; it must be preserved and must not be represented as current source or four-validator BFT.

Required next execution:

1. Pass `make integration-contract-check` and focused JSON/schema checks.
2. Commit and push the frozen protocol baseline.
3. Run the existing local CometBFT package and quorum gates; identify the first missing direct proof among common genesis, fixed-height block/AppHash equality, 3/4 precommit, one-validator stop/recovery, state sync, backup/restore and signed transfer replay rejection.
4. Implement the missing runtime or verifier code rather than extending documentation.
5. Commit and push each passing slice.

Current external boundaries remain public BFT signer/custody approval, accepted central Wallet/Auth scope contract, independent public vantage, public current-source deployment and provider-backed AI capacity. These boundaries do not block local CometBFT, integration adapter, migration, backup/restore or evidence engineering.

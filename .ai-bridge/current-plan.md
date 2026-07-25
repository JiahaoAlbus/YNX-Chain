# Current Plan

Phase: `FREEZE` moving into `INTEGRATE` and `TESTNET`.

1. Freeze the Chain Core release record, integration contract, dependency handoff and cross-product vectors with a machine gate.
2. Commit and push the recoverable protocol baseline.
3. Advance the four-validator CometBFT safety baseline with executable local evidence: same genesis, validator set, fixed-height block/AppHash agreement, 3/4 precommit, one-validator stop/recovery and signed transaction replay rejection.
4. Keep StreamBFT in shadow mode unless formal and benchmark gates beat CometBFT.
5. Preserve truthful release states; current source is not deployed publicly.

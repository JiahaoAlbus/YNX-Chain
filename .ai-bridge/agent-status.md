# Agent Status

- Integration baseline `8eb801f`, four-validator safety baseline `f03c93e`, State Sync runtime `913f207`, and backup/restore/rollback replay `74fc8dc` are pushed.
- Local and remote SHA matched after every push.
- ABCI application version is 14; committed-state version remains 11.
- `make consensus-state-sync-check` passes ordinary and race tests, including ABCI Socket round-trip, restart persistence, tamper rejection and persistence-failure atomicity.
- `make consensus-quorum-check` passes identical genesis, 3/4 precommit, signed transfer, all-node account equality, stopped-validator backup checksum and archive validation, full data deletion, rollback to an earlier height, replay to current AppHash, recovery and replay rejection.
- Current machine records are being rebound to implementation baseline `74fc8dc0c2c2`.
- Public four-validator BFT, current-source public deployment, production signing and remote recovery drill remain false.

# Rich schema-v1 migration fixture

This directory contains a sanitized, deterministic-purpose migration fixture generated only from repository test helpers.

- `state.json` is a valid schema-v1 state document with a verified integrity hash and an eleven-event audit chain.
- The fixture includes synthetic YNX accounts, one published generated PCM tone, synthetic PNG artwork, listener favorites/queue/download/position/history, one completed usage record, one playlist, one allocation, one review-only settlement intent, one Trust report and account-scoped Pay/Trust idempotency claims.
- `media/` contains only the generated test tone and synthetic artwork bytes referenced by the state.
- `expectations.json` records the stable IDs and replay inputs used by `TestRichSchemaV1GoldenMigrationBackupRestore`.

The fixture contains no private keys, commercial media, personal data, production account, paid settlement or external provider evidence.

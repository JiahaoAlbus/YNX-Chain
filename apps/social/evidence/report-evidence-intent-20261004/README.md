# Report evidence and original intent binding

Base source: 73e8ff2099841bf8cf8a60689c5e128f66e34458.

The original counterexample is retained in original-counterexample.txt (exit 1): changing evidence under the original report key was incorrectly accepted.

The repair binds account, idempotency key, target, category, trimmed detail and ordered evidence to a versioned report digest. Different new keys cannot overwrite the same report result. Evidence is copied before asynchronous product revalidation, and returned evidence arrays are copied rather than exposing stored arrays.

Legacy receipts retain their original IDs and are not migrated. Replay requires an existing report with exactly matching retained content and evidence, current product authority, and the existing visibility checks. Changed evidence is rejected. The cold legacy regression uses a controlled legacy fixture, not a production migration.

Original command:

```sh
go test -overlay /tmp/social-shared-revalidator-20261004.80Jdi2/overlay.json ./internal/social -run TestOriginalReportKeyCannotAcceptChangedEvidence -count=1 -race
```

Repair regression:

```sh
go test -overlay /tmp/social-shared-revalidator-20261004.80Jdi2/overlay.json ./internal/social -count=1 -race
```

The existing repair process completed with exit 0: internal/social, 19.404s. See full-tests-repair.txt and status.txt. No original Social tests were excluded or replaced.

The overlay uses the exact read-only shared productsessionv2 namespace from c5e4178bb548baa05f552e8e1bc0f566ddc6f72d. Its durable source carrier and reproduction inputs are in ../moment-delete-cold-recovery-20261004/. Shared source was not edited or included in this checkpoint.

This is source regression evidence only. Actual backend/device/UI recovery, account-data-deletion cleanup, public delivery, Wallet lifecycle, MONSTER acceptance and new cryptographic activation remain unproven. No deployment or sensitive Wallet operation was performed.

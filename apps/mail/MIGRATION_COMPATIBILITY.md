# YNX Mail migration and recovery compatibility

Backup implementation source commit: `0e087bc1fe7f71732d28dab1a6c7414e28d424ce`
Current Data Fabric state extension commit: `f6868eccc2e47a2cde137b7b4238fa6bcce3a657`
Backup format: `ynx-mail-backup-v1`
State envelope version: `1`

## Verified local recovery path

`Store.Backup` snapshots the authenticated Mail state while holding the store lock, copies the state HMAC key and sender Ed25519 identity, writes a manifest with SHA-256 and byte counts, validates the staged package, reserves a new destination with no-replace semantics, copies files with exclusive creation and `fsync`, and validates the installed package again.

`RestoreStoreBackup` rejects an existing destination. It loads and validates each backup file once, then installs those same verified bytes into a newly reserved mode-`0700` directory. Files are mode `0600`. The restored store is opened and HMAC-verified before the function succeeds.

The self-contained package contains sensitive key material. It must remain inside an approved encrypted operator backup boundary. Its HMAC and manifest checks protect the local recovery workflow under that boundary; they are not an external-signature or hostile-storage authenticity claim.

## Preserved state

The drill preserves users, sessions, wallet-request replay records, drafts, messages, mailbox state, blocks, Trust reports, AI jobs, provider events, recipient-hash suppressions, dead letters, provider health, rate-limit state, audit entries and the Mail sender identity. Current state additionally preserves canonical Data Fabric events, the last acknowledgement and the next monotonic event sequence.

The provider recovery drill specifically proves that a complaint remains suppressed after restore, the dead letter remains visible to the sender, the verified webhook timestamp remains present and a new send to the suppressed recipient remains fail-closed.

## Compatibility matrix

| Source state | Target runtime | Result | Evidence |
| --- | --- | --- | --- |
| Current authenticated state | Current runtime | Pass | `TestBackupRestorePreservesProviderRecoveryAndSenderIdentity` |
| Current backup with state tamper but refreshed manifest hash | Current runtime | Rejected by HMAC | `TestRestoreRejectsTamperingUnsafeLayoutAndInvalidSender/state_HMAC` |
| Current backup with undeclared file | Current runtime | Rejected | `TestRestoreRejectsTamperingUnsafeLayoutAndInvalidSender/unexpected_file` |
| Current backup with unsafe permissions | Current runtime | Rejected | `TestRestoreRejectsTamperingUnsafeLayoutAndInvalidSender/unsafe_permissions` |
| Current backup with inconsistent Ed25519 private key | Current runtime | Rejected | `TestRestoreRejectsTamperingUnsafeLayoutAndInvalidSender/inconsistent_sender_key` |
| Legacy version-1 state without provider recovery maps or Data Fabric outbox fields | Current runtime | Pass; missing maps/events/ack/sequence normalize empty and sequence starts at 1 | `TestRestoreAcceptsLegacyStateWithoutProviderRecoveryFields` plus `TestCanonicalMailOutboxIsTransactionalPrivatePersistentAndAcknowledged` |
| Current outbox state after acknowledgement and restart | Current runtime | Pass; acknowledgement persists and sequence remains monotonic | `TestCanonicalMailOutboxIsTransactionalPrivatePersistentAndAcknowledged` |
| Two concurrent installs to one destination | Current runtime | Exactly one succeeds | `TestStagedInstallUsesNoReplaceDestinationReservation` |
| Current state with Data Fabric fields | Prior accepted strict-decoder Mail binary | Expected rejection from source inspection; runtime drill not executed | Versioned rollback export and exact old-binary drill remain required |

## Validation record

- `go test -race ./internal/mail`: pass
- `go vet ./internal/mail`: pass
- `npm test --prefix apps/mail`: 9/9 pass
- `npm run build --prefix apps/mail`: pass
- `npm run smoke --prefix apps/mail`: pass

The 2026-07-29 shared repository preflight is not green: Mail passes, while Developer-owned BFT/Consensus IDE tests cannot find the canonical generated `SampleEVMWriteCounter.json` artifact. Shared placeholder and secret scan scripts are also not accepted as passing on the current host because a missing `rg` dependency previously produced a false-green exit code.

## Remaining recovery work

1. Define a versioned rollback export that strips or transforms fields unsupported by the prior accepted runtime.
2. Run the exported state against that exact prior binary and prove read, start, restart and safe re-upgrade.
3. Add an operator CLI or protected administrative workflow; the current drill is exercised through the Mail package API and tests.
4. Measure backup and restore duration and storage growth under the capacity plan.
5. Bind backup encryption, retention, rotation and destruction to the Security/SRE owner policy.

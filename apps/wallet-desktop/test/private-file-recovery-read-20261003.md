# Preserve existing Wallet files across bounded read failures

## Current source and actual issues

Inherited clean source: `2352c947f46ffcb8d086c4766ce6143bfe91d281`, tree `56b4353bb8831e868b9b9501bf1448dcdca5580a`. Normal Desktop startup uses `PasswordWalletVault`/`PasswordVaultFile`; signed transfers and Pay recovery use `FileTransactionIntentStore`. The retired `DesktopWalletVault` implementation was inspected for routing only and not modified.

The two production private-file readers checked fstat size before bulk `readFile`. Password storage also checked decoded UTF-8 byte size afterward; the journal had no post-read size limit. Growth of the same inode after fstat could therefore cause an unbounded bulk read, and the journal could accept an oversized JSON document with trailing whitespace. In addition, their catch-all ENOENT handling treated failures after a successful open/private-policy check as an absent file: password read returned null and journal read returned empty state. That is not safe evidence that a Wallet has never been created or that there is no unresolved original transaction. Finally, raw close failures could supersede the intended canonical storage refusal.

## Scoped implementation

- New `src/bounded-private-file-read.mjs` reads an already-open file from explicit byte positions, with a 1 MiB + 1-byte buffer and at most 64 KiB requested per read. The extra byte proves overflow; EOF preserves the exact established UTF-8 decoding and digest. Invalid byte counts and I/O failures cannot become partial records or unbounded loops. No parser, truncation, replacement, unlink, key access or content logging is in this helper.
- Both production readers retain original regular/private-file checks and the original 1 MiB limit; password storage also retains its prior post-decoding UTF-8 byte check. Existing record schemas, paths, key/password cryptography, signed bytes, receipt semantics and atomic writes are unchanged.
- Only ENOENT from the actual initial open, before a handle exists, retains the original fresh-Wallet null/empty behavior. Policy/stat/read failures on an opened file fail closed and preserve original files. A close failure cannot turn a rejected original into success, reflect a private OS path, or replace an already established primary refusal.

No existing account, recovery generation, journal, GUI profile, Native App, startup branding, installer version, shared SDK/Auth/registry, Web or Host was changed. This is owned production read-path implementation, not a new authorization or an attempt to enable missing protected business ports.

## Current evidence

Controlled QA closure: `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`, retaining admitted SDK955.

| Check | Actual result | Log SHA256 |
| --- | --- | --- |
| First four integration targets against unchanged baseline | 0 pass / 4 fail, exit 1 | `a69b135adecd94d32726d181dde38925ef592aed5d2fa76765845512d90113a3` |
| Final nine targets against independently archived original 2352 production readers | 2 pass / 7 fail, exit 1 | `cf31cf338dfafdf0f11b230dada547626ac09340b0a599717f701c33ba5b4c02` |
| Final owned private-file targets | 9/9, exit 0 | `7986d80eb803f9da58cabb9d3d41a4851dd360cc0ebce1f635cd55640ad26a39` |
| Final complete Desktop regression | 694/694, no failures/skips/cancellations, exit 0 | `9ad84e7e4ae6506fcb6e35ec4ab8ed27bf60fbec295ffd0eb3d06bc39737bbb0` |

First/final owned QA logs: `private-file-bounds-before.log`, `private-file-bounds-final-v3-targeted.log`, `private-file-bounds-final-v3-regression.log`. The independent original archive and final red log are `/tmp/ynx-wallet-private-read-baseline-09sEvI/private-read-original-final-targets-v2.log`; the current bounded helper was copied there solely because the final test also directly tests that helper, and is not imported by the unchanged original production readers. An earlier wrapper printed its temporary path after the test, so its shell exit was not the test result; the separately rerun v2 command exited 1 as recorded above. Intermediate logs are retained, not relabeled as final evidence.

New tests cover partial reads split inside Unicode, exact-limit acceptance, overflow before and after fstat, prior malformed UTF-8 expansion refusal, invalid read counts, generic I/O errors, close-error/primary-refusal preservation, and probe/stat/private-policy/read ENOENT boundaries versus actual initial absence. The real filesystem test opens new mode-0600 synthetic vault/journal files, appends controlled whitespace to that same file after fstat, and verifies exactly 1 MiB + 1 requested bytes, no bulk read, one close and unchanged full on-disk bytes. Those disposable fixtures contain no real keys/accounts and are cleaned up only within their freshly created test directory. Existing source tests for password migration/recovery, durable journals, Pay settlement, lifecycle races and QR inputs remain in the full regression and were not weakened.

Native App remains SHA256 `c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`; previous Native 935/935 is inherited, not rerun. Native release-content 100-file check and `git diff --check` pass. These source/filesystem checks do not establish installed OS custody, real account upgrade/recovery, public business payment, Web adoption, formal installers or user acceptance.

## Remaining full-goal gates

The current observed A thread reports a uniquely signed runner with forward activation failure and Root3/56 recovery-required state; this is routing/coordination evidence, not a successful Wallet release. This chat performed no Host read/write, activation, rollback, re-signing or runner retry. Current exact Wallet native/business/OS tuple handback, complete cross-platform source graph, sole-A forward versions/signing, final website download/install and normal user business acceptance are still missing here. Mac was last observed locked; no real GUI/biometric/account operation or unlock bypass was performed. Real external input and MONSTER were not run. Overall objective remains active.

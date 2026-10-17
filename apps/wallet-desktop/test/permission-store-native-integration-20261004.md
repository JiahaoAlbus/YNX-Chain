# Retained account permissions — owned Desktop batch

Inherits Native Wallet checkout HEAD `05b09275f49a1e4a77a97e128dfb67250644060c`. Only Wallet-owned sources changed. Existing accounts, encrypted vaults, transaction journals, unknown signed originals, SDK registry, release versions and running user/old QA profiles were not changed.

## Product correction

The previous schema1 reader checked only the outer object. A string containing the selected account could satisfy `.includes(account)`, allowing malformed old records to expose an account or prepare a signature review. Concurrent mutations used the same temporary filename and could overwrite one another. Unbounded reads and post-open ENOENT handling also failed closed-storage expectations.

The original permission store now validates every nested record before trusting any origin: canonical HTTPS origin, exactly one lowercase Ethereum account in an array, original capability and valid approval time, with no unknown schema fields. It reads an actual private regular file without following a final symlink, bounds reads to the existing 1 MiB policy, and treats only initial-open ENOENT as absence. Post-open inspection/read/close errors refuse access instead of creating an empty store. Public diagnostics do not disclose local paths.

Same-process instances using the same resolved absolute filename serialize grant/revoke/revokeAll. Unique exclusive private temporary writes are synced, staged-readback checked, published through the existing native private-file policy, and final-readback checked before reporting success. Cleanup removes only a temporary file created by that operation. Failed pre-publication writes retain the existing permission file. A failure after publication does not promise rollback or that the old bytes survived; it never claims a successful grant. This is not authenticated storage or a cross-process CAS.

Unverifiable records are not silently reset on account switch/import/add/recovery revocation. Those operations can remain unavailable until a separately reviewed recovery is supplied; the old accounts/records remain retained. Existing approval queues are cleared before the attempted account change, and a signature approval rechecks the file before key access. No signing/custody guard is relaxed.

The new owned refusal is displayed through actual account/import and password/recovery UI paths, explicitly translated into all twelve existing languages. Unknown remote diagnostics remain literal text, not translated or interpreted as HTML. Locale changes do not grant authority or change user inputs. Existing raw diagnostic formatting is retained for unknown errors.

## Concentrated checks

Final exact source candidate: `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`, admitted SDK955 dependency graph; src directory byte comparison with the owned worktree exit0.

- Final targeted permission/account/balance/password/locale checks: **48/48**, exit0; `permission-store-final-targeted-v3.log`, SHA256 `0f09d1aac8607a37c3e176a7edeaafceefa1ad821aaf36da18fe3106c59c45df`.
- Final complete Desktop suite: **715/715**, exit0; `permission-store-final-regression-v3.log`, SHA256 `7a416d5cff76c77f132e91d80b54f04700803091e0a755e17f3a49ee10e9541b`.
- Exact original HEAD archive with final fourteen storage/authority targets: **0 pass / 14 fail**, exit1; `/tmp/ynx-wallet-permission-original-20261003-YD6EYG/apps/wallet-desktop/permission-store-final-original-v3.log`, SHA256 `c07b28410aba6918ea9dd0973c57e5d9bbee74fb4f388b5e6ca95a0974b715ea`. This includes missing hardening/test-injection/immutability, not fourteen independent exploits.
- Actual fixture files cover malformed nested grants, original bytes retained, eight concurrent grants, late revoke ordering, post-fstat growth, post-open ENOENT/close failures, lost staged/final write readback, queue recovery, no key call before refusal, review corruption and account change prevention. Fixture accounts are synthetic public addresses, not user accounts.
- Mounted actual renderer/password handlers cover all twelve locales, stale balance removal, locked Send retained, and raw unknown diagnostics preserved. No browser/OS acceptance is claimed from mounted tests.

Intermediate regressions are retained: the first full localized run failed three mounted balance tests because its fragment fixture lacked the new display helper. The fixture now loads the actual helper and real imported renderer, with a new localized failure test; final complete suite above is green. Earlier 709/713 runs are intermediate, not substituted for the final 715 result.

Current public QA app fingerprint: `0af6bd9b446981393eb900cf4d7ac07549a45d601d872d59414156f7c2fa2bb8`. It is not a commit/dependency/release signature or proof of a rendered new GUI. No old Wallet GUI was relaunched or modified.

Native Windows ACL execution, cross-process races, formal installer adoption, protected Wallet/Pay integration, real external transfers/settlement, enrolled-device key lifecycle, Web ownership/parity and full user acceptance remain separate unverified gates. MONSTER and missing real external inputs remain unrun. The full product goal stays active.

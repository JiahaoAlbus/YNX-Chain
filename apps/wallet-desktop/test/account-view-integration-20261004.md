# Desktop account / security view continuity, 2026-10-04

This is a complete owned successor to `d5f2acd6a1d5906d555427a64e17a3535c614347`, not an installer or user-acceptance claim. The d5 permission-epoch candidate and its immutable archive remain independently reviewable; this follow-up does not alter that original artifact or clear its release HOLD.

## Real owned renderer defects

The original renderer directly rendered initial account-status reads and create/add/select/import receipts even after a newer main-process account event. Delayed successes could switch the visible active account back, delayed refusals could replace its current notice, and old finalizers could clear a new file draft or enable a newer in-flight action. Backup completions could also publish into a locked or newer account view. These UI races do not prove that the main process signed a wrong account; they are nevertheless incorrect account/backup/transaction-display continuity.

The original initial security-status promise likewise could replace a newer lock/unlock notification, including two states of the same lifecycle generation. Older-generation notifications were not rejected. Recovery opening did not catch transport rejection from accountStatus or recoveryHistory; a structured history failure was silently treated as empty history.

## Repair boundaries

The actual account renderer advances a local view revision whenever status is accepted. Initial reads, ordinary account creation/addition/selection, authorization-account creation and import receipts respect its ownership. Main-process account events remain authoritative; success receipts do not render their older status a second time. A normal import commit is still acknowledged when its exact account event is the one new view and the current locked account matches. Old finalizers do not enable a newer busy action or clear its file draft. No shared wire schema, storage format, signing policy or account identity is changed.

Backup results require the original view and key revision to remain current and unlocked. Lock invalidation clears old import/backup feedback while retaining all accounts, files and pending transactions. Credentials are still cleared before IPC; tests use dummy strings only and no network or real keys.

Initial security reads cannot override a newer event, even within one lifecycle generation; older-generation notifications cannot roll the current view back. Failed initial reads retain the locked defaults and show a current-view notice.

Recovery read rejection is handled in its original view only. Unavailable account metadata keeps recovery closed and locked. Unavailable saved history remains visibly reported in all twelve existing locales, without removing the offline-backup recovery form. Existing backend exact-account/backup/password/review checks are unchanged. A late failed read cannot overwrite a newly opened password draft.

## Actual evidence

Candidate runtime: `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`, same inherited SDK955 graph. Tests execute actual renderer fragments and the actual password-vault UI with controlled IPC timing, not a replacement model of those handlers. They are mounted source evidence, not real Electron GUI acceptance.

Immutable original d5 source extracted to `/tmp/ynx-wallet-accountview-original-20261004-lA6SU1/apps/wallet-desktop`:

- `account-view-original-d5.log`: 26 selected original account/backup/recovery cases, 1 PASS / 25 FAIL, test runner exit 1. The passing case is the already-working structured account-status refusal. SHA256 `e956d9dff6924faf40078eaa324da98c3425600c373744804d3e473331979d8b`. This is not a count of 25 independent vulnerabilities.
- `security-view-original-d5.log`: four original security-view regressions, 0 PASS / 4 FAIL, exit 1; SHA256 `5961e2c20e3f2bd09828941ab0ba168149ebf16970d5e94050ffeee50b5aecca`.

Logs are retained under `/tmp/ynx-wallet-desktop-ui-20261004-wjXlEW/`. `account-view-targeted-v5.log` covers account/backup/security ownership, recovery errors, current successful import, existing balances and twelve-locale recovery/custody behavior: 83/83, exit 0, SHA256 `a78bd16bc7167625c2b6afb0c28a8427fa0826e35b091cf8b304444c7d701a00`. Earlier targeted and full logs are retained, not replaced as if they tested later source.

Final complete Desktop suite `account-view-full-regression-v3.log`: 783/783, exit 0, SHA256 `8bc4bb811d1d022e9f299668ce3fda4cd5cbb949f538158074e6e80e4d9e6bfd`. The earlier 777/782 runs do not stand in for this final source.

## Unfinished full-product gates

Actual CUA target selection returned Mac locked again in this turn. The own isolated Electron session `59328` was confirmed live; its page loaded d5 before this new source was synchronized and is not evidence of this successor rendering. No automatic lock bypass, credential entry, user profile/key modification, real chain write or foreground Mail/Social takeover occurred. GUI validation must normally launch the exact successor after the Mac becomes accessible, followed by the separate existing device schedule.

Native frozen App.tsx remains SHA256 `c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`. Native 943/iOS onboarding results are inherited, not rerun. Shared protected Pay ports and approved crypto-core-v2 contracts are still absent; crypto-core-v2 is NOT_IMPLEMENTED / NOT_ACTIVATED. Formal source/release/signing/installer identity, website installation, physical credential flows, real Pay/transfer/receipt recovery and user acceptance remain separate open gates. MONSTER was not run.

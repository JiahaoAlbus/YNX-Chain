# Account/security/operation ownership successor

Baseline: exact `257b3d3d921940e15ca5c5454c3cd8131269f1e4`, tree `1b39f2d911279e001a82e7b85866a34d5c784da3`. Its 83 targeted / 783 complete-suite greens remain historical evidence, not a closure of the later independently reproduced composition defect. The baseline remains SOURCE_HOLD for that defect until successor review. The d5 permission-epoch source admission is preserved separately.

## Actual original reproduction

The independent probe under `coordination-01a094cc/recovery-20261003/combined-authority-independent-review/native257b/independent-security-composition.test.mjs` executes actual account/import/backup/security renderer handlers together. Normal own import event + locked success receipt passes. After that event, a new same-account unlock/lock makes the old import receipt overwrite a newer notice; after same-account lock/unlock and a new pending backup, an old backup finally enables the new busy button. This is delayed UI receipt ownership after the main process already committed/released its lease, not unauthorized signing or key access.

The probe was retained in owned `account-security-composition.test.mjs`, with only two import/source routing changes; its original three cases remain unmodified. The original 257b was independently extracted to `/tmp/ynx-wallet-composed-owner-original-20261004-6Zrryc/apps/wallet-desktop`, with inherited SDK955 dependencies. Reproduction: 1 PASS / 2 FAIL, test runner exit 1, `composed-owner-257b-original.log`, SHA256 `651b6c1057e0ddf3f502ce7f093ae3370abfa29dba2e07a4821c7b73cd630ebb`. Root's original test/log were not edited.

## Repair

Each create/add/select/authorization-create/import/backup UI action captures its own control identity, accepted account view, lifecycle revision and semantic security intent. The renderer privately retains the exact current operation per control. A changed lock/unlock/account/authenticating state changes security intent; an unchanged normal lifecycle notification does not cancel a legitimate in-flight receipt. This is only UI ownership, never a replacement key context or signing permission.

An import may acknowledge its own main-process commit event, which captures the exact current account/security/lifecycle snapshot at that event. The receipt must still belong to the same operation and that exact snapshot. Later lock/unlock journeys, new actions or new views cannot claim it. The successful import notice is retained without replaying the older account status. No guessed revision increment is used.

Outputs, draft cleanup and control finalizers require joint ownership. An obsolete operation cannot enable the current busy control or clear its newer draft. Normal unchanged security notifications preserve busy state for the current operation. A newer invalid backup submission also owns its validation notice over an older pending receipt. No re-keying, duplicate IPC submission, account replacement or storage-format change was introduced.

## Current verification

All logs below are retained in `/tmp/ynx-wallet-desktop-ui-20261004-wjXlEW/`:

- `composed-owner-original-probe-successor.log`: original three cases, 3/3, exit 0; SHA256 `b5ffbe81d3d9882a522c18f8b098e44eb8fb379da352a5c1ef31a06b1549f63f`.
- `composed-owner-expanded.log`: 10/10, exit 0; SHA256 `1636c7121890e91fb7c221e90dc4f8b92793b24fe45dbf22a01345d36dc10c74`. Includes unchanged normal lifecycle notifications, same-account old success/refusal/throw, newer import/file draft, and newer backup validation intent, preserving normal import and backup successes.
- `composed-owner-final-targeted.log`: 109/109, exit 0; SHA256 `6ea166580a84cb52f5b4beeebf821d7f86cea0498b2eb35a60571240ae02702f`.
- `composed-owner-final-related.log`: 160/160, exit 0; SHA256 `ba15e2c69ecc495e63b99bbe13c4ff71e7a2c6f6cac3393dfa99e3ef29c02ba5`. Covers the composition probes, account/balance/password/recovery/locale UI, permission epoch and original independent permission boundaries, plus actual transaction-resolution/history, contract, QR/file and Pay service/modal handlers. No full 783/Native943 rerun was used to mask the original failures.

QA source was synchronized mechanically to `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`. An attempted `git diff --check` in that non-Git QA directory returned Git usage after a passing 10-case run; the real owned checkout check passes. This was a QA-directory invocation error, not a product test failure.

## Preserved full-goal boundaries

Only Desktop renderer source changes in this successor. d5 permission store/epoch/authority/vault/lifecycle/sender/submission source remains byte-identical. Native App.tsx SHA remains `c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`. No shared protocol, registry, device credential, account/key data, unknown journal, original failure artifact, signing configuration, version or formal release was changed.

This is controlled mounted-source evidence, not actual unlocked Electron GUI, installed upgrade, real account/Pay/transfer or user acceptance. The own running QA page loaded 257b before source synchronization, so it is not evidence of this successor rendering. Mac lock/shared real-port delivery still gate the remaining full journey but did not block this owned source fix. Crypto-core-v2 remains NOT_IMPLEMENTED / NOT_ACTIVATED; MONSTER was not run. Independent successor admission and the sole A release path remain required.

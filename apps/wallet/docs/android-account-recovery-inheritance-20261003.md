# Published Android account protection and original-transfer recovery inheritance

Source baseline: Android `a9fff0d84fe0e4b67a520136ab9c8d4721f6c23e` (published code 34), not the older candidate code 22. Parent owned source: `b2b008009979906186e0b76a6f2309f13fc156ba`.

## Delivered source behavior

- Restored the published `SecureStorageAdapter.assertSecretProtectionAvailable` hook and the real Expo strong-biometric capability check before writing a protection marker or authenticated secret. The lifecycle guard is passed into the check and rechecked after its await. This is capability detection, never approval: the existing cipher-bound authenticated v3 secret service, protected readback, explicit migration/recovery, and no-legacy-downgrade rules remain unchanged.
- Failed enrollment/cancelled authority does not leave a newly created pending marker or change original account/legacy/recovery records. Public startup/catalog metadata remain unauthenticated and do not invoke this hook.
- Restored the published `NATIVE_OUTBOX_HISTORY_PREFIX`, `NativeTransferResolution`, and known-hash `resolution(account, hash)` API. The exact old eight-field record is signature/account/origin/hash/checkpoint validated; current Done archives are also readable. Reading neither migrates nor overwrites bytes. Corrupt old copies are not hidden behind a valid current copy.
- Restored the published `recover(account, client, guard)` API for original-hash public reads after reopen, with intentionally safer completion semantics: accepted stays accepted and requires explicit acknowledgement; no auto-Done, key use, signing, authorization, or broadcast. Origin mismatch is rejected.
- An accepted record's revalidated original local-snapshot checkpoint is retained monotonically; a later unavailable/replaced node cannot demote it and expose retry. This is not consensus-finality evidence.

## A integration boundary, still outstanding

`apps/wallet/App.tsx` remains A-owned and was not edited. Its current SendModal reopening effect only calls `nativeOutbox.read`; the published effect performed guarded `recover` against the stored original origin. A must compose the recovered API into the existing effect using a current account/visibility operation lease, suppress stale UI/callback updates after close/lock/switch, and keep the retained Pay check before generic Done/new send. Recovery itself never settles Pay or auto-releases the outbox.

The existing paged history retains/imports the known active old Done journal before replacement. SecureStore has no key enumeration API: arbitrary older `native-outbox-history.v1` slots are accessible only by their known hashes. This batch does not pretend to reconstruct a complete old-history index or invent original creation times/attempt counts. A may expose a reviewed known-hash lookup; it must not relabel unknown archive coverage as complete history.

No Native App.tsx/startup assets, shared SDK/Auth/registry, formal platform versions, OS signing, installer, real profile, key, or payment was changed. Android code 34 must not be downgraded to candidate 22. A remains sole release/composition owner; default protected Pay stays closed without real current policy/session/business/settlement ports.

## Verification

Isolated candidate: `/tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet`; owned five-file delta copied from this checkout, dependency baseline read-only admitted SDK `9555b01e47519a5df882bb0092d2d20e1d7ce6e2`. Candidate dependency tests do not assert A's final installer contains matching SDK ports.

- Targeted repository + original-outbox tests: **126/126**, exit 0 (17 added tests).
- Full Native TypeScript source regression: **887/887**, exit 0, no skips; `android-account-recovery-regression.log`.
- `tsc --noEmit`: exit 0; `android-account-recovery-typecheck.log`.
- Android and iOS Expo/Hermes exports: both exit 0; `android-account-recovery-export.log`, `ios-account-recovery-export.log`, `dist-android-account-recovery`, `dist-ios-account-recovery`.
- Workspace `git diff --check`: exit 0.

Tests use controlled synthetic storage/HTTP/biometric capabilities and exact production signature/checkpoint validators. Expo/Hermes exports prove JavaScript bundle compatibility, not a fresh OS binary, real enrolled biometrics, camera scan, install/upgrade preservation, public transfer, authenticated settlement, or final user-flow acceptance. Those gates and MONSTER remain **NOT_VERIFIED**. The overall Wallet goal remains active and incomplete.

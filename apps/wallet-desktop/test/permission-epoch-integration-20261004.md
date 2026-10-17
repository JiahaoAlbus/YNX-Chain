# Desktop permission revocation successor, 2026-10-04

Baseline: `8546201f3e2261fdae67df888608441a629ef1d2` remains SOURCE_HOLD for its independently demonstrated approval/revocation race. This successor is an owned-source candidate for independent re-review, not release authorization.

## Actual defect and repair

The original immutable source reproduced both negative cases: an approval paused on an already-open permission FD entered key access after completed origin revocation; and the actual password vault / DesktopKeyLifecycle could finish signing when revocation occurred inside its awaited vault read after permission readback. The two original integration negatives failed (0/2). The independent three-boundary probe is retained with only owned relative import routing changes, including its actual lifecycle/AsyncLocalStorage lease and no-key sentinel.

FilePermissionStore now shares process-local origin revocation epochs across same absolute-file instances. Revocation invalidates old leases immediately, including failed revocations, and in-flight revocations reject authorization reads. Revoke-all invalidates every origin. FD readback alone cannot revive an old lease. The existing schema, original records, private-file rules, bounded reads, serialization, and publication-failure distinctions remain intact. No cross-process CAS, authenticated permission-file, OS key binding, or crypto-core activation is claimed.

DesktopWalletAuthority retains a private review lease after taking a request. Origin revocation, revoke-all, account change, explicit cancellation, transport expiry and review deadline fence it through awaited status/permission/preparation work. Regrant requires a new review. The original vaults bind that lease to their real storage/decrypt/callback guards; transaction submission composes it with the existing key lifecycle rather than creating an alternative context. Revocation prevents any not-yet-entered outward effect. Already-created signed intents remain recorded for original-hash recovery; no silent re-sign or broadcast. Existing outward-effect lifecycle handling is retained.

The ordinary password/setup/migration/recovery UI also rejects obsolete completions after a newer explicit view intent. Old completions cannot overwrite the newer notice, close its dialog, clear its password draft, or initiate status refresh on its behalf. All twelve original negative view tests failed against baseline, then passed on the repair. One test fixture initially incorrectly used Send to open first-time setup; this was corrected to the actual local-password entry without changing product behavior, and the original failed log is retained.

## Evidence

Runtime: `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`, inherited SDK955 dependency graph. Source synchronized mechanically from the owned checkout. No shared dependency/protocol edits.

Logs under `/tmp/ynx-wallet-desktop-ui-20261004-wjXlEW/`:

- `permission-original-integration.log`: original two integration negatives, 0 PASS / 2 FAIL, exit 1; SHA256 `5f7c8bd59fce30d4eb27b953b6feee177d63bdb6b782461915651887a57652b3`.
- `permission-authority-targeted-v2.log`: related authority/store/lifecycle/shell/independent-boundary tests, 96/96, exit 0; SHA256 `de06efb4aaabc905bf10d6a2eefc6362629e34ae9c85d37e357abe4b435b95ce`.
- `permission-sender-effects.log`: actual CanonicalTransactionSender with existing lifecycle, before-sign/after-sign/before-broadcast/unrevoked, 4/4, exit 0; SHA256 `e5cfe9442492f19dafa245dbcc29f29b4444e2f86fa2ccb0eb5a6a648c5117b8`. RPC is simulated; public scalar-one fixture, no real funds/network transactions. The pre-broadcast revocation retained one original intent.
- `custody-view-original.log`: original view negatives, 0/12, test runner failed; SHA256 `ec711c5f69449c1c37a1605b563a7313fb252724badcda074ee4a677925568b9`.
- `custody-view-targeted-v2.log`: 12 repaired view negatives plus successful explicit-unlock journey, 13/13, exit 0; SHA256 `81ad90c520201b65c9dc9996ccda715189db94e57eecea7694c652253aa6ed92`.
- `desktop-permission-successor-regression-v2.log`: complete current Desktop suite, 748/748, exit 0; SHA256 `7c18f55fd0ad6894872051b126444fe55c3df09bf60836b64539bec1bb5cdb1b`. Native tests were not substituted or rerun.

## Actual GUI boundary

The ordinary Electron baseline process uses a new isolated profile `/tmp/ynx-wallet-desktop-ui-20261004-wjXlEW/profile`, CDP9316. Read-only empty-profile evidence passed: no accounts, locked, not focused, no credential entry/export or chain writes. Actual CUA target selection returned Mac locked on two separate turns. No unlock bypass, old profile modification, credential setup or GUI acceptance occurred. The running page loaded baseline before this successor was synchronized; it is not evidence of the successor rendering. Future GUI QA must launch/read back the exact successor normally.

Native App.tsx frozen SHA remains `c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`. Native 943/iOS ordinary signed Simulator onboarding evidence remains inherited, not rerun here. Full physical/account/Pay/current shared ports/website installer/upgrade/user acceptance remain unverified. Crypto-core-v2 is NOT_IMPLEMENTED / NOT_ACTIVATED; MONSTER was not run.

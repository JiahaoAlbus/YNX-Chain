# YNX Finance evidence index

Generated for the 1.2.0 local Testnet candidate on 2026-07-18.

| Evidence | Result |
|---|---|
| Shared canonical Wallet package | 21/21 tests passed |
| Finance edge Gateway | 2/2 tests passed, including revoke/tamper/replay |
| Finance Go API | package tests passed, including activity coverage, notes, monthly review, deletion and persistence |
| Finance product contracts/smoke | 6/6 tests and smoke passed |
| Native type/locales/approval contracts | typecheck and 6/6 tests passed |
| Native Hermes bundles | Android and iOS exports passed |
| Android release build | 77,371,822-byte APK; SHA-256 `37208e56e96357371b19afc290d82d68adf1f0596213dbcd777341a949915f4e` |
| Android install/cold launch | `com.ynxweb4.finance` 1.2.0 (3), exact callback, `LaunchState: COLD`, 16,313 ms |
| Local Web/API | `/health` 200; CSP, Permissions Policy, no-referrer and nosniff present |
| Remote Explorer/Pay | see `remote-source-smoke.json`; Pay receipts remain unverified without a key |
| Current-run visuals | `ui-audit/after/` light/dark Android and desktop/mobile Web screenshots |

Excluded evidence: the shared emulator intermittently displayed a System UI ANR unrelated to Finance. No screenshot containing that dialog is accepted. No fabricated signed-in or Pay state is included.

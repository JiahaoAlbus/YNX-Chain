# Account-scoped intent cleanup candidate

Base: c80d1e31f2f1e3b12bf9e0f6bc0c74abd8ada0e5.

New native Moment report/action/publication writes use the account-bound AccountIntentIndex SecureStore adapter. An index reference is saved before the record. A per-account local queue serializes writes and cleanup, and a persistent deletion fence is written before indexed records are removed. Every asynchronous cleanup step checks the captured post-delete API generation. Record account/key derivation is checked before removal. References remain on cleanup failure for explicit recovery. No background backend DELETE retry is added.

Outbox snapshots write durable per-account index markers for canonical accounts. clearAccount preserves other accounts, commits filtered alternating snapshots, fences new original-account entries and preserves the legacy carrier. It no longer invokes global clear from Settings.

Settings uses a locally account/generation-bound deleteAccountReceipt, then indexed cleanup and account-only outbox filtering. It no longer unconditionally deletes four global SecureStore keys. Those legacy keys, unindexed hashed records, unknown recovery carriers and other product caches remain preserved. The normal confirmation UI remains inherited. A success alert explicitly states local erasure is incomplete.

IMPORTANT: deleteAccountReceipt is a local derivative of the existing request success, not an independently protected backend receipt. The existing deletion API response type is unknown. Exact deployed deletion success/body/account contract, actual Settings mount/invalidation lifecycle and all destructive operations require independent source review and an authorized dedicated QA flow before admission or runtime acceptance. This candidate is not approved for real account cleanup or release.

Controlled tests: cold indexed cleanup, other-account and unknown legacy preservation, index-first write failure, stale storage await before erasure, corrupted reference to another account, two-slot account filtering and stale outbox cleanup. Full npm test 387 PASS, zero FAIL/SKIP; tsc exit 0; Android/iOS isolated Expo exports exit 0. These fixtures do not prove every OS await/crash phase, cross-process compare-and-swap, signed install, protected backend semantics or real user acceptance.

No shared source, host/release configuration or unknown APK/cache/model/stage artifact is included. No deployment, real account deletion, sensitive Wallet request or cryptographic activation occurred. Full Social v2 and crypto649 remain incomplete.

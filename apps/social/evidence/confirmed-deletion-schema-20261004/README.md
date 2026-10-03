# Confirmed deletion schema and captured account boundary

Base: 154560f3558c59cc20338c75bfa7825838081f08. Original 154560 remains SOURCE_HOLD; this successor needs independent full-path review.

Root's original four red probes and failure log are retained without modification. Probe SHA256 0c64d876da8ed6bc2d5c21ad24d5bd64410c6cd70f45db8fda6609c86336e179; original red log SHA256 957765115acbf073c908eba0e555ca733afb6617f86b9d9b654aa14d60011f4d.

Before local token invalidation, deleteAccount now requires the exact original service success object {"deleted":true}; false, absent, string, invalid JSON, arrays and extra ambiguous fields do not qualify. Current authorization is checked before accepting the body. Failed/ambiguous responses retain the current authorization and original local intent/outbox rather than advancing cleanup.

Before issuing a cleanup-bound deletion, deleteAccountReceipt requires the existing current Product Session account and proof owner to match the captured account. A constructor token with unknown legacy owner cannot produce this local result and does not issue DELETE. No caller-supplied Session, parameter regex, new identity, synthetic canonical adapter or private key is adopted as ownership. Existing request proof-account/current-generation checks and post-invalidation generation checks remain in force. This is an account-bound local acknowledgement, not a new protected backend receipt.

The unchanged independent four probes now pass via the unknown-owner refusal boundary. Separate new bound-Product-Session source fixtures actually issue the request and reject false/missing/string/invalidJSON/ambiguous bodies before invalidation/cleanup; they are essential and are not replaced by the earlier probes. Additional regressions cover exact true success and original cleanup, unknown legacy binding with zero requests, account switching during final JSON await, account switching in invalidation callback, and protected-storage failure followed by explicit cold local cleanup without a second DELETE. Synthetic proof headers are test inputs only, not production authentication evidence.

Full npm test 401 PASS, zero FAIL/SKIP. TypeScript exit 0; actual isolated Expo Android/iOS exports exit 0 at /tmp/social-confirmed-deletion-schema-20261004.BHs0s9. The old 154560 known success-body defect, preceding 73/5be failures and pre-c80 HOLD are preserved.

Remaining gates: independent complete Settings/index/outbox review, all OS/crash/cross-process phases, trusted legacy owner recovery, old unindexed record erasure, actual protected backend and normal destructive-action QA, signed install/public delivery/MONSTER, full Social v2 and crypto649. No real user data was deleted, no sensitive Wallet request or deployment occurred. Unrelated dirty/untracked paths were preserved and excluded.

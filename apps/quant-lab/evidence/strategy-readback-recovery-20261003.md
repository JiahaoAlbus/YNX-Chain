# Strategy readback recovery

Before repair, the new shipped-app regression threw `Cannot read properties of null (reading 'ID')` during render. A malformed saved row prevented the rest of the workspace from rendering. Numeric strategy hashes also reached string-only operations.

Ordinary changes: reject malformed saved display rows with localized schedule-unverified text while preserving valid rows; guard optional row accesses during schedule read/write reconciliation; filter null/array/non-string hashes out of Paper choices and submit pre/post-confirm checks; seed mandate selection only from a readable saved strategy. No row is deleted or rewritten, and no service/authority contract changes.

An initial attempt required the full display identity for Paper selection. The full suite correctly rejected that tightening because the existing Paper contract accepts saved hash receipts without display IDs. The final repair preserves that contract with a separate hash predicate; it does not hide failures or modify old fixtures to weaken assertions.

Executed full direct business suite: 67/67 PASS, 429.042417ms. Actual Google Chrome focused test: 1/1 PASS, 2406.394958ms overall, controlled readback installed into shipped page after real local Go server boot. All 12 languages preserved one valid strategy beside three unavailable rows; Paper choices remained valid, subsequent empty read disabled submission, no page errors, no POST/PUT/DELETE, one tab. Screenshot retained at tmp/quant-lab-evidence/strategy-readback-recovery.png (local controlled test, not public or real account evidence). Diff check PASS.

Release owner integration remains ordinary-hunks-only; preserve shared authority, current storage compatibility fences, pending intents and durable rows. Rollback only these UI/read fences. Prior immutable integration manifests are not rewritten to falsely bind new working bytes. Public source binding, Wallet approval, real order execution and installed delivery remain unverified; full goal remains incomplete.

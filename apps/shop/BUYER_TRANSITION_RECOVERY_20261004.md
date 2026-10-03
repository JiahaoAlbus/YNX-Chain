# Buyer original transition recovery — 2026-10-04

This is the existing Commerce product source, under the same ownership. It is a source/build checkpoint, not confirmation of publication or whole-goal completion. The user authorized publication after quality validation; formal integration, signing and deployment remain with the unique A owner through Root.

The fixed POST /api/orders/{id}/transition-intent-lookup consumes the original Buyer three-scope authority. It compares current actor/role, original target/action/key and the original persisted typed semantic hash. It reads a cloned current order without repeating transition, inventory, refund, Trust or provider work. Existing idempotency rows and retired digests remain unchanged. Current authority fences and verified Wallet representation apply to the response. A must explicitly mount this route in the canonical protected adapter.

Web Buyer ordinary forms use an independent opaque journal namespace and the existing real Web Locks/durable before-dispatch marker. Cold recovery is available even when the accepted action has changed the current order status. The user chooses the original action and restores its original inputs; matching recovery only reads the fixed lookup. Changed input, account, target, key or late view outcomes do not clear the old unknown record. No review text/address/proof/token is stored in the Web journal. Only a never-dispatched prepared request may be discarded explicitly. Cold restoration disables private navigation until bootstrap completes, avoiding early private views being cleared by subsequent session restoration.

Android saves new offline drafts against the actual current approved Native session rather than the retired commerce_session field. Original queue formats/rows remain. Both unknown online transitions and queued Native transition records use original-body lookup, exact receipt validation and current session/privacy-generation fences. A malformed successful response is validated before the original request ledger is acknowledged. Apple recovery uses the same original encrypted envelope, fixed lookup and current view/session fences. No unknown original transition is automatically resent or assigned a replacement key.

Validation on isolated copied source with retained cached dependencies:
- Shop 46 Node checks, Seller 49 Node checks; both Web builds pass.
- Four real Chromium Buyer action checks pass: actual chosen review, lost response/cold recovery, explicit prepared discard, closing/signout during held readback. Nine checkout/invoice browser regression checks pass.
- Android full Debug assembly and 40 targeted JVM cases pass.
- Apple 44 actual production-model checks, all source parse, original full macOS Debug and iOS Simulator Debug builds pass. Signing disabled, no app installed or device approval performed.
- Buyer lookup controlled Go race checks cover exact original request, cold later state, deep clone, unchanged domain, original role/key/target, retirement, current revocation and checksum-valid Wallet projection. Earlier selected transition/Seller race coverage remains retained separately.

The first cold browser check failed because it could open private orders before restoration cleared the workspace; the bootstrap navigation fence fixes that behavior and the same check passes. A first added Go Wallet projection fixture used a non-address placeholder; it correctly failed current checked address normalization. The fixture now uses the existing checksum-valid address codec rather than weakening production validation. Raw failures are retained.

Remaining release gates: actual matching A canonical backend/SDK/static deployment; independent Seller/Merchant qualification and approval; final entry readback; Native exact iOS authority; formal signing/packages/installed Android and macOS journeys; real Wallet/user private approval and real owned public business readback. Public snapshot currently has old Buyer app.js and Seller/Merchant 404. No local test is represented as a public operation.

Known usability boundaries retained honestly: Web cold recovery requires restoring the original inputs because its durable journal intentionally contains only digest/key/phase. Legacy Native queue rows do not prove whether they were dispatched; lookup-not-found preserves them. New purely offline drafts therefore still need an explicit, proof-bound unsent draft retry design before the complete offline user journey can be claimed. Old unknown rows cannot be reclassified as unsent or automatically replayed.

## Explicit offline successor

OFFLINE_DRAFT_RETRY_20261004.md supersedes the earlier new-draft retry design gap: new Native transition drafts now carry independent prepared/dispatching/unknown metadata and explicit original retry. Legacy phase-less or dispatching/unknown originals still only read back, and not-found never makes them unsent. Formal integration/public/installed acceptance remains unverified.

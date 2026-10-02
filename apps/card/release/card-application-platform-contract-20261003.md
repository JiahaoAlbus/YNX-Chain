# Card TEST application delivery contract

Source-only owner continuation of 94aa044e0a188368fc4f39662bfbda03e9ac033e.
No Live issuer, AICardAPI, real card credentials or payment authority.

## Platforms actually present

- Web: Expo/React Native Web and existing canonical card.ynxweb4.com entry. Current public compiled source is not this owner candidate.
- Android: com.ynxweb4.card, native project and singleTask ynxcard callback intent exist. Installed application/review/cold-start acceptance is not proven by these declarations.
- iOS: com.ynxweb4.card project, ynxcard scheme and React Linking handlers exist. This is not an independent macOS application.
- macOS: no apps/card/macos project. The Web/PWA can be a browser surface on macOS; native macOS delivery, installer and lifecycle are NOT_IMPLEMENTED/NOT_VERIFIED. Do not advertise an existing native macOS Card download.

## Normal application consumption

1. Guest exploration remains available without a private session. Standard EVM connection does not grant Card application authority.
2. A separately approved Card session supplies owner, binding, expiry and SDK introspection proof. Private reads require account:read.
3. Read /api/card/v2/provider-programs and /api/card/v2/provider-applications. Exact disclosure and risk acknowledgement precede the TEST draft.
4. POST /api/card/v2/provider-applications with provider/programId/nickname/useCase/testSpendingLimitMinor/cardAccountCurrency/minorUnitDigits/termsVersion/termsHash/feeDisclosureHash/riskAccepted and an Idempotency-Key. Scope: card:application:write.
5. POST /api/card/v2/provider-applications/:id/terms with termsVersion/termsHash/feeDisclosureHash/riskAccepted. Hosted verification remains backend-capability-gated, not a fake identity step.
6. POST /api/card/v2/provider-applications/:id/approval-request with platform/fundingSourceId/idempotencyKey. Use the accepted SDK request unchanged; do not mint a product-local signature or invented URI.
7. A-owned Hosted CardApplicationApproval must present exact owner, product, application, details, purpose, permission, expiry and callback. Web transports canonical data through the approved Hosted bridge, never navigates to a custom scheme. Native resolver/install/platform acceptance remains A-coordinated and unverified.
8. POST /api/card/v2/provider-applications/:id/approval-result with {resultURL}, under the same owner and card:application:write, using the saved result operation key. Backend verifies the accepted callback against the stored request. Mere app return is not approval.
9. POST /api/card/v2/provider-applications/:id/submit with {}, Idempotency-Key equal to the approved request operation. Approval, details and expiry must still match. UNKNOWN outcomes require readback, not a fresh create operation.
10. GET :id/status, :id/history, :id/operation/:operationId and owner applications are readbacks, not inferred success. No actual ACTIVE card or funding is claimed without accepted backend evidence.

All routes above are beneath /api/card/v2; do not confuse them with the distinct v1 sandbox Card business routes.

## A-owned transport and deployment gaps

- Implement Hosted CardApplicationApproval through the accepted Wallet package contract. The owner Web seam currently fails before approval preparation; it does not manufacture success.
- Confirm API method/path/bodyDigest/nonce/current-owner permission binding for these exact routes; do not reuse a Social-only audience verifier or a Finance signing key.
- Registry/platform source tuples and scope eligibility need A acceptance. This proposal is not an expanded registry grant.
- Publish compatible compiled JS and runtime identity with the actual TEST backend identity. The old public frontend equality check rejects the existing separately-versioned backend. Changing only runtime JSON is not a compatible deployment.
- Download catalog integration belongs to its existing owner: classify Card under Wallet/Finance as TEST application/simulation, link the existing official Web/PWA, and list native downloads only when A supplies real eligible signed artifacts. Do not create another Card or alter Website/Wallet/Finance source here.

## Data preservation and exit semantics

No old SDK namespace, account, keys, business applications or audit data is deleted. Owner/session rotation clears the displayed private view and invalidates late reads. Approval journal remains owner-scoped and survives ordinary native callback recovery.

Legacy local-only intent is retained but cannot automatically restore private access without the current tab marker. Explicit private review can resume access; Standard Wallet and Guest remain independent.

Local application cancellation is POST :id/cancel with {}, card:application:write and one review-bound idempotency key. UI requires an explicit modal confirmation, accepts only a CANCELLED receipt with upstreamCancellationConfirmed=false, and never labels this as upstream cancellation or Wallet revocation. Approved/issued/pending-create applications do not offer this action.

Private session revocation remains the accepted SDK/backend operation with confirmed return. A failed revocation is not success. A local pause/hide is not logout or remote revoke. The dual-storage-completely-unwritable cold-isolation boundary remains UNVERIFIED; users are not asked to manually delete data.

## Local UX scope and remaining QA

Key application action buttons, field labels and cancellation modal have 12 locale strings, including distinct traditional Chinese; disabled semantics and switch labels are explicit. Untouched program/backend disclosure text, raw status values and remaining explanatory prose are not claimed fully localized. The existing application panel still needs full end-to-end installed accessibility, focus/keyboard/large-text/RTL and callback tests after A publishes the compatible runtime.

Source candidate readiness is not full product completion. Account approval, Hosted return, backend acceptance, ACTIVE, funding, native install/macOS and current candidate public runtime gates remain false until direct evidence. Formal builds and publication remain A-owned.

## Changed-path regression

Typecheck passed. New twelve-locale action-copy gate: 1/1. Provider UI regression: 16/16, zero skipped, including the prior owner/session race gates plus explicit keep/confirm cancellation, receipt validation, stable retry key, owner-switch invalidation and approved-application exclusion. The unchanged 94aa source/backend/native suites were not rerun.

Evidence directory: /private/tmp/ynx-card-recovery-20261002.
Typecheck log SHA256: 28452eecae54a204214ff127677eb25e57f3b60d392d68d17cbb5a111843d600.
Action-copy successor log SHA256: 6a7ce37084d9067bfe72340edbbd6194a6838f736a634b8b4cc228fac571c86e.
Provider-modal log SHA256: ec19a7991ebc85442986319874cbd1097f6227ae7fae2180f0aeb1ce7ff90188.
Original action-copy failure is preserved: its generic assertion incorrectly rejected the valid French word Transactions because its spelling equals English. Only that explicit linguistic exception was corrected. The initial typecheck found an indexed lookup possibly undefined; unknown keys now return null as the declared contract requires.

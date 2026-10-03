# Card TEST records: localization and accessible review

Owner continuation of source 29242367887a442a1b8ce2797cd478588feee7b5 on codex/card-test-service-recovery-20261002. Scope: apps/card only. This is a source candidate, not a release or complete product.

## Owned changes

- All static labels in the existing provider application workspace have explicit twelve-locale coverage, including explanation/error/recovery text and traditional Chinese. Known application/Card record statuses are localized. Active status is labelled as a TEST record, not spending authority.
- Known transaction labels localize for display only. An unknown bounded machine code is retained beside a localized unverified label; it is never inferred as cleared, funded or approved. Original reconciliation codes, dates, identifiers, currency and amount precision remain source data.
- Stored UI notices are message keys, so switching language retranslates existing feedback. Error codes remain codes, not pretranslated cached text.
- Original provider fee/risk disclosure remains verbatim, selectable and explicitly labelled as untranslated. No amount, fee, disclosure/hash or risk acknowledgement input is rewritten. Official localized provider disclosures require provider/A provenance and matching business acceptance; this owner does not invent legal translations or claim those are available in twelve languages.
- Confirmation review uses a bounded-height ScrollView, scalable larger body copy, RTL layout for Arabic, labelled disabled controls and at least 44px choice/button targets. Closing review restores Web focus to the current-owner trigger. Native focus uses the existing React Native accessibility interface; owner change invalidates old review without focusing an old-account action.
- Cancellation remains the existing TEST API and exact receipt checks from 292423678. Local cancellation is not upstream cancellation, session logout or backend revocation.

No shared SDK, registry, Hosted transport, backend API, Website, native manifest or formal artifact was modified.

## Targeted regression after interrupted execution

Typecheck passed; locale/status tests 4/4; existing-plus-new provider UI tests 19/19; zero skipped. Tests cover stale owner records, callback guard, cancellation confirmation, stable cancellation retry key, disabled review during flight, focus restoration with synthetic host refs, Arabic layout/language-switch error feedback, and exact original disclosure preservation across locales.

Evidence directory: /private/tmp/ynx-card-records-20261003.
typecheck.log SHA256: 28452eecae54a204214ff127677eb25e57f3b60d392d68d17cbb5a111843d600.
copy-tests.log SHA256: 03a7fa1fba909aeb86279baf56538d93724761989ce59e01a5957ec3d47b777a.
ui-tests.log SHA256: 2c1ff536be1247a97bafd244568533349a376c173c20b6940599ac73f527276b.

The previous temporary log paths were unavailable on continuation; no deletion or cleanup was performed by this owner. These changed-path gates were rerun to provide readable evidence. The unchanged full 94aa source/backend/native suites were not rerun. Initial diagnostics remain in chat history, not claimed as recoverable raw files: indexed missing value, an omitted Not available translation, unknown transaction identifiers hidden by a display helper, and a fixture rerender pinned to English. Those were corrected without relaxing record-isolation assertions.

## Integration and product gates

A still owns compatible compiled JS/runtime/backend source identity, real Hosted CardApplicationApproval transport, canonical source/permission acceptance, and formal builds/publication. Existing method/path/body/permission proposal remains card-application-platform-contract-20261003.md. This batch adds no signature, callback or URI protocol.

Independent macOS native Card remains absent; Web/PWA is not evidence of native installation. Wallet/Finance download catalog integration stays with its existing owner and real signed-artifact authority.

New candidate public runtime verified: false.
Installed large-text/RTL/keyboard/screen-reader accessibility verified: false.
Real Wallet approval/callback and backend application acceptance verified: false.
Real backend revocation verified: false.
ACTIVE card/funding/YNXT top-up/payment verified: false.
Both-storage-unwritable cold isolation: UNVERIFIED.
Live issuance/AICardAPI/real PAN/CVV/fiat/merchant payment: excluded.

After A's compatible final deployment receipt, Root can trigger owner verification from the normal failed application buttons; no repeated probing of an unchanged old public runtime is represented as acceptance.

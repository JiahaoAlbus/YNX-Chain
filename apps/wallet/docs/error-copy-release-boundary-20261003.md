# Current error-copy and release-check boundary

Inherited source: 15a1750d3cf29a20d55360d3c977306fd9aca2aa. App remains exactly A's frozen 05beb31d869cff8955892bfd77095199e38b05dbdc64579e2580bb9dc88ceb73. No App/startup/versions, Desktop product source, SDK/Auth/registry, Host, profiles, keys, payment authority or installer changes.

## Error outcome preservation

The old walletDetailError/accessibility-summary lookup used the prototype-inclusive 'in' operator. A remote diagnostic such as constructor or __proto__ was incorrectly classified as a translated catalog entry: English omitted the unverified-result qualification, Simplified Chinese/Arabic could throw TypeError, and other locales could reject the unexpected key. This affects the current App's Connected Apps/revocation error presentation and accessibility summary.

Own-property membership now governs both paths. Unknown diagnostics retain their exact original string with the existing localized unverified-result qualification; unknown summary segments remain unchanged. Known revocation outcomes and exact Auth code substitution retain their original meaning. Direct walletCopy lookup also rejects unsupported locale/key uniformly with a generic error, not arbitrary input echo. No account, original request, session state or permission is changed. The 205-entry original table and every existing translation remain unchanged.

Before-fix regression: detail-error-before.log, 1 PASS / 3 FAIL, SHA256 a7d210db19ecdb47bb5b0d84ddd00b494b48cde06914e9c021d296b1deb3a702. After: i18n 34/34 and full Native 926/926 PASS, no failures/cancellations/skips; tsc exit 0.

## Release content, not translation deletion

The existing /\bTODO\b/i regex rejected Spanish método because JavaScript word boundaries treat its accented letter as a boundary. The correct runtime translation is retained. TODO/FIXME patterns now use Unicode letters, numbers, combining marks and underscore as word constituents. Three focused tests verify natural Unicode words, genuine standalone markers in all casings/comment/quote/punctuation contexts, immutable/deterministic policies. All other filler and literal-secret patterns and failure behavior are unchanged. Actual release-content check passes across 98 runtime/config/metadata files.

The inherited full-goal-coverage script structurally passes against release/integration/PRODUCT_RELEASE_MATRIX.json generated 2026-07-30T18:30:42.183Z and its accepted source f28b0aa29a0d93a2b7f20a00b835c4a1aa6175b3. Its assertions are unchanged, but its output now identifies the recorded source and explicitly states that current release/OS/installer/UI/business acceptance is not established. No old central metadata or source acceptance record is rewritten. product-check's source-label/config checks also do not establish rendered UI or runtime business completion.

## Current evidence

All QA logs below are under /tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet:

- detail-error-targeted.log: 34/34, SHA256 522b13cb167e1bf7dd97633089418b725fa9217d6b662d373ba9d4236ae8489a
- detail-error-full-regression.log: 926/926, SHA256 d540599a1a30bf117e570012d3db2f74ed1373051b16329a6325cc41054c8e36
- detail-error-typecheck.log: exit 0, empty log SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
- detail-error-release-policy.log: 3/3, SHA256 4dbf2c4de614b2d1f641ba825050847fbca24bee52ccf1b4a76a15c0d213fcc0
- detail-error-release-content.log: exit 0, SHA256 a435491d80ae9581cafb477c935c14b9bddea38fff8abd57a1033e7a90943a51
- detail-error-recorded-coverage.log: structural check only, SHA256 0726306a0bb2e829c5a7ff95f8ec8834ea006372ef6296eecc661f3c8570a53c
- detail-error-android-export.log: Hermes exit 0, SHA256 29c9637e529dce3b1fc72fa4e69e2d7266e2acc7365017649887cfe116faa1fb, bundle index-54b837abc92d8388abb7d01165b5cda6.hbc
- detail-error-ios-export.log: Hermes exit 0, SHA256 66986f7cce6957dc111de734186fc1ad9dfeca4bda2389854258136d368c2af9, bundle index-ce51bb1fbc2cc30a96b0c6c047e227c0.hbc

## Whole-product gates still open

Product Design audit preflight found no saved context. Current CUA inventory explicitly reported that the Mac was locked and automatic unlock failed. No product flow was accessed or captured, no screenshots are accepted, no old protected window was touched, and no new Wallet GUI/profile was launched. The attempted visual audit is paused, not passed; manual unlock is required before capture. Fonts/RTL/long-text/camera/native biometric rendering remain unverified.

Readback of current frozen App still finds five bilingual Dashboard expressions at lines 314, 325, 331, 335 and 336: clipboard-copy failure, scan entry, contract entry, confirmed-history entry and Pay-receipt entry. The adopted 124-flow and 205-detail catalogs are not a claim that these remaining entry points are twelve-language complete. Native has not modified them outside A's precise one-import/six-wrapper grant; A must freeze/compose their exact delta. The inactive session reasons remain a six-value validated enum in sessionInventory.ts; no unsupported new reason or shared protocol is introduced.

The live A/Root thread snapshot shows active coordination, not installed release completion. A's operational checkpoint file remains the older 11:23 UTC observation; it is not fresh proof of Host authority. Current Wallet package/session tuple, protected OS/business ports, authoritative deployed contract reads, final sole-A forward installers/website install and actual public payments/settlement remain open. Real external inputs and MONSTER remain NOT_VERIFIED. Keep the full original goal active.

# Finance report/export transport and owned lifecycle

Predecessor: `a90814389331798d3b2e703b88d95bc06f4fc7f8`, tree `89d9540cae35b9d3f18404c0c8432f08c84b2f98`. Ordinary Finance product response consumption only; no Finance authority, shared Wallet/Auth/SSO, permission, SDK, formal asset graph, Host or release change.

Previously the response was completely read before enforcing the 8 MiB limit. Native browser responses now use streaming byte checks before retaining each chunk, fatal UTF-8 decoding with split-character support, bounded declared Content-Length, account/revision assertions before and after reads, cancellation on invalid/retired/deadline outcomes and reader lock release. JSON and CSV exports keep their existing MIME/protocol, credentials, fixed endpoints, proof adapter and filenames. Writes are never automatically replayed; reads retain their existing bounded retry behavior. Legacy controlled adapters lacking native streams retain the existing post-text bound; this is not claimed as a native browser streaming guarantee.

## Executed final combined gate

`node --test apps/finance/tests/product-response-recovery.test.mjs apps/finance/tests/owned-read-controller.test.mjs apps/finance/tests/owned-save-controller.test.mjs apps/finance/tests/owned-save-browser.test.mjs`: **33/33 PASS**, no skips/failures/cancellations, 36849.482209ms.

Coverage includes native Response oversized/malformed/incomplete UTF-8 cancellation, stalled deadline and old-owner chunks, invalid declared lengths, one-write/no-proof-replay, actual Chrome native split UTF-8 JSON/CSV streams, HTML refusal followed by explicit verified export download, old-owner export suppression, single-flight downloads/saves, owner/date-bound statement recovery, unchanged drafts, privacy and account-switch controls. Actual Chrome uses controlled local origins/responses, not real Product Session/native approval or public business authorization.

`node --check apps/finance/web/app.js` and `git diff --check`: PASS.

## Failures found and corrected, not omitted

Initial regression had fixture errors: asynchronous rejection observed too late; closed native streams do not invoke the underlying cancel callback again; escaped CSV fixture contained literal backslash-n. Those fixture assertions were corrected without weakening the byte/cancellation/owner checks. Controlled Chrome export also exceeded its deadline while automation waited for click/navigation and download together. This transport-specific case now invokes the same production DOM button handler directly and still awaits/verifies the actual download event. The independent mouse-click export test remains unchanged and passed (30862.564459ms); no claim is made that this long automation wait is optimized or that public download UX is proven.

## Remaining public and final product gates

This source delta is not a public deployment. Release owner must integrate ordinary Finance app delta into its latest authorized candidate, regenerate its owned formal asset hashes, publish source-bound runtime, then route real private-account/report/export verification with the accepted Wallet/Auth runtime. No shared graph overwrite, SSH, server write, actual account/signature/order/transaction occurred. Public-current-source/private Product Session/provider approval/native install/multi-instance/ComputerControl/full financial completion remain unverified. Report destination remains 接续测试网生态审计工作 (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`) only.

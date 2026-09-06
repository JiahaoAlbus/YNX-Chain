# Browser store preparation — draft, not submitted

Reviewed on 2026-09-06 against Wallet Web source based on `882d04712414e7cb27aa3b81ee9aa8726cfc2b87`. This directory prepares a new candidate; it does not change that commit's frozen packages or establish installation, store approval or publication.

## Materials

| File | Use |
| --- | --- |
| `listing.en.md`, `listing.zh-CN.md` | English and Simplified Chinese listing copy, with prominent data disclosure |
| `permissions-data-map.md` | Source-backed permission reasons, recipients, local retention and dashboard answers |
| `privacy-policy.draft.en.md`, `privacy-policy.draft.zh-CN.md` | Publisher-review drafts; placeholders must be completed before use |
| `submission-build.md` | Exact build prerequisites, historical Git inputs, source submission and reviewer steps |
| `release-readiness.json` | Machine-readable unresolved publishing gates and official references |

## Changes in this candidate

Firefox declares required `authenticationInfo`, `financialAndPaymentInfo` and `websiteContent`. These cover approved authentication signatures, account/transaction information and DApp request/response content. It cannot claim `none`. Mozilla's March 12, 2026 documentation requires the declaration for new extensions submitted from November 3, 2025. Firefox's built-in consent is used with a desktop minimum of 140; older Firefox and Firefox Android are not offered. No optional telemetry is implemented. The category assignment is our mapping of the actual code to Mozilla's taxonomy, subject to reviewer assessment. [Mozilla consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)

Both extension manifests disallow private browsing because the current vault, permissions and transaction journal are persistent profile storage. This is a browser policy declaration; an installed-browser verification remains pending. Normal Firefox containers have separate origin/account permissions bound to the browser-provided cookieStoreId. Old unscoped Firefox grants require a new connection. The vault and account-level transaction journal remain shared within the extension profile; this is not a separate vault per container. Actual Firefox container UI verification remains pending. [MDN incognito](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/incognito)

The package verifier now includes the shipped `wallet-address.js` in its exact PWA integrity list. README custody/provider descriptions and Firefox minimum-version package metadata are corrected. No signing, vault, RPC or shared Wallet/Auth implementation changes are included.

## Publication gates

1. Confirm the legal publisher, support and privacy contacts, domain control, applicable markets and store accounts. Do not treat `wallet-testnet@ynxweb4.com` as a verified contact or registered AMO identity.
2. Confirm the RPC/website operators, processors, hosting regions and actual request/IP-log retention/deletion practices. Complete both privacy drafts, publish the approved HTTPS policy and link it from the product/homepage and store dashboard. Nothing here has been published.
3. Verify the real pre-install data disclosure/consent experience. Chrome's current policy requires disclosure and affirmative informed consent before installation; listing copy alone has not been proven sufficient by this task. Edge dashboard answers must match the product and policy. [Chrome disclosure policy](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements), [Edge publishing](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
4. The build now generates the declared 128 px icon from the approved original logo; its dimension warning is resolved. Review the four existing Firefox `innerHTML` lint warnings with source context; do not suppress them or label lint warning-free.
5. Capture the new immutable candidate's actual installed normal/private-window behavior, Firefox built-in consent, Chrome/Edge DApp connection and signing delta, and real store screenshots. The Mac is locked; these checks remain pending. Older `5d4bda5` screenshots and successful flows describe that source only, not `882` or this candidate.
6. Verify Firefox container permission separation and displayed browser context in the installed extension before asserting AMO privacy compliance. Preserve the known queued-old-document request review boundary; the existing epoch tests do not prove every browser document-delivery ordering.
7. Use `export-reviewer-source.mjs` after the root commits this candidate, then run `rebuild-reviewer-source.mjs` from a newly extracted archive with locally installed dependencies. Record the final archive hash and exact output-byte match. The explicit exported authority mode preserves fixed commit/path and dual-hash checks; a plain source copy without its authority file is insufficient.
8. Select a unique release version/AMO ID against the publisher's actual store inventory, submit only with separate authorization, and record the resulting signing/review/publishing receipts independently.

The English/Chinese files are usable editorial drafts, not uploaded localized listings. Current runtime translation support does not itself populate manifest `_locales` store metadata. Verify each store's locale/category controls and any necessary manifest localization before claiming both listings are available.

Current icon candidate web-ext 10.6.0 lint: **0 errors, 5 warnings**. The missing-data declaration and icon-size warnings are gone. Alongside four existing template warnings, the linter compares desktop minimum 140 with Android's consent minimum 142. This candidate omits `gecko_android` and therefore declares desktop availability only; preserve that warning for review instead of adding untested Android support. [MDN browser settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

## Visual assets

Plan actual screenshots at **1280 × 800**, which meets the documented Chrome and Edge sizes. Chrome requires an icon and 440 × 280 promotional tile; Edge recommends a 300 × 300 logo (minimum 128 × 128), and allows up to six screenshots. Supply the current blue/white UI and public QA identity only; no password, recovery key, substituted balances or staged approval result. [Chrome images](https://developer.chrome.com/docs/webstore/images), [Chrome listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [Edge listing](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#step-7-enter-store-listing-details-for-each-language)

The existing actual screenshot provenance is in the audit file `web-extension-installed-qa/5d-real-screenshot-source-manifest.json`; its captures are historical and not yet ready for store submission. No store badge, store URL or publisher verification is invented.

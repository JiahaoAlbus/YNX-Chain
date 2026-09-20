# Browser store release kit — prepared, not submitted

Reviewed on 2026-09-20 against merged Wallet Web baseline `6bbf12d87a7274d73b7f2157157954d061b8efd0`. This directory contains the technical material that can be prepared without publisher accounts, signing credentials, contact details or legal approval. It does not claim a signed package, store upload, review or release.

## Materials

| File | Use |
| --- | --- |
| `listing.en.md`, `listing.zh-CN.md` | English and Simplified Chinese listing copy, including pre-install data disclosure |
| `permissions-data-map.md` | Source-backed permission reasons, recipients, retention and dashboard answers |
| `privacy-policy.draft.en.md`, `privacy-policy.draft.zh-CN.md` | Complete technical drafts with publisher/operator placeholders |
| `assets/`, `store-assets.json` | Current 128/300 icons, 440 × 280 promo, 1280 × 800 localized screenshots and exact hashes |
| `generate-assets.mjs`, `verify-release-materials.mjs` | Deterministic brand-asset generation and fail-closed release-material validation |
| `submission-build.md` | Exact build prerequisites, historical authorities and reviewer rebuild steps |
| `release-readiness.json` | Machine-readable public/candidate boundaries and remaining external inputs |

## Current manifest and data disclosure

Both extension variants use manifest version 3, version `0.1.1`, `incognito: not_allowed`, permissions `activeTab`, `scripting`, `storage`, and HTTPS host access. Chrome and Edge require version 120 or later. Firefox requires desktop version 142 or later and declares required `authenticationInfo`, `financialAndPaymentInfo` and `websiteContent`. No `gecko_android` entry is present, so Firefox Android is outside this release. No optional telemetry category is declared. [Firefox consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/), [MDN browser settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

`web-ext` 10.6.0 lint of the generated Firefox directory reports 0 errors, 0 warnings and 0 notices. This is a static package result; it does not imply AMO approval or signing.

Private windows are excluded because the vault, permission records and transaction journal use persistent extension-profile storage. Firefox site permission records include the browser-owned `cookieStoreId`, exact origin and selected account, so each normal container authorizes separately. The encrypted vault and account-level transaction journal remain shared by the extension profile; this is not a separate vault per container.

The HTTPS host scope lets compatible DApps discover the provider at page start. It does not grant an account: connection, message signing and transaction submission have separate approval gates. `activeTab` and `scripting` are limited to the user-selected HTTPS page when repairing provider injection. Full explanations and data recipients are in `permissions-data-map.md` and the privacy drafts.

## Visual assets

Run `npm run store:assets` after installing dependencies. The generator rebuilds the Chromium extension, loads it temporarily in an isolated Microsoft Edge profile, leaves a neutral HTTPS page active, and captures the actual extension UI in English and Simplified Chinese. It creates no wallet account, uses no credential and submits no transaction. `npm run verify:store` enforces every image dimension, byte count and SHA-256 plus manifest, listing, permission and truth-boundary invariants.

The kit includes the Chrome 128 × 128 icon, Chrome 440 × 280 small promotional tile, Edge 300 × 300 logo and two 1280 × 800 screenshots. These meet the documented current image dimensions. [Chrome images](https://developer.chrome.com/docs/webstore/images), [Edge publishing](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)

## Public download boundary

`artifact-manifest.json` remains the receipt for the three currently published unsigned `0.1.1` downloads built from `c93e16be81beddc957ef5f27b7bbcdfa89c28db3`. `npm run test:public-artifacts` reads that manifest and the product download matrix, then downloads all three official URLs and checks exact bytes and SHA-256. The Firefox runtime evidence is also bound to that public Firefox tuple. A new candidate package is written to a separate manifest by setting `YNX_WALLET_WEB_ARTIFACT_MANIFEST`; preparation never rewrites public history.

Public hosting does not make the packages production-signed or store-released. The store documents and automated gate require `productionSigned=false` and `storeReleased=false` until external receipts exist.

## Reviewer source

`export-reviewer-source.mjs` exports only committed Wallet Web, Wallet/Auth and required integration source from an immutable commit. It embeds the complete verified build-authority archive and normal-build output hashes. `rebuild-reviewer-source.mjs` works without `.git`, verifies every submitted source byte and authority record, rebuilds all variants, and requires every generated output byte to match. See `submission-build.md` for the exact commands and environment.

## Inputs still required from the publisher

1. Legal publisher/account owner, applicable trader status, intended markets, and authorized Chrome Web Store, Edge Add-ons and AMO accounts.
2. Ownership confirmation for the Firefox ID `wallet-testnet@ynxweb4.com`, available store version/identity inventory, and production signing credentials held outside this repository.
3. Verified support URL or email and an approved HTTPS privacy-policy URL under a controlled domain.
4. Confirmed legal operators/processors for RPC, website and explorer services, including hosting regions, IP/request-log retention, access and deletion procedures.
5. Legal approval of the localized listing, privacy policy, store data-use declarations and Chrome Limited Use / applicable Edge and Mozilla attestations.
6. Separate authorization to upload, sign, submit and publish, followed by the stores' signing, review and release receipts.

Until those inputs and receipts exist, the listing placeholders must remain visible and `submitted`, `publisherVerified`, `privacyPolicyPublished`, `productionSigned` and `storeReleased` must remain false.

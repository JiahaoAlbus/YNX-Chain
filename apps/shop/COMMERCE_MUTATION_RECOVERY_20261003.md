# Commerce original request recovery

Continues the original `63-shop-connect-state` checkout at baseline `65d7e473f6198c524f56c21c88fdfb51b4545036`. The prior Buyer Android and Apple/Web deliveries and their complete archives remain intact.

## User behavior

Seller and Merchant normal forms offer **Check original request**. Enter the original inputs after a cold reopen. Checking never creates a new intent or sends a replacement. Normal submit dispatches a prepared intent only after the current private proof is admitted and the opaque unknown marker is durably saved. An unknown intent uses readback only. Changed inputs for a pending target are refused. A new account, store/merchant, view, or private generation cannot adopt a late response.

Seller uses an opaque actor/method/path namespace and stores only digest, key, and prepared/unknown phase. Merchant preserves its original two-field v1 digest/key record and adds a phase sidecar. Old Merchant records without a sidecar are treated as unknown. Web Locks serialize pages. Missing locks, unavailable storage, malformed original data, and failed cleanup fail closed and retain original evidence. No private inputs, account, grant, token, or signing keys are stored in these journals.

## Original backend readback

- `POST /api/seller/mutations/lookup`: current fixed Seller two-scope action, current original operation permission, original actor/route/key/typed-input hash and target. Reads current committed store/product/inventory/fulfillment/return/rejected-refund/provider result from the original Store. No mutation helper, provider, or idempotency creation. Sensitive refund approval and dispute dispatch remain outside this readback.
- `POST /v1/merchant/mutations/lookup`: fresh canonical Merchant carrier and current membership, current original operation permission, exact original wire digest and atomic original account binding in the existing idempotency record. Supports catalog, invoice, recurring draft and webhook replay. It never invokes Pay or webhook delivery. Invoice recovery requires the original committed invoice; provider reservation/admission alone is insufficient.

New Merchant committed records include optional original account/body digest fields, written atomically with the existing result. Legacy unbound records remain unresolved; they are not relabeled, deleted or inferred from a snapshot. Store seals, old keys, identity mappings and original idempotency keys are preserved. Fresh readback consumes a new action nonce through the existing protected product wrapper. The integration contract lists both implemented fixed routes; A must mount them with the existing current protected adapters. No shared SDK, registry, Host, signer, Pay protocol, device or production service was changed.

## Validation and limits

The isolated source stage uses the previously qualified complete 641 dependency tree, without changing product package/vendor files. Seller 46 and Merchant 58 Node checks pass; both Web builds pass. Four controlled Chromium checks exercise these actual source controllers with real browser localStorage and Web Locks, covering cold reopen and concurrent pages for each role. They do not mint private authority or prove formal Browser qualification.

Targeted Go race checks cover original actor/cold Store isolation, unchanged inventory/order state, original later-order readback, Buyer/Seller separation, canonical current carrier/member/revocation fences, unknown provider reservation and original signing/idempotency. The invoice test initially failed because its controlled Pay fixture lacked original merchant fields; those fields were corrected and only that test rerun. Its accepted result verifies no additional Pay call on confirmed or missing readback. A separate recurring test verifies current role downgrade denial. Raw attempts and accepted coverage are recorded separately in the receipt.

Full Xcode was not found in the listed application/download/desktop/volume locations or Spotlight index. Global developer directory remains CommandLineTools. No installation or global xcode-select change was made. Full SwiftUI app compilation remains unverified. Exact approved iOS tuple/SDK/platform handling, integrated Wallet invoice URI/return handling, Merchant/Seller formal Browser qualification, final packages, installation, real-device approval, public business flow and user acceptance remain open. This is owned source delivery, not whole-goal completion.

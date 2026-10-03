# Buyer Android original-order journey

This source batch continues the original Shop MainActivity, encrypted SecureStore, NativeProductState, NativeSessionBridge and approved Native188 SDK artifact. It does not create a new account vault, alias, signing protocol or payment executor.

The catalog and original server cart lead to checkout with the original cart revision and durable idempotency key. Current Native private authority prepares the exact request proof before recording dispatch as unknown. A lost response or an old queued checkout is recovered only with the original intent lookup. It cannot rotate the original key or automatically POST another order.

An explicit user action prepares the original invoice handoff once. Already bound invoices and unknown handoff results use GET /api/orders/{id}/pay-handoff. This route reads only an existing durable invoice and never calls the provider. The original encrypted handoff key remains preserved. The dialog displays the original order amount and invoice reference before opening the existing backend ynxpay://invoice/{id} reference. Opening Wallet is not payment approval or settlement.

Return, resume and cold reopen use fresh current private proof to GET the original owned order. An exact ynxshop://orders wake hint supplies no account, order, payment assertion or execution input. The explicit check-payment action invokes the existing confirm-payment observation route. Paid presentation requires the original backend settlement matching invoice, intent, merchant, payout, payer, currency, integer amount, block and transaction hash.

The service keeps canonical stored Buyer unchanged and emits WalletBuyer only when the authenticated buyer response already names that same original actor. This response hint is never an authorization input. NewCommerceNativeBuyerV2Server composes the original actor fence with the approved Shop Android/macOS tuple and the matching protected private backend role; it does not borrow a Browser identity.

Native188 input package and provenance are retained in ../evidence/android-buyer-journey-20261003. The approved Shop registry entry and original SDK bundle are unchanged; the complete registry bytes are copied exactly from A's current approved package. Constructors and Gateway adapter come from the same artifact instance, with the application's fixed official Gateway and original transport checks.

Remaining qualification: A must confirm the current merged Wallet invoice URI/handler and return contract, current Host/backend actor composition and registration. No installation, real OS callback, signing/PIN, public business operation, real payment or final distributed entry has been verified by these software checks. Existing unknown native transition queue entries remain retained pending original receipt qualification. Merchant and separate Seller Browser qualification remains HOLD. This batch does not establish Android/macOS/Web ecosystem completion.

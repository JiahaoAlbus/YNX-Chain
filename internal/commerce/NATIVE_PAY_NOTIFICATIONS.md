# Original Native Pay notification receiver

`POST /api/pay/notifications/native` is mounted on the existing Shop service and
fixed `shop-api.ynxweb4.com` Native API. It authenticates the original Pay
`YNX_PAY_WEBHOOK_V1` HMAC domain independently of Buyer actions. The original
host supplies `ServerConfig.NativePayNotificationReceivers` with the actual Pay
merchant ID, Shop Store, current secret version and secret. These are copied at
construction, never read from callback JSON, ENV or a default credential. The
normal daemon can receive them via an explicitly selected absolute private file:
`--native-api --native-pay-notification-receivers /private/receivers.json`. Its
version is `ynx.shop.native-pay-notification-receivers/v1`, and `receivers` has
`merchantId`, `storeId`, positive `secretVersion` and lowercase `secretHex` for
the actual existing Pay merchant secret. The loader bounds the file/rows, rejects
nonregular or symlink files, public file permissions, swapped inodes, unknown
fields, duplicate merchant registrations and weak/noncanonical secrets. It reads
no production credential unless that explicit file is supplied. This is a
notification credential, never Root, funds or Source configuration. Missing
or ambiguous registration refuses503. No Root, account, asset key, Buyer session,
Pay Source, signature approval or financial authority is supplied by this config.

The receiver checks one copy of every original header, exact bounded JSON,
SHA256, root `whd_` event/delivery ID, current key version and constant-time HMAC.
An attempt timestamp may be at most five minutes old or thirty seconds ahead.
`occurredAt` remains the original event time and may be old: it is not the retry
freshness clock. P06's per-attempt signature successor can redeliver the same
original event/body under a fresh timestamp or current key. There is no receiver
retry of a Pay mutation and no signature from Shop.

The original Store snapshot v18 retains the immutable payload/hash, event,
merchant/Store, nativeHash and first receipt time. Duplicate delivery does not
replace these bytes. Same event plus changed payload or Store conflicts. Capacity
is bounded10000 and full/disk failures refuse acknowledgement without eviction.
An older schema or backup cannot silently discard this original inbox. HTTP202
means only durable notification receipt; response always says `fundsVerified:false`.
It does not mean payment, refund, shipment or goods receipt.

Original four-field Native notifications remain notification-only hints. The
actual P06 successor may add optional `nativeInvoice` DATA with version
`ynx.pay.native.webhook-reference/v1`, genesis/nativeChainId, merchant/invoiceId,
sessionId/sourceOrder, nativeHash/abciHash and eventClaim. Its original order,
Store, invoice and merchant must match the retained Shop binding. It supplies no
amount or authority. The full reference is compared again against the independently
accepted original receipt before recording an observation; a changed session,
chain, claim or transaction cannot acknowledge that hint. No Shop scan or guessed
order is used to resolve a reference.

Financial consumption remains the existing protected Buyer action
`POST /api/orders/{id}/confirm-payment` -> `nativePaymentReceiptEffect` -> one
qualified Pay `GET /v5/pay/products/shop.order/{order}/invoices/{merchant}/{invoice}/archive-reconciliation`
-> original validation -> `applyNativePaymentReceipt`. That existing Source,
current authorization, frozen bill/session, unique event claims and cumulative
refund rules all remain mandatory. Only this consumer marks matching inbox hints
`ObservedOrderID`; the marker is atomic with accepted state, or a read-only
unchanged receipt observation. A failed commit keeps the same original hint
pending. Callback JSON cannot invoke the consumer, replace a nonce, repeat a
Member or manufacture funds/goods/restock. Normal clients retain their existing
explicit original payment-check action and independent order readback. A private
background receipt reader is not invented from the webhook secret or Auth's
pending-pair/query/revoke/cancel purpose.

Tests use PUBLIC original Pay/Source controls on the actual normal Shop handlers
and Store, including cold reopen, concurrent duplicates, stale versus fresh retry,
key-version mismatch, tampered headers/body, native reference rebinding, disk
failure and older backup refusal. They do not establish configured production
merchant credentials, actual protected Source admission, installed business flow,
formal publisher installation, public deployment or real funds.

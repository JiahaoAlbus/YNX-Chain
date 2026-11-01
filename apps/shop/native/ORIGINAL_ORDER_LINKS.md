# Shop original order entry for the original Main/Wallet owner

Shop product ID: `shop`; client ID: `ynx-shop-v1`; application/package/bundle:
`com.ynxweb4.shop`. Source, code tests, platform packages, genuine Root admission,
installed protected business acceptance, and public deployment remain separate.
This entry adds no Wallet UI, session issuer, signing, payment or authorization.

## Supported original entries

- `ynxshop://wallet-auth/callback`: existing original registered Native session
  callback only, still validated by the adopted Native SDK. It is not an order
  link, receipt, signature approval or arbitrary callback transport.
- `ynxshop://orders`: existing wake hint; reads the original current account's
  locally retained review, if any. It does not name/import an order or create
  a local review when none exists.
- `ynxshop://orders/{originalOrderID}?account={originalYNXAccount}&chainId=ynx_6423-1`:
  new original owned-order read entry on iOS/macOS and Android. Exact lower-case
  scheme/host, exactly these query fields in this order, no fragment, userinfo,
  port, trailing slash, duplicate field, encoded alias or additional parameter.
  Order ID is `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Account is the canonical
  `ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}` public account selector. Literal
  colon is supported in the order ID; `%3A` is not this client's canonical URI.
  Total URI is bounded to 512 bytes. The URI is navigation DATA, never authority.

Example shape (not a supplied customer account or paid-order assertion):
`ynxshop://orders/order_original?account=ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq&chainId=ynx_6423-1`.
Use the actual original owned order and account after normal Main selection.
Do not add amount, paid/refund status, signature/capsule, API URL, nonce,
idempotency key or a serialized private queue to this link.

## Actual authorized readback

The normal native entry waits for its existing initial Native session restore,
then requires a live original verified Native Buyer session for the exact link
account. The actual adopted session constructor already binds
`chainId=ynx_6423-1`; another network or a legacy token cannot select this entry.
A signed-out entry asks for the normal Wallet connection and sends no private
request. It does not automatically initiate a Wallet approval or mint a session.

The entry signs only `GET /api/orders/{originalOrderID}` using the existing
Native V2 identity/action proof headers and original scope policy
`account:read`, `shop:orders:write`, `shop:profile:write`. No bearer fallback,
new service origin, injected source, default transport or public proxy is added.
The existing actual service independently selects the owned order from its
original Store. The response must retain this exact order ID and match the
current account (original Buyer or the existing authenticated WalletBuyer
projection). Native paid/refund states require their separate original
NativePayment projection; legacy Settlement is not manufactured from Native
amounts. These client checks describe authenticated product DATA; cryptographic
receipt verification remains on the existing normal Pay/Shop path.

A cold or foreign device needs no local payment review to read this existing
order. The entry does not synthesize a local review or acknowledge any prior
UNKNOWN. Account/generation replacement, source withdrawal, target replacement,
view dismissal or backgrounding retires presentation; an old response cannot
replace the current original order. Refresh repeats only the same authorized
GET. A failed/missing read presents unavailable, with no new order/intent.

## Existing unknown/recovery and payment interfaces

- Existing original order read: `GET /api/orders/{id}` as above.
- Existing original Native intent observation:
  `GET /api/orders/{id}/native-pay-intent`, no money/finality assertion.
- Existing original Native preparation recovery:
  `POST /api/orders/{id}/native-pay-intent-lookup` with the exact original
  retained `IdempotencyKey`. This reads the captured original request; a link
  cannot replace the key, reconstruct it, or authorize a create/replay.
- Existing buyer transition recovery:
  `POST /api/orders/{id}/transition-intent-lookup` with the original retained
  request/key. UNKNOWN stays UNKNOWN unless the exact matching authoritative
  result is returned; this deep-link entry never invokes it automatically.
- Deliberate user payment-status check remains existing signed
  `POST /api/orders/{id}/confirm-payment`; Shop selects the original Native
  verified receipt GET on its original qualified Pay client. No payment/refund
  POST is made. A deep link never invokes this action automatically.

Original Main/Wallet UI ownership stays with P01. Main may offer the supported
Shop order URI as an explicit navigation action after its own normal selection;
it must not treat navigation dispatch, the OS open confirmation, HTTP 200,
PREPARED/ISSUED, local cache or product DATA as paid/finality/Root proof.

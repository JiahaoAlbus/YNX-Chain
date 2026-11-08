# Original Shop session business producer

The normal entry is the existing `commerceV2Verifier.verify` and
`business_http.go` wrapper: accepted `Client.Authorize`, exact HTTP action,
original actor fence, and fresh backend revalidation. The private verified
request, not an exported Session struct or JSON, carries the issuer fingerprint.

`observeOriginalShopSession` records that original authorization in the same
Store's schema19 inventory. It stores only hashed session/account/actor identity,
original expiry, role, membership fingerprint and a durable monotonic generation.
It neither signs nor issues a session. Re-observing the same binding cannot
renew expiry, change identity or resurrect a tombstone. A changed original
binding receives a new generation; Source epoch is never a session generation.

The qualified original **server** read-service profile binds the Store's private
realm/tenant comparison domain. This profile supplies no session/role authority.
An unbound or retired private deployment cannot capture a session. Ordinary
already authorized API operations continue; Seller onboarding creates no held
Seller session until actual Store membership exists. Seller permissions come
from existing SellerRoles, and per-order checks use the existing Store.Order ACL.
Buyer grants never become Seller membership.

The same-process Go producer is `Store.CaptureOriginalShopSession(ctx)`. Its ctx
must be the normal private verified request context; there is no public context
key, Session constructor, actor lookup factory, or JSON registration route.
The returned `OriginalShopSession` supports:

- `Current(ctx)`: fresh original Auth backend and qualified Source current,
  original actor fence, exact inventory generation and current Store membership.
- `CurrentLocal()`: **only** atomic local retirement and fixed monotonic TTL;
  no IPC/FD/NAPI and no claim of instantaneous remote revocation.
- `CurrentOrder(ctx, "shop.order", orderID)`: current session plus the existing
  exact original buyer/Seller order ACL, independent of Source order admission.
- `DATA(ctx)`: copied comparison metadata, never a constructor or authority.
- `Retire()`: synchronous local invalidation and cancellation of the original
  operation; no global logout on an ordinary loan release.
- `Revoke(ctx)`: explicit retirement of this previously authenticated exact
  inventory row, including after original actor retirement. No identity input.
- `Close()` / `PhysicalClosed()`: first error and physical completion are
  independent. Active operations retain the original parent. A nonnull partial
  from acquisition must be adopted before interpreting its error.

Successful existing Store commits retire changed Seller-membership/expired
inventory rows and local borrowers before returning. Failed persistence restores
inventory and does not claim committed revocation. Privacy deletion revokes only
that actor's rows. Recovery backups and older-schema export cannot erase session
retirement/generation. Domain shutdown retires and drains its exact children
before Source close; the borrowed Store is never closed or reopened.

## Consumer integration boundary

Root approved reusing the existing accepted-v2 signed introspection proof on the
original fixed, empty-body Source GET. The normal private Server registers its
actual existing v2 verifier internally. No caller can register an arbitrary
provider. The private Source service verifies that original proof, records the
accepted authorization, captures the original inventory hold and rechecks
current/order ownership before and after the unchanged eleven-field read.
Ordinary HTTP action routes still require their exact separate action proofs;
this special private-read mode is never added to the public router or business
effect/nonce path. Source/current and authenticated same-socket caller remain
independent AND conditions.

The initiating signed proof also bounds the finite capture. Its already verified
expiry is converted at request entry to a fixed monotonic deadline; subsequent
backend awaits do not renew it. The durable inventory retains the original Auth
session expiry, while a copied child cannot outlive its original finite proof.
A new accepted proof can capture a new finite child for the same unchanged
session generation, never resurrect a retired inventory row.

A Go pointer is not a cross-process Main session. Sole SDK owns the closed typed
carrier for the one existing proof header, original LINK owns same-request and
same-socket kernel peer/close transport, and Auth owns proof generation,
verification/NAPI from the actual authenticated session. Their actual native
producer must be consumed; no Source constraints/JSON or Main guard can create
an inventory/session. Main consumes genuine holds and retires them immediately.
No new scope, bearer, public route, arbitrary header map or second protocol is
introduced.

The original Auth-owned shared Go successor is consumed byte-for-byte. Its
normal backend Revalidator and HTTP action payload3 successor is also consumed
exactly from that same owner; Shop does not widen versions, copy crypto or
ignore accountAuthorization. Controlled/PUBLIC tests are not genuine Root,
ShopSession commissioning, installation, payment or product release evidence.

The original LINK complete source closure at `85fdcec58` is consumed exactly,
including the sole fixed proof carrier and immutable request snapshot. Its
normal CI is `42445390661`; no binary archive is hot-swapped. The private Shop
server explicitly selects a 64 KiB total header budget so the sole 16 KiB proof
carrier fits with the existing fixed LINK metadata. Root admission and actual
protected native holder commissioning remain separate from this source intake.

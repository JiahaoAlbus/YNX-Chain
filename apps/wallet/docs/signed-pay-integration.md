# Signed Pay integration boundaries

This is owned source implementation, not an installed/public Pay acceptance.
The normal invoice entry now selects the signed Review → explicit Approve and
original recovery/receipt view when A supplies a protected integration through
`createProtectedPayWalletApp`. The default no-argument App remains on the legacy
reference projection: launch props, QR data and globals cannot enable this port.
A must deliver its protected signer policy, registered canonical authority and
authenticated settlement adapter and adopt that factory in its real bootstrap.
There is no default authority, QR key trust, fixture adapter or new registration.

## Current owned pipeline

- `WalletPayInvoiceClient.signedInvoice` reads the original
  `/app/pay-product/v1/invoices/{inv_20hex}` wire with the existing bounded HTTPS
  transport. It requires an independent protected merchant policy before HTTP.
- `verifyWalletPayQuote` binds the original signed V1–V5 invoice and exact SDK
  intent. Its three authorization/session/settlement flags remain false.
- `prepareSignedPayTransfer` consumes the already-verified full authority lease,
  exact visible intent digest and existing Wallet operation lease. It narrows
  the original protected `prepareNativeTransfer` path: one native authorization,
  one protected key read, original nonce/balance/durability checks, transfer and
  public payment-result signatures. No key is returned, copied to a new vault,
  or persisted in the Pay record.
- `WalletSignedPayFlow.payReviewed` uses the original storage and native outbox.
  It saves/reads back immutable invoice, intent, public result, original transfer
  and full captured session before native dispatch. Original outbox bytes and
  conservative unknown marker are read back, and the canonical authority is
  refreshed after the last storage await and immediately before POST.
- Historical record reads verify the original signatures at the original result
  time, not today's quote expiry. An expired quote never erases an unknown
  transaction or permits a replacement. The captured session is retained context,
  not live session authorization.
- `checkOriginal` uses the original hash only. If the original native journal is
  missing after a storage interruption, an explicit check can restore the exact
  retained public bytes as uncertain, then query them. No new signature/nonce,
  replay POST or replacement is generated. A conflicting journal is never
  overwritten. Acknowledged original history is reverified before reuse.
- Legacy Pay records remain in their old namespace and schema. Signed records
  use `ynx.wallet.pay-signed-binding.v2.` in the same original storage, not a
  second account/key database. Presence of even corrupt signed metadata blocks
  ordinary new transfer/Done and unbound generic retry. Original hash checking
  remains possible. Neither contract overwrites the other's records.
- Explicit settlement submits only the retained original intent/result with a
  stable idempotency key, after unknown-marker readback and fresh full authority.
  It never creates another native transfer. Authenticated responses must bind the
  original full invoice, actor, digest, nonce, hash and exact settlement evidence.
- Archive/readback, paid-invoice marker and linked receipt-history publication
  precede native journal release. Interrupted cleanup resumes from the immutable
  archive. Native payment and settlement block numbers need not be equal; neither
  a local checkpoint nor a business receipt proves consensus finality.
- The shared Android/iOS modal shows the immutable invoice, recipient, fee/total,
  full session expiry and digest before a separate approval. Opening and reading
  never pay or settle. Lock/account/background/close invalidate stale callbacks;
  receipt recovery, submission and final local archive remain explicit actions.

## Authority port requirements

`WalletPayAuthorityLease` is supplied exclusively by A's protected canonical
adapter. `session` must be the complete, authority-verified actor/device/origin
session. `refresh` must re-introspect that exact session against current
registration, revocation and full expiry. `assertCurrent` must synchronously
fence actor/account/device/transport invalidation and stale callbacks. Parsing a
session object, copying an account string, identity-only consent or a legacy
bearer token is not an implementation of this port.

The owned code accepts only the current Pay product/client/application/origin
and callback, the existing three scopes, and a session lifetime at most 180s.
The reviewed quote must fit the full original session lifetime and invoice
lifetime. It never clamps a substituted quote or silently replaces a session.
Disabled/pending-review registration must be rejected by the authority adapter;
local field validation cannot enable it.

The same authority adapter must also implement `verifyInvoicePayable` against
the canonical business service/reservation for this actor, intent digest and
request ID. Session validity and merchant signatures alone cannot establish that
an invoice has not already been paid on another device. This capability is
mandatory before native authorization, again after key read and immediately
before dispatch. Unsigned `status` from public invoice GET is not a substitute.
The server's exact matching atomic business/reservation contract remains A-owned;
the internal port above does not invent an HTTP path, token or grant.

V4/V5 expected payer restriction uses the original Pay53eb domain/order:
`SHA256("YNX_PAY_EXPECTED_PAYER_V1|" + canonicalNativeAccount)`. A mismatch blocks
authorization. Matching that hash is not account-session authority.

## Remaining complete-product work

Adopt the protected factory in the actual A bootstrap with real adapter/policy
and authenticated canonical settlement transport; implement corresponding
Desktop protected-key/outbox consumer behavior without replacing custody.
Preserve original intent/result on any unknown settlement and archive only after
matching authenticated business receipt and native durability verification.
The original Pay backend nonce/effect atomicity and route/current registration
integration are A-owned gaps, not solved by mounting the old service.

Controlled protocol tests do not prove real biometrics, a real Pay session,
backend settlement, public runtime, official upgrade/install, cross-device
acceptance, consensus finality or MONSTER. Keep these gates separate.

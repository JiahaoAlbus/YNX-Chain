# Shop consumer of P06 Native Pay

`NativeShopPayClient` consumes the eight fixed product routes from P06 source
`1ce6c496d416fcb34def07911f87a8bf76b279a2`. It requires an explicitly supplied
original service HTTP transport and one HTTPS origin. It carries exact atom
strings and original Member bytes, preserves request/response bytes for the
existing business-effect journal, refuses redirects and never retries a send.
`Reconcile` calls only the original hash route; it never falls back to broadcast.

This is the product transport adapter, not an enabled Shop payment controller.
It does not register a merchant, select a Source, produce an approval or Member,
decode a CORE funds proof, apply paid/refunded balances, or restock inventory.
Successful HTTP exchange means a response was received, including a possible
`unknown` operation; it does not establish finality. A failed mutating exchange
returns the original request and `Uncertain=true`, including HTTP rejection.

The normal controller must use the existing signed Shop BusinessEffects flow
and durable original selection. It still needs the actual protected
`ProductMerchantID <-> StoreID <-> merchant account` mapping, approved original
order/price/payer, original Native signing approval, and P06's independently
verified same-invoice cumulative payment/refund evidence. Those cannot be
inferred from legacy invoice IDs, payout address equality or a client response.
Until supplied, existing order state and separate physical return inventory
remain unchanged. No new production payment route is mounted by this adapter.

Affected tests cover the fixed routes and exact source order/Member/uint64 atom
serialization, lost-response retention without retry, redirects, unusable
responses, transport absence and invalid locators. These are PUBLIC product
contract tests, not a live Source, Native signature or funds integration test.

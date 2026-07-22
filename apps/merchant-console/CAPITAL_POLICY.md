# Capital and settlement evidence policy

`GET /v1/merchant/capital` is read-only. There is no Merchant Console API route that transfers funds, changes payout destination, allocates treasury assets, moves reserves, applies for credit or initiates a stablecoin/bridge action.

The `capital-v1` response discloses Provider, cost, risk, term and non-guarantee language for every capital capability. Unsupported services are explicitly `unavailable`; conditional proof services require matching authoritative central Pay evidence.

The settlement waterfall distinguishes Gross Payment, Refund Reserve, Dispute Reserve, Network Fee, Provider Cost, Protocol Fee, Burn, Treasury/Insurance Allocation and Merchant Net. Unknown values serialize as `amount: null` with `status: unavailable` and `source: no-authoritative-record`. They are never coerced to zero. Merchant Net therefore remains unavailable until every required authoritative component is recorded.

Gross payment is not revenue. Burn is not revenue. Missing cost is not profit. AI cannot change these records or execute an action.

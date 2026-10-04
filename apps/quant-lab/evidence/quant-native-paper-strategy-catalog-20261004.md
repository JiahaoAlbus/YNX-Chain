# Native Paper strategy catalog continuation

Owner predecessor: `fa75ecf7877c9fdc4d9b07a5bcd0c7664bd61f7a`.

The native reader now requests `history=bounded_v2`. This adds the saved strategy catalog to the existing 20-record window and durable revision fence. Counts include `strategies`; the next-page decision considers all four record sets. Strategy ordering is saved CreatedAt descending with ID as a deterministic tie-break. Full original strategy records remain persisted and the v1/legacy routes remain compatible. A single oversized record still fails the existing decoded 2 MiB budget rather than being truncated or fabricated.

The UI identifies the catalog as this page, shows shown/total and offset, and keeps existing previous/next controls. Selection only uses the current owner-bound page. Original preview/confirmation gates still reject a strategy absent from the current snapshot. The independent read-only UNKNOWN receipt recovery does not need to replay an order or locate its strategy on the current page. No scheduler, capital execution, Wallet scope or shared SDK change.

Local regression covers 43 persisted strategies, all three pages, deterministic equal-timestamp records, second Service startup, unchanged strategy hashes, exact counts, stale revision rejection and retained v1 behavior. Consumer tests reject contradictory catalog counts/cardinality. Controlled browser private-session fixtures exercise v2 requests and paging; they are not real Wallet approval evidence.

Public deployment, installed runtime, real account approval, signatures, on-chain transactions and ComputerControl remain NOT_VERIFIED. Formal publishing belongs to the existing release owner; this local source change does not authorize Host activity.

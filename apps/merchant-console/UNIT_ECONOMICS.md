# Unit economics and fee transparency

The current Merchant Console records a fixed 1 YNXT network fee on its signed Testnet invoice. It does not yet have sufficient provider billing evidence to publish currency-denominated operating margins.

For every future settlement the API and UI must expose this versioned waterfall from authoritative records:

`gross payment - refund reserve - dispute reserve - network fee - provider cost - disclosed protocol fee - burn - treasury/insurance allocation = merchant net`

No absent value may be inferred as zero; unknown provider cost or allocation makes the margin `unavailable`. Revenue is recognized only from an explicit, user-accepted fee record, never from payment volume, unrealized PnL, hidden spread, mint/burn, or reserve movement.

Before launch, measure per active merchant: storage bytes, API requests, webhook attempts, provider calls, compute time, support minutes and retained audit data. Record official provider price/version/currency/jurisdiction and free-tier limits. Subsidy, subscription, fee-share, management fee and high-water-mark fee remain disabled until their contracts and realized-net-PnL evidence are implemented and reviewed.

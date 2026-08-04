# PnL and fee attribution

Every completed experiment emits a reconciliation ledger denominated in
`YUSD_TEST_MICRO`. Net PnL reconciles two ways:

`alpha + beta + carry + rebates/LP fee - trading fee - gas - slippage - MEV - oracle drift - compute/data fee - management/performance fee = user net PnL`

`user realized PnL + user unrealized PnL = user net PnL`

The current market tape supplies price/volume only. Trading fee and slippage are
calculated from explicit assumptions. Unsupported carry/funding, maker rebate/LP
fee, gas, MEV, oracle drift, compute/data fee, and management/performance fee are
zero and listed in `unsupportedComponents`; zero is not evidence that real costs
would be zero. Average idle capital is reported separately and is not treated as
revenue or profit.

User gains and losses belong to the user. Self-managed strategies charge no
default performance fee. A managed-vault performance fee requires separate
prior consent and applies only to realized net profit after all costs using a
high-water mark and loss carry-forward. No managed-vault fee runtime is currently
implemented.

# YNX DEX Testnet user guide

YNX DEX is a separate non-custodial Testnet product. YNX Exchange is an operator/custody/order-book product; DEX pools and swaps are Wallet-signed on-chain actions.

1. Confirm `YNX Testnet · chain 6423` and connect through Sign in with YNX Wallet. Never type a recovery key into the DEX.
2. Choose supported tokens. A quote is usable only while its indexed pool state is fresh.
3. Review input/output, route and every pool, 0.30% pool fee, protocol share, price impact, minimum received or maximum input, slippage, deadline, gas estimate, token warnings and contract addresses.
4. Continue to YNX Wallet. The DEX prepares a request; Wallet owns approval and signing. Rejection, expiry, replay, wrong network or tamper must stop execution.
5. Track submitted, committed or failed state using the real Testnet transaction hash. A submission is not finality.

The optional AI risk explanation sends only context fields you select and requires one-request permission. Review, apply to the local explanation panel or reject it; it never changes the quote or transaction and cannot approve, sign or submit. Provider unavailable, rate limit, timeout, empty output, cancel or interrupted streams show an error rather than a canned answer. Its local hash-chained audit is explanatory evidence, not financial advice.

Slippage and deadlines limit execution but do not eliminate sandwiching, adverse selection or other MEV. Unsupported, rebasing, fee-on-transfer and unreviewed tokens must remain unavailable. Current public deployment and real-pool proof are absent.

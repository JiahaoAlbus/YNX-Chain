# Governance

`strategy-mandate.schema.json` publishes the version-1 owner-authorized Quant/strategy boundary. Its local native-module candidate binds engine identity, strategy hash/version, venue, asset, market, method, capital, position, leverage, slippage, daily loss, drawdown, validity, nonce domain, revocation, and kill switch. Engines cannot change the owner or withdraw.

The candidate is implemented and tested locally but is not committed into active ABCI state or deployed publicly.

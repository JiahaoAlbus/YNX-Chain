# Capital and mandate design

Capital is a review and authorization surface, not a promise of yield or price. Native staking, liquid staking candidate, Safety Module, Service Security Pool, LP/Vault, portfolio margin, stablecoin/reserve/redemption, bridge route, solver auction, protocol-owned liquidity and Treasury multisig must supply the strict review schema in `packages/wallet-auth/src/mandate.js`.

Every review exposes provider, contract, governance, yield source, historical range, explicit non-guarantee, fees, lock/cooldown, slashing, drawdown, withdrawal delay, reserve ratio, risk, immediate exit and revoke URLs with source/as-of/version. Missing data is unavailable, never zero or healthy by default.

Quant mandates bind strategy name/hash/version, engine commit/release, product session, exact venue/assets/markets/methods/contracts and capital/position/leverage/order/slippage/gas/frequency/loss/drawdown limits. Exchange authorization is no-withdraw and subaccount-only. DEX authorization requires exact vault/router selectors and forbids arbitrary transfer, owner change and unlimited approval. Performance fees require a high-water mark and loss carry-forward. User net PnL remains the user's unless a separately approved managed-vault agreement applies.

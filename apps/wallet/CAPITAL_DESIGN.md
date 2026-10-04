# Capital and mandate design

Capital is a review and authorization surface, not a promise of yield or price. Native staking, liquid staking candidate, Safety Module, Service Security Pool, LP/Vault, portfolio margin, stablecoin/reserve/redemption, bridge route, solver auction, protocol-owned liquidity and Treasury multisig must supply the strict review schema in `packages/wallet-auth/src/mandate.js`.

The native Wallet now exposes a localized Smart Account & Capital sheet backed only by `__YNX_WALLET_CONTROL_RUNTIME__.snapshot`. It renders verified review records as native expandable list rows and a Risk Inspector; missing products remain an explicit unavailable list. No position, return, health state, gas sponsorship or exit success is synthesized. Smart Account readiness requires fresh (five-minute) chain 6423 evidence, EntryPoint support and Bundler health, while capital evidence older than 24 hours is visibly stale.

The current schema covers native staking, liquid staking candidate, withdrawal queue, Safety Module, Service Security Pool, LP, Vault, trading subaccount, API Wallet, portfolio margin, stablecoin, cross-chain route, solver auction, protocol-owned liquidity and Treasury multisig. The previous `bridge-route` value stays parseable for old clients; new Wallet snapshots use `cross-chain-route`.

Every review exposes provider, contract, governance, yield source, historical range, explicit non-guarantee, fees, lock/cooldown, slashing, drawdown, withdrawal delay, reserve ratio, risk, immediate exit and revoke URLs with source/as-of/version. Missing data is unavailable, never zero or healthy by default.

Quant mandates bind strategy name/hash/version, engine commit/release, product session, exact venue/assets/markets/methods/contracts and capital/position/leverage/order/slippage/gas/frequency/loss/drawdown limits. Exchange authorization is no-withdraw and subaccount-only. DEX authorization requires exact vault/router selectors and forbids arbitrary transfer, owner change and unlimited approval. Performance fees require a high-water mark and loss carry-forward. User net PnL remains the user's unless a separately approved managed-vault agreement applies.

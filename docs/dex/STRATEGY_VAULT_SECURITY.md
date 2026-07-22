# YNX Strategy Vault security boundary

`YNXStrategyVault` is a non-upgradeable, per-user Testnet vault. It has one immutable owner, one immutable limited engine, one immutable DEX Router and one owner-reviewed oracle. There is no owner-change method, arbitrary-call method, delegate call, generic token transfer for the engine, or upgrade proxy.

## Authority

- Owner: add an asset, allow or deny a factory pool, configure the mandate, deposit, withdraw, pause, resume, revoke, kill and emergency-exit.
- Engine: call only typed exact-input, exact-output, add-liquidity and remove-liquidity methods. Every output recipient is the vault. The engine may pause but cannot resume, withdraw, change policy, change owner or transfer assets elsewhere.
- Anyone else: read state and events only.

The nonce domain binds the chain ID, vault, owner and engine. Every successful engine action consumes exactly one monotonically increasing nonce. Reverts do not consume a nonce. Revoke and kill are terminal for the deployed vault; the user must deploy a new vault to establish a new authority boundary.

## Fail-closed mandate

Engine actions require an active, unexpired mandate and enforce maximum vault value, maximum action value, gas price, minimum interval, slippage, oracle-relative impact, daily loss, drawdown, oracle age and depeg divergence. Every route token and every factory-resolved pool must be explicitly allowed. Deadlines cannot outlive the mandate.

Token and LP approvals start at zero, are set to the exact action bound and are cleared to zero after success. Fee-on-transfer deposits are rejected by balance-delta equality. Router proceeds and LP positions stay in the vault. Oracle failure, staleness or excessive divergence rejects engine activity, but owner withdrawal and emergency exit do not depend on the oracle.

## Fee invariant

Vault v1 requires `performanceFeeBps=0`, `feeAsset=address(0)` and `feeRecipient=address(0)`. It has no fee-transfer method. This prevents fees on unrealized Oracle-marked gains. `highWaterMark` is used only for drawdown enforcement. A later fee-bearing vault would require a new version, explicit user review and independently verified realized-PnL accounting.

## Known boundaries

- The oracle is a privileged risk dependency selected by the owner. Deployment must verify its code, price unit, supported assets, update authority, heartbeat and depeg semantics.
- Pool LP valuation is delegated to the oracle. Incorrect LP valuation can deny service or weaken value limits; it cannot grant the engine a withdrawal method.
- `emergencyExit` is all-or-nothing. If a malicious token reverts, the owner can still use individual `withdraw` calls for unaffected assets after kill/revoke.
- This local implementation is unaudited and not deployed. Passing tests do not establish public Testnet operation or production safety.

## Execution Adapter semantics

The SDK accepts a strict, source-labelled preflight snapshot for RPC gas, public pool fees, the owner-reviewed oracle and Vault risk observations. It rejects stale observations and any gas price, trade/vault value, slippage, impact, daily loss, drawdown, oracle age or depeg value outside the on-chain mandate. These are preflight checks only; the Vault independently enforces its mandate at execution time.

For `constant-product-v1`, LP fees are embedded in pool reserves. There is no separate LP fee-collect transaction: an LP realizes its proportional value only by removing liquidity. `claimProtocolFees` is separately restricted to the Factory's published `protocolFeeRecipient`. The SDK reports this capability and rejects attempts to build a fake LP collect transaction.

`buildVaultCompoundTx` is only an explicitly sized add-liquidity request. It does not choose assets or amounts. Rebalance planning builds only the first remove-liquidity request; add-liquidity requires confirmed reconciliation, a fresh Vault state and another canonical Wallet approval. The adapter contains no research, strategy selection, capital allocation, signing key, unattended loop or automatic execution.

## Direct test evidence

`npm run dex:vault:test` covers unauthorized calls, nonce replay, exact approval cleanup, assets remaining in the vault, exact-input/output, add/remove liquidity, pause/resume, stale oracle, depeg, frequency, capital, gas, expiry, daily loss, terminal revoke and oracle-independent emergency exit. It also runs 32 deterministic stateful vectors and reports the maximum observed local swap gas without extrapolating production capacity.

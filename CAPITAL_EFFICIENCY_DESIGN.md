# Capital Efficiency Design

YNX capital-efficiency primitives are optional, owner-controlled, auditable Testnet mechanisms. They do not promise profit, peg, liquidity, exit time, or loss protection. Quant engines, AI services, frontends, and service operators never receive a user private key or unrestricted withdrawal capability.

## Strategy mandate

`StrategyMandate` binds the owner, engine identity, strategy hash/version, venues, assets, markets, methods, capital, position, leverage, slippage, daily realized loss, drawdown, validity window, nonce domain, revoke state, and kill-switch state. Sets are canonical and audit-hashed. Authorization checks every field and consumes an exact next nonce. Owner change and withdrawal requests are categorically rejected for an engine, even if another limit would allow them.

An owner may revoke or kill immediately. Expiry is exclusive: an action at the expiry timestamp is invalid. An engine cannot revoke, reactivate, extend, widen, or replace a mandate. New authority requires a new owner-approved mandate with a new hash and nonce domain.

## Strategy vault and exchange boundary

The DEX `StrategyVault` accepts deposits, but normal withdrawal and emergency exit are owner-only. The configured mandate identifies trading authority; it does not grant custody authority. Emergency exit closes the vault, returns the full recorded balance through an audit-bound event, and prevents later deposits or withdrawals.

An exchange integration must use a dedicated subaccount/API credential for trading only, with exchange-side withdrawal disabled. The chain schema cannot prove an external exchange applied that setting, so adapter evidence must include official API capability, account identifier, scope response, test order/cancel, rejected withdrawal, expiry/revocation, and credential-rotation records without exposing the credential.

## Fees

Management fee is time-proportional to average NAV and capped at the explicit annual basis-point rate. Performance fee uses realized gross PnL minus trading, funding, and provider costs. It applies only to cumulative realized net profit above a persistent high-water mark. Losses do not generate a fee or reset the high-water mark; recovery below the previous high-water mark does not generate a second fee. Unsigned overflow and invalid rates fail closed.

## Smart account adoption boundary

UserOperations bind chain, account, product, nonce domain, calls, maximum fee, validity window, session key, and paymaster policy. Owner Ed25519 and passkey-style P-256 signatures are supported locally. Session keys have exact target/method scopes, a separate nonce domain, spend limit, expiry, and immediate owner revocation. Wildcard scopes are forbidden. Paymasters enforce product/call allowlists, per-account/global budgets, expiry, and optional anti-Sybil attestation; sponsorship never grants account authority.

Guardian recovery requires a threshold of Ed25519 guardians and a bounded timelock. Execution rotates the owner key, clears all sessions, advances the recovery epoch, and invalidates old nonce domains. The current code is a native-module candidate and schema/SDK implementation; ABCI persistence, Bundler service, on-chain Paymaster budget, WebAuthn origin/RP verification, public sponsored transaction, and independent audit remain required.

# Wallet/Auth, Smart Account, and Strategy Mandate

Version: 0.1.0-candidate  
Last reviewed: 2026-07-22  
Source commit: `719e1018267ed5a53e6fae5211c5fd8a1503c35c`

## Accepted local authentication boundary

The local App Gateway accepts an exact client binding, a `ynx1` account, a bounded device identifier, and an Ed25519 device public key. It issues a short-lived challenge under domain `YNX_APP_ACCOUNT_OWNERSHIP_V1`, chain ID 6423, origin/bundle binding, nonce, issue/expiry times, account, device, and device key. Session creation requires both secp256k1 account ownership and device signatures over the exact sign bytes. The challenge is single-use. The service stores only a hash of the random session token and binds authentication to exact origin/bundle and device. Expired, revoked, wrong-origin, wrong-device, malformed, or replayed sessions fail closed.

This is implemented local candidate behavior. It is not evidence that every ecosystem product has migrated, that a production Wallet registry exists, or that all clients avoid legacy bearer storage. Product registration, central introspection, multi-device recovery, and public deployment remain integration gates.

## Canonical session contract

Products must use: product registration; device challenge; account and device approval; product-scoped session; authenticated introspection; explicit expiry; and revocation. Browser sessions must use secure server mediation or narrowly scoped ephemeral credentials—not long-lived plaintext tokens. Wildcard scopes and compatibility logins are forbidden.

Every authorization decision binds product ID, bundle/origin, device key, account, requested scopes, issued/expiry time, session status, and policy version. Tests must reject replay, changed sign bytes, wrong product, wrong bundle/origin, wrong device, scope widening, expiry, revocation, and token substitution.

## Smart Account boundary

A future smart account is a user-controlled policy account, not a custodial promise. Its specification must identify owners/guardians, threshold, supported calls, spending and destination limits, time windows, nonce domain, chain ID, upgrade authority, recovery delay, emergency pause, event/audit format, and exit to an owner-controlled address. Modules are deny-by-default and independently removable. No AI or application service may become an unrestricted owner.

Deployment is blocked until exact bytecode, verification, audits, recovery tests, upgrade/rollback controls, and Wallet UX are approved. No current public document may imply that a smart-account contract is live.

## Strategy Mandate

A mandate is an explicit, revocable capability, not custody. It binds:

- owner account and optional strategy vault;
- product, strategy, network, asset allowlist, venue/contract allowlist, and recipient constraints;
- maximum per-action and cumulative value, fee ceiling, slippage/price limits, and leverage prohibition or limit;
- valid-from/expiry, nonce domain, rate limit, and maximum open exposure;
- allowed actions and explicitly forbidden withdrawal, owner change, module installation, arbitrary call, and approval expansion;
- preview hash, user signature, policy version, audit ID, and revocation state.

Execution must compare the exact proposed action with the current mandate immediately before submission. A narrower action may pass; scope widening fails. Revocation and kill-switch state are authoritative even if a queued action was previously simulated. An emergency exit must allow the owner to cancel future authority and recover assets subject to disclosed chain/contract constraints.

## Recovery

Recovery never asks for a seed phrase or private key. Device replacement must require account proof and any approved recovery delay/guardian policy, revoke affected sessions, rotate device keys, and preserve an audit trail. If account control is lost and no approved on-chain recovery exists, YNX cannot truthfully promise restoration.

## Change log

- 0.1.0-candidate: documented implemented local App Gateway facts and future smart-account/mandate gates.

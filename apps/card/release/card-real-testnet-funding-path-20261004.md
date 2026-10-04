# Card real Testnet funding continuity

Current prepared product candidate: `cb8b23ea1f2d8a3f8c8d7fad6f818fd2193efd92` /
tree `18f58a15937f95aa958fe45890041648ce6d1a50`.

## Direct non-sensitive network read

On 2026-10-04T07:11:48Z (15:11:48 Asia/Shanghai), the public fixed
`https://evm.ynxweb4.com` endpoint returned HTTP200 to one read-only
`eth_chainId` request. Response: `0x1917`; JSON43B; SHA256
`5c4a05f13a54a9563933c7daa16938e313e9b35240d6689abc92c1351ebaff79`.
Headers reported `x-ynx-network:testnet` and `x-ynx-truthful-status:ynx-testnet-node`.
No account, signature, balance, intent or transaction was requested. This proves
only this RPC's reported chain identity and availability at the observation time.
It is not Standard Wallet approval, chain trust, funding, host/source admission,
or a browser RPC prerequisite. Receipt verification remains server-side.

## Actual path gap, not a missing commercial sandbox

The new private registered-card action UI currently creates exact
`/api/card/v1/cards/:id/topup-intents` and verifies a supplied hash through
`/api/card/v1/topups`. The legacy page's wallet sending flow instead requests
`/app/card/v1/testnet/topup-intents` and posts to legacy `/topups`. Do not use
these old route buttons as proof the new registered Card intent can be sent and
credited end-to-end.

The next owned implementation must consume the already-selected Standard Wallet
provider and exact new-API intent; show sender, recipient, wei, chain, expiry and
card identity before explicit wallet transaction approval; persist a separate
intent-bound pending send before entering the provider; retain UNKNOWN outcomes
after timeout/cold start with no automatic second send; then submit only the
actual returned hash to the exact original Card intent. Source/owner/session,
account and chain changes must invalidate the pending context without deleting
its journal. No fabricated hash or balance. Missing approved provider or shared
authority keeps this path explicitly unavailable. This document is a gap and
implementation handoff, not a claim that this bridge is already implemented.

The existing original `RpcCoreAuthority` verifies sender/recipient/amount,
receipt status, block and canonical re-read, chain6423, confirmations and intent
time. `CardService` credits only accepted receipts and atomically claims
chain/hash before credit. These source functions/test fixtures are not direct
public funding proof.

Prepared paired candidate and rollback materials remain preserved. No deployment
or alias change in this observation. All real account approval, signing, funded
Card, real private API acceptance, Data Fabric delivery, migrated-v2,
ComputerControl and real payment gates remain unproven/false. Card's complete
Testnet E2E goal stays open; no permanent local demo substitute is accepted.

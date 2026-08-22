# YNX Pay threat model

## Trust boundaries

The user Wallet owns keys and approval. The canonical App Gateway owns product/session/device binding and revocation. Pay owns invoice workflow and merchant records. The central Pay API plus chain/indexer evidence owns settlement truth. Merchants own webhook receivers. External bridge, stablecoin, card and AI providers are non-authoritative within their declared scopes.

## Principal threats and controls

| Threat | Required control |
|---|---|
| Forged or replayed Wallet result | exact intent digest, account signature, short expiry, one-time transaction/idempotency binding |
| Cross-product/session confused deputy | exact product, bundle, callback, device, scope and session binding; fail closed |
| UI/webhook marks paid | only authoritative chain and invoice match can persist committed state |
| Merchant credential theft | server-side secret manager, no browser delivery, rotation and audit |
| Store tamper/rollback | envelope MAC, atomic writes, backup hash and audit continuity check |
| Sponsor draining/Sybil | per-user/device/merchant budgets, nonce domains, attribution, rate controls and kill switch |
| Bridge/provider false completion | explicit state machine through destination confirmation; quote is never funds arrival |
| Refund abuse | payer/invoice binding, amount limits, merchant review and authoritative refund transaction |
| AI authority escalation | context consent, draft-only output, review decision and no signing/payment/refund tools |
| Secret or stack disclosure | bounded errors, structured redaction and automated secret scan |

Residual risk remains high until the central Gateway integration, sponsor contract/policy, bridge adapter, stablecoin issuer review, deployed observability and fresh end-to-end Testnet evidence are complete.

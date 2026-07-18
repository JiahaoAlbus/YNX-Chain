# YNX Shop central integration patch

This branch supplies two exact Wallet registry v2 entries and fail-closed product adapters. It does not claim that the central App Gateway has merged or deployed them.

## Registry entries

- Buyer: `internal/commerce/integration/shop-registry-v2.json`
- Seller: `internal/commerce/integration/seller-registry-v2.json`

The entries use the canonical schema from Wallet branch `origin/codex/ecosystem-wallet-auth` commit `efe827f`. Central integration must parse each entry with the shared `@ynx-chain/wallet-auth` v2 parser, call `verifyCentralWalletSession`, transactionally consume the challenge/replay records, and call `assertCentralWalletSessionActive` before every product-session use.

## Product adapter

Shop forwards exact Wallet approval JSON to `POST /v1/product-sessions/challenges`, forwards the exact P-256 completion to `POST /v1/product-sessions`, and verifies opaque product sessions through authenticated `POST /v1/product-sessions/introspect`. It requires exact client, bundle, role, ordered scopes, 64-hex session binding, account, and expiry. Unknown response fields, replay, expiry, callback substitution, scope changes, and cross-App tokens fail closed.

The browser session token exists only in JavaScript memory. Authorization requests are stored temporarily in `sessionStorage`; they contain no bearer, Wallet private key, recovery material, or service credential. Browser P-256 private keys are non-extractable IndexedDB `CryptoKey` values. Android stores product sessions with Android Keystore AES-GCM; iOS stores them in Keychain. Buyer and Seller never share a client, callback, device key identifier, bundle, scope list, or bearer.

## Pay and Trust authority boundary

- Pay is authoritative for invoice creation, committed `paid` settlement evidence, and committed refund evidence. Shop checks invoice, intent, merchant, payout, payer, YNXT amount, block, transaction hash, audit hash, and timestamps before changing money states.
- Trust receives bounded dispute evidence only. A Trust case may provide evidence and appeal URLs but cannot pay, refund, freeze, seize, blacklist, or move YNXT.
- Missing central URLs or credentials return `503 unavailable`; there is no local success fallback.

## Integration test request

Central CI should load both JSON entries and run Wallet signer/P-256 vectors plus these product cases: buyer-to-seller token reuse, seller-to-buyer reuse, callback replacement, bundle replacement, scope reorder/escalation, expired approval, revoked request digest, challenge replay, callback replay, and session-binding tamper. Until that merge and a live HTTPS run occur, both product release manifests keep `integratedCentral: false`.
